import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { Terminal as WorkerTerminal } from '../../../dist/worker/index.js'
import { GhosttyRuntime } from '../../core/runtime.js'
import type { GhosttyTerminal } from '../../core/terminal.js'
import { CanvasTerminalRenderer } from '../../render/canvas/renderer.js'
import type { RendererTextFrameSnapshot } from '../../render/renderer.js'
import type { RenderSchedulerClock } from '../../render/scheduler.js'
import { TerminalSession } from '../../term/session.js'
import { createTerminalElements } from '../elements.js'
import { createGhosttyWebGpuTerminalFromSession } from '../terminal.js'

let runtime: GhosttyRuntime
const cleanups: Array<() => void | Promise<void>> = []

class DeferredClock implements RenderSchedulerClock {
  private next = 0
  private readonly frames = new Map<number, () => void>()
  requestFrame(callback: () => void): number {
    const id = ++this.next
    this.frames.set(id, callback)
    return id
  }
  cancelFrame(id: number): void {
    this.frames.delete(id)
  }
  setTimer(callback: () => void, delay: number): number {
    return window.setTimeout(callback, delay)
  }
  clearTimer(id: number): void {
    window.clearTimeout(id)
  }
  flush(): void {
    const frames = [...this.frames.values()]
    this.frames.clear()
    for (const frame of frames) frame()
  }
}

beforeAll(async () => {
  runtime = await GhosttyRuntime.create()
})
afterAll(() => runtime.dispose())
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})

async function fixture() {
  const host = document.createElement('div')
  host.style.cssText = 'width:400px;height:160px;position:relative'
  document.body.append(host)
  cleanups.push(() => host.remove())
  const session = await TerminalSession.create<Event>({
    appearance: {
      cursor: { blink: false },
      font: { family: 'monospace', size: 16 },
      grid: { columns: 30, rows: 4, pixelRatio: 1 },
    },
    runtime: { kind: 'borrowed', runtime },
  })
  const clock = new DeferredClock()
  const terminal = createGhosttyWebGpuTerminalFromSession(session, {
    accessibility: false,
    autoFit: false,
    elements: createTerminalElements(host),
    rendererFactory: (options) =>
      CanvasTerminalRenderer.create({ ...options, schedulerClock: clock }),
  })
  cleanups.push(() => terminal.dispose())
  const errors: unknown[] = []
  terminal.on('error', (event) => errors.push(event))
  await terminal.open(host)
  clock.flush()
  return { terminal, session, clock, errors, host }
}

function bytes(frame: RendererTextFrameSnapshot | undefined): string {
  return JSON.stringify(frame)
}

function extractionCount() {
  const bridge = runtime.bridge
  const originalText = bridge.readTextRows.bind(bridge)
  const originalRetained = bridge.readRetainedText.bind(bridge)
  let count = 0
  bridge.readTextRows = (...args) => {
    count++
    return originalText(...args)
  }
  bridge.readRetainedText = (...args) => {
    count++
    return originalRetained(...args)
  }
  cleanups.push(() => {
    bridge.readTextRows = originalText
    bridge.readRetainedText = originalRetained
  })
  return () => count
}

describe('main-thread displayed-text demand', () => {
  it('does zero text extraction without demand and pulls the displayed bytes after newer native output', async () => {
    const count = extractionCount()
    const { terminal, session, clock, errors } = await fixture()
    terminal.write('displayed 界 é 🧑‍💻')
    clock.flush()
    expect(count()).toBe(0)
    const expected = JSON.stringify({
      cursor: session.renderState.readCursor(),
      paintedCursor: terminal.readDisplayedText()?.paintedCursor,
      rows: session.renderState.readTextRows!(),
    })
    const displayed = terminal.readDisplayedText()!
    expect(bytes(displayed)).toBe(expected)
    const owned = bytes(displayed)
    terminal.write('\rnew native output')
    session.renderState.update()
    expect(bytes(terminal.readDisplayedText())).toBe(owned)
    expect(terminal.visibleLines()).toEqual(displayed.rows.map((row) => row.text))
    const styled = terminal.frameSnapshot()!
    expect(styled.rows.map((row) => row.text)).toEqual(displayed.rows.map((row) => row.text))
    const native = Reflect.get(session, 'terminal') as GhosttyTerminal
    native.resize({ columns: 34, rows: 5 })
    session.renderState.update()
    expect(bytes(terminal.readDisplayedText())).toBe(owned)
    let accepted = 0
    terminal.onFrame(() => accepted++)
    session.resize({ columns: 34, rows: 5 })
    expect(accepted).toBeGreaterThan(0)
    clock.flush()
    expect(terminal.readDisplayedText()?.rows).toHaveLength(5)
    expect(bytes(displayed)).toBe(owned)
    terminal.dispose()
    expect(bytes(displayed)).toBe(owned)
    expect(() => terminal.readDisplayedText()).toThrow()
    expect(errors).toEqual([])
  })

  it('replays subscriptions, pushes while active, stops extraction on unsubscribe, and hydrates accessibility late', async () => {
    const count = extractionCount()
    const { terminal, clock, errors, host } = await fixture()
    terminal.write('first')
    clock.flush()
    const delivered: string[] = []
    let pushed: RendererTextFrameSnapshot | undefined
    const subscription = terminal.subscribeDisplayedText((frame) => {
      pushed ??= frame
      delivered.push(bytes(frame))
    })
    expect(delivered).toHaveLength(1)
    terminal.write('\rsecond')
    clock.flush()
    expect(delivered).toHaveLength(2)
    expect(delivered[1]).toContain('second')
    const firstOwned = delivered[0]
    subscription.dispose()
    subscription.dispose()
    const before = count()
    terminal.write('\rthird')
    clock.flush()
    terminal.write('\rfourth')
    clock.flush()
    expect(count()).toBe(before)
    expect(delivered).toHaveLength(2)
    expect(delivered[0]).toBe(firstOwned)
    expect(bytes(pushed)).toBe(firstOwned)
    const summary = terminal.submittedFrame!
    expect(summary.rows[0]?.text).toContain('fourth')
    terminal.setAccessibilityEnabled(true)
    expect(host.querySelector('[role="list"]')?.textContent).toContain('fourth')
    terminal.write('\rfifth')
    clock.flush()
    expect(host.querySelector('[role="list"]')?.textContent).toContain('fifth')
    terminal.setAccessibilityEnabled(false)
    const disabled = count()
    terminal.write('\rsixth')
    clock.flush()
    expect(count()).toBe(disabled)
    expect(summary.rows[0]?.text).toContain('fourth')
    expect(errors).toEqual([])
  })

  it('retires demand when immediate subscriber delivery throws', async () => {
    const count = extractionCount()
    const { terminal, clock } = await fixture()
    expect(() =>
      terminal.subscribeDisplayedText(() => {
        throw new TypeError('test subscriber')
      }),
    ).toThrow('test subscriber')
    const before = count()
    terminal.write('no leaked subscription')
    clock.flush()
    expect(count()).toBe(before)
  })
})

describe('worker displayed-text correctness fallback', () => {
  it('returns owned pushed text, supports subscriptions and resize, and retires after disposal', async () => {
    const host = document.createElement('div')
    host.style.cssText = 'width:400px;height:120px;position:relative'
    document.body.append(host)
    cleanups.push(() => host.remove())
    const family = 'DisplayedTextWorker'
    const terminal = await WorkerTerminal.create({
      accessibility: false,
      backend: 'webgl',
      appearance: { cursor: { blink: false }, font: { family, size: 16 } },
      fonts: [
        {
          family,
          source: {
            url: new URL(
              '../../../site/public/fonts/jetbrains-mono-latin-400-normal.woff2',
              import.meta.url,
            ).href,
          },
        },
      ],
    })
    cleanups.push(() => terminal.dispose())
    const errors: unknown[] = []
    terminal.on('error', (event) => errors.push(event))
    await terminal.open(host)
    await terminal.write('worker displayed 界')
    await expect.poll(() => terminal.visibleLines()[0]).toContain('worker displayed')
    const held = terminal.readDisplayedText()!
    const owned = bytes(held)
    const execution = Reflect.get(terminal, 'execution') as {
      request(operation: 'visible', arguments_: [boolean]): Promise<void>
    }
    await execution.request('visible', [false])
    await terminal.write('\rpending worker state')
    expect(bytes(terminal.readDisplayedText())).toBe(owned)
    await execution.request('visible', [true])
    await expect.poll(() => terminal.visibleLines()[0]).toContain('pending worker state')
    const delivered: string[] = []
    const subscription = terminal.subscribeDisplayedText((frame) => delivered.push(bytes(frame)))
    expect(delivered).toHaveLength(1)
    await terminal.write('\rnew worker output')
    await expect.poll(() => terminal.visibleLines()[0]).toContain('new worker output')
    expect(delivered.length).toBeGreaterThan(1)
    subscription.dispose()
    const stopped = delivered.length
    host.style.width = '320px'
    await expect
      .poll(() => terminal.submittedFrame?.grid.columns)
      .toBeLessThan(held.rows[0]!.cells.length)
    expect(bytes(held)).toBe(owned)
    expect(delivered).toHaveLength(stopped)
    expect(terminal.readDisplayedText()?.rows[0]?.cells).toHaveLength(
      terminal.submittedFrame!.grid.columns,
    )
    await terminal.dispose()
    expect(bytes(held)).toBe(owned)
    expect(() => terminal.readDisplayedText()).toThrow()
    expect(errors).toEqual([])
  })
})
