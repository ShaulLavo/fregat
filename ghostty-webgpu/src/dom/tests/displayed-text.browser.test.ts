import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { Terminal as WorkerTerminal } from '../../../dist/worker/index.js'
import { GhosttyRuntime } from '../../core/runtime.js'
import type { GhosttyTerminal } from '../../core/terminal.js'
import { DomTerminalRenderer } from '../../render/dom/renderer.js'
import { WebGlTerminalRenderer } from '../../render/webgl/renderer.js'
import { WebGlTextPass } from '../../render/webgl/text-pass.js'
import { CanvasTerminalRenderer } from '../../render/canvas/renderer.js'
import { WebGpuTerminalRenderer } from '../../render/renderer.js'
import type { TerminalSubmittedSnapshot, TerminalSubmittedText } from '../submitted-frame.js'
import type { RendererTextFrameSnapshot } from '../../render/renderer.js'
import type { RenderSchedulerClock } from '../../render/scheduler.js'
import type { RowRendererSurface } from '../../render/row-renderer.js'
import { TerminalSession } from '../../term/session.js'
import { createTerminalElements } from '../elements.js'
import { createGhosttyWebGpuTerminalFromSession } from '../terminal.js'

let runtime: GhosttyRuntime
const cleanups: Array<() => void | Promise<void>> = []

class DeferredClock implements RenderSchedulerClock {
  private next = 0
  private readonly frames = new Map<number, () => void>()
  private readonly timers = new Map<number, () => void>()
  requestFrame(callback: () => void): number {
    const id = ++this.next
    this.frames.set(id, callback)
    return id
  }
  cancelFrame(id: number): void {
    this.frames.delete(id)
  }
  setTimer(callback: () => void): number {
    const id = ++this.next
    this.timers.set(id, callback)
    return id
  }
  clearTimer(id: number): void {
    this.timers.delete(id)
  }
  flushTimers(): void {
    const timers = [...this.timers.values()]
    this.timers.clear()
    for (const timer of timers) timer()
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

async function fixture(backend: 'webgl' | 'webgpu' | 'canvas' | 'dom' = 'webgl') {
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
  const snapshots: RendererTextFrameSnapshot[] = []
  let renderer:
    | WebGlTerminalRenderer
    | WebGpuTerminalRenderer
    | CanvasTerminalRenderer
    | DomTerminalRenderer
    | undefined
  const terminal = createGhosttyWebGpuTerminalFromSession(session, {
    autoFit: false,
    elements: createTerminalElements(host),
    rendererFactory: async (options) => {
      renderer = await {
        webgl: WebGlTerminalRenderer,
        webgpu: WebGpuTerminalRenderer,
        canvas: CanvasTerminalRenderer,
        dom: DomTerminalRenderer,
      }[backend].create({
        ...options,
        schedulerClock: clock,
        onTextFrame: (snapshot) => {
          snapshots.push(snapshot)
          options.onTextFrame?.(snapshot)
        },
      })
      return renderer
    },
  })
  cleanups.push(() => terminal.dispose())
  const errors: unknown[] = []
  terminal.on('error', (event) => errors.push(event))
  await terminal.open(host)
  clock.flush()
  return { terminal, session, clock, errors, host, renderer: renderer!, snapshots }
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

describe.each(['webgl', 'dom'] as const)('%s main-thread displayed-text demand', (backend) => {
  it('uses dirty retention until font or row-height changes invalidate the layout', async () => {
    const retain = vi.spyOn(runtime.bridge, 'captureRetainedFrame')
    cleanups.push(() => retain.mockRestore())
    const { terminal, clock, errors } = await fixture(backend)
    expect(retain.mock.calls.at(-1)?.[2]).toBe(1)
    terminal.write('first 界 é 🧑‍💻')
    clock.flush()
    terminal.write('\rnext')
    clock.flush()
    expect(retain.mock.calls.at(-1)?.[2]).toBe(0)
    const held = terminal.visibleLines()
    terminal.setFont({ size: 18 })
    clock.flush()
    await expect.poll(() => retain.mock.calls.at(-1)?.[2]).toBe(1)
    terminal.setFont({ lineHeight: 1.5 })
    clock.flush()
    await expect.poll(() => retain.mock.calls.at(-1)?.[2]).toBe(1)
    expect(terminal.visibleLines()).toEqual(held)
    expect(errors).toEqual([])
  })

  it.skipIf(backend !== 'webgl')(
    'keeps accepted dirty-row text after a failed WebGL submit and recovers every row',
    async () => {
      const { terminal, session, clock, errors } = await fixture(backend)
      const delivered: TerminalSubmittedText[] = []
      terminal.onText((text) => delivered.push(text))
      terminal.write('first\r\n界 é 🧑‍💻\r\nthird\r\nfourth')
      clock.flush()
      terminal.write('\x1b[1;1Hnext')
      clock.flush()
      const accepted = terminal.visibleLines()
      const held = JSON.stringify(delivered)
      const submit = vi.spyOn(WebGlTextPass.prototype, 'submit').mockImplementation(() => {
        throw new TypeError('injected WebGL submission failure')
      })
      cleanups.push(() => submit.mockRestore())
      terminal.write('\x1b[1;1Hpending\x1b[2;1Hnew é 🧑‍💻')
      clock.flush()
      expect(errors).toHaveLength(1)
      expect(terminal.visibleLines()).toEqual(accepted)
      expect(JSON.stringify(delivered)).toBe(held)
      submit.mockRestore()
      terminal.refresh(0, 3)
      clock.flushTimers()
      clock.flush()
      expect(terminal.visibleLines()).toEqual(
        session.renderState.readTextRows!().map((row) => row.text),
      )
      expect(terminal.visibleLines()[0]).toContain('pending')
      expect(JSON.stringify(delivered.slice(0, -1))).toBe(held)
    },
  )

  it('keeps metadata idle and pulls displayed bytes through pending output, resize and disposal', async () => {
    const count = extractionCount()
    const { terminal, session, clock, errors, host } = await fixture(backend)
    terminal.write('displayed 界 é 🧑‍💻')
    clock.flush()
    expect(count()).toBe(0)
    const metadata = terminal.submittedFrame!
    expect(structuredClone(metadata)).toEqual(metadata)
    expect(metadata).not.toHaveProperty('rows')
    expect(metadata).not.toHaveProperty('rowPatches')
    expect(host.querySelector('[role="list"]')).toBeNull()
    expect(count()).toBe(0)
    const displayed = terminal.visibleLines()
    expect(displayed).toEqual(session.renderState.readTextRows!().map((row) => row.text))
    terminal.write('\rnew native output')
    session.renderState.update()
    expect(terminal.visibleLines()).toEqual(displayed)
    expect(terminal.frameSnapshot()?.rows.map((row) => row.text)).toEqual(displayed)
    const native = Reflect.get(session, 'terminal') as GhosttyTerminal
    native.resize({ columns: 34, rows: 5 })
    session.renderState.update()
    expect(terminal.visibleLines()).toEqual(displayed)
    session.resize({ columns: 34, rows: 5 })
    clock.flush()
    expect(terminal.visibleLines()).toHaveLength(5)
    terminal.dispose()
    expect(displayed[0]).toContain('displayed')
    expect(() => terminal.visibleLines()).toThrow()
    expect(errors).toEqual([])
  })

  it('publishes owned viewport and patches per accepted frame, then retires the last listener', async () => {
    const count = extractionCount()
    const { terminal, clock, session, errors } = await fixture(backend)
    const delivered: TerminalSubmittedText[] = []
    const subscription = terminal.onText((text) => delivered.push(text))
    expect(delivered).toEqual([])
    terminal.write('first')
    clock.flush()
    const first = delivered[0]!
    expect(first.frame).toBe(terminal.submittedFrame!.frame)
    expect(first.rows).toHaveLength(4)
    expect(first.rows.every((row) => Object.keys(row).join() === 'y,text')).toBe(true)
    expect(structuredClone(first)).toEqual(first)
    const owned = JSON.stringify(first)
    const duplicate = terminal.onText((text) => delivered.push(text))
    terminal.write('\rsecond')
    clock.flush()
    expect(delivered).toHaveLength(3)
    expect(delivered[1]).toBe(delivered[2])
    expect(delivered[1]!.rowPatches.map((row) => row.y)).toEqual([0])
    subscription.dispose()
    subscription.dispose()
    const beforeResize = delivered.length
    session.resize({ columns: 34, rows: 5 })
    clock.flush()
    const resized = delivered.slice(beforeResize).find((text) => text.rows.length === 5)!
    expect(resized.rows).toHaveLength(5)
    expect(resized.rowPatches).toEqual(resized.rows)
    duplicate.dispose()
    const before = count()
    terminal.write('\rthird')
    clock.flush()
    terminal.write('\rfourth')
    clock.flush()
    expect(count()).toBe(before)
    expect(JSON.stringify(first)).toBe(owned)
    const resumed: TerminalSubmittedText[] = []
    const late = terminal.onText((text) => resumed.push(text))
    terminal.write('\rfifth')
    clock.flush()
    expect(resumed[0]!.rows[0]!.text).toContain('fifth')
    expect(resumed[0]!.rowPatches.map((row) => row.y)).toEqual([0])
    late.dispose()
    expect(session.grid.rows).toBe(5)
    terminal.dispose()
    expect(JSON.stringify(first)).toBe(owned)
    expect(errors).toEqual([])
  })

  it('enables accessibility through a text subscription and releases demand when disabled', async () => {
    const count = extractionCount()
    const { terminal, clock, host, errors } = await fixture(backend)
    terminal.write('current displayed text')
    clock.flush()
    expect(count()).toBe(0)
    expect(terminal.setAccessibilityEnabled(true)).toBe(true)
    expect(host.querySelector('[role="list"]')?.textContent).toContain('current displayed text')
    terminal.write('\rnext displayed text')
    clock.flush()
    expect(host.querySelector('[role="list"]')?.textContent).toContain('next displayed text')
    expect(terminal.setAccessibilityEnabled(false)).toBe(true)
    expect(host.querySelector('[role="list"]')).toBeNull()
    const disabled = count()
    terminal.write('\ridle again')
    clock.flush()
    expect(count()).toBe(disabled)
    expect(errors).toEqual([])
  })

  it('isolates subscriber failures and keeps independently registered listeners active', async () => {
    const { terminal, clock, errors } = await fixture(backend)
    const bad = terminal.onText(() => {
      throw new TypeError('test subscriber')
    })
    const received: TerminalSubmittedText[] = []
    const good = terminal.onText((text) => received.push(text))
    terminal.write('accepted frame')
    clock.flush()
    expect(errors).toHaveLength(1)
    expect(received[0]!.rows[0]!.text).toContain('accepted frame')
    bad.dispose()
    good.dispose()
  })
})

describe('worker displayed-text correctness fallback', () => {
  it('uses the same owned text API and metadata-only frame API through held output and resize', async () => {
    const host = document.createElement('div')
    host.style.cssText = 'width:400px;height:120px;position:relative'
    document.body.append(host)
    cleanups.push(() => host.remove())
    const family = 'DisplayedTextWorker'
    const terminal = await WorkerTerminal.create({
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
    const held = terminal.visibleLines()
    const columns = terminal.submittedFrame!.grid.columns
    expect(terminal.submittedFrame).not.toHaveProperty('rows')
    expect(host.querySelector('[role="list"]')).toBeNull()
    const execution = Reflect.get(terminal, 'execution') as {
      request(operation: 'visible', arguments_: [boolean]): Promise<void>
    }
    await execution.request('visible', [false])
    await terminal.write('\rpending worker state')
    expect(terminal.visibleLines()).toEqual(held)
    await execution.request('visible', [true])
    await expect.poll(() => terminal.visibleLines()[0]).toContain('pending worker state')
    const delivered: TerminalSubmittedText[] = []
    const layouts: Array<{ layout: number; text: TerminalSubmittedText }> = []
    const subscription = terminal.onText((text) => {
      delivered.push(text)
      layouts.push({ layout: terminal.submittedFrame!.layout, text })
    })
    expect(delivered).toEqual([])
    await terminal.write('\rnew worker output')
    await expect.poll(() => delivered.at(-1)?.rows[0]?.text).toContain('new worker output')
    expect(structuredClone(delivered.at(-1)!)).toEqual(delivered.at(-1))
    const beforeLayout = terminal.submittedFrame!.layout
    host.style.width = '320px'
    await expect.poll(() => terminal.submittedFrame?.grid.columns).toBeLessThan(columns)
    const resized = layouts.find((row) => row.layout > beforeLayout)!.text
    expect(resized.rowPatches).toEqual(resized.rows)
    subscription.dispose()
    const stopped = delivered.length
    await terminal.dispose()
    expect(held[0]).toContain('worker displayed')
    expect(delivered).toHaveLength(stopped)
    expect(() => terminal.visibleLines()).toThrow()
    expect(errors).toEqual([])
  })
})

describe.each(['canvas'] as const)('%s owned displayed-text publication', (backend) => {
  it('does no native retention or capture and preserves eager owned rows', async () => {
    const bridge = runtime.bridge
    const allocate = bridge.createRetainedFrame.bind(bridge)
    const capture = bridge.captureRetainedFrame.bind(bridge)
    let allocations = 0
    let captures = 0
    bridge.createRetainedFrame = (...args) => {
      allocations++
      return allocate(...args)
    }
    bridge.captureRetainedFrame = (...args) => {
      captures++
      return capture(...args)
    }
    cleanups.push(() => {
      bridge.createRetainedFrame = allocate
      bridge.captureRetainedFrame = capture
    })
    const { terminal, session, clock, errors } = await fixture(backend)
    const delivered: TerminalSubmittedText[] = []
    terminal.onText((text) => delivered.push(text))
    terminal.write('owned 界 é 🧑‍💻')
    clock.flush()
    expect({ allocations, captures }).toEqual({ allocations: 0, captures: 0 })
    const displayed = terminal.visibleLines()
    const execution = Reflect.get(terminal, 'execution') as {
      submittedFrame: TerminalSubmittedSnapshot
    }
    const summary = execution.submittedFrame
    expect(Object.getOwnPropertyDescriptor(summary, 'rows')?.get).toBeUndefined()
    expect(summary.rows.map((row) => row.text)).toEqual(displayed)
    expect(delivered.at(-1)!.rows).toEqual(summary.rows)
    terminal.write('\rnew pending')
    session.renderState.update()
    expect(terminal.visibleLines()).toEqual(displayed)
    clock.flush()
    expect(terminal.visibleLines()[0]).toContain('new pending')
    terminal.write('\r\x1b[8mconcealed change\x1b[0m')
    clock.flush()
    expect(terminal.visibleLines()[0]).toContain('concealed change')
    expect(delivered.at(-1)!.rowPatches[0]!.text).toContain('concealed change')
    terminal.dispose()
    expect(displayed[0]).toContain('owned')
    expect({ allocations, captures }).toEqual({ allocations: 0, captures: 0 })
    expect(errors).toEqual([])
  })
})

describe.each(['webgl', 'webgpu', 'dom'] as const)('%s logical displayed text', (backend) => {
  it('publishes concealed content and a complete owned viewport through a text listener', async () => {
    const { terminal, clock, errors } = await fixture(backend)
    await expect.poll(() => terminal.submittedFrame?.grid.rows).toBe(4)
    const delivered: TerminalSubmittedText[] = []
    terminal.onText((text) => delivered.push(text))
    terminal.write('\r\x1b[8mhidden one\x1b[0m')
    clock.flush()
    await expect.poll(() => delivered.at(-1)?.rows[0]?.text).toContain('hidden one')
    const before = delivered.length
    terminal.write('\r\x1b[8mhidden two\x1b[0m')
    clock.flush()
    await expect.poll(() => delivered.at(-1)?.rows[0]?.text).toContain('hidden two')
    expect(delivered.length).toBeGreaterThan(before)
    expect(delivered.at(-1)!.rowPatches[0]!.text).toContain('hidden two')
    expect(errors).toEqual([])
  })
})

describe('WebGPU retained displayed-text acceptance', () => {
  it('keeps accepted native text through deferred output and failed queue submission', async () => {
    const count = extractionCount()
    const { terminal, session, clock, errors } = await fixture('webgpu')
    await expect.poll(() => terminal.submittedFrame?.grid.rows).toBe(4)
    let accepted = 0
    terminal.onFrame(() => accepted++)
    const idle = count()
    terminal.write('GPU displayed 界 é')
    clock.flush()
    await expect.poll(() => accepted).toBe(1)
    expect(count()).toBe(idle)
    const owned = terminal.visibleLines()
    expect(owned[0]).toContain('GPU displayed')
    terminal.write('\rGPU pending')
    session.renderState.update()
    expect(terminal.visibleLines()).toEqual(owned)
    const submit = vi.spyOn(GPUQueue.prototype, 'submit').mockImplementation(() => {
      throw new TypeError('injected queue submission failure')
    })
    cleanups.push(() => submit.mockRestore())
    clock.flush()
    await expect.poll(() => errors.length).toBe(1)
    expect(terminal.visibleLines()).toEqual(owned)
    submit.mockRestore()
    terminal.refresh(0, 3)
    clock.flushTimers()
    clock.flush()
    await expect.poll(() => terminal.visibleLines()[0]).toContain('GPU pending')
    expect(terminal.frameSnapshot()?.rows.map((row) => row.text)).toEqual(terminal.visibleLines())
  })
})

describe('DOM retained displayed-text acceptance', () => {
  it('shares the lazy native rows getter across immutable snapshots', async () => {
    const { terminal, clock, snapshots } = await fixture('dom')
    terminal.write('first accepted 界 é')
    clock.flush()
    const first = snapshots.at(-1)!
    terminal.write('\rsecond accepted 🧑‍💻')
    clock.flush()
    const second = snapshots.at(-1)!
    const firstGetter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(first), 'rows')?.get
    const secondGetter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(second), 'rows')?.get
    expect(firstGetter).toBeTypeOf('function')
    expect(secondGetter).toBe(firstGetter)
    expect(Object.hasOwn(first, 'rows')).toBe(false)
    expect(Object.hasOwn(second, 'rows')).toBe(false)
    expect(Object.isFrozen(first)).toBe(true)
    expect(Object.isFrozen(second)).toBe(true)
    expect(terminal.visibleLines()[0]).toContain('second accepted 🧑‍💻')
  })

  it('accepts the already-owned native snapshot without a second lazy wrapper', async () => {
    const { terminal, clock, snapshots } = await fixture('dom')
    terminal.write('accepted native 界 é')
    clock.flush()
    const snapshot = snapshots.at(-1)!
    expect(Object.isFrozen(snapshot)).toBe(true)
    expect(Object.isFrozen(snapshot.cursor)).toBe(true)
    const execution = Reflect.get(terminal, 'execution') as {
      textFrame(): RendererTextFrameSnapshot | undefined
    }
    expect(execution.textFrame()).toBe(snapshot)
    const owned = terminal.visibleLines()
    terminal.write('\rnext native')
    clock.flush()
    expect(owned[0]).toContain('accepted native')
  })

  it('captures successful DOM paint before acknowledging damage and leaves failed paint unpublished', async () => {
    const retain = vi.spyOn(runtime.bridge, 'captureRetainedFrame')
    cleanups.push(() => retain.mockRestore())
    const { terminal, clock, errors, host, renderer } = await fixture('dom')
    const delivered: TerminalSubmittedText[] = []
    terminal.onText((text) => delivered.push(text))
    terminal.write('first\r\n界 é 🧑‍💻\r\nthird\r\nfourth')
    clock.flush()
    expect(retain.mock.calls.length).toBeGreaterThan(0)
    const owned = terminal.visibleLines()
    const held = JSON.stringify(delivered)
    const surface = Reflect.get(renderer, 'surface') as RowRendererSurface
    const paint = vi.spyOn(surface, 'paint').mockImplementation(() => {
      throw new TypeError('injected DOM paint failure')
    })
    cleanups.push(() => paint.mockRestore())
    const captures = retain.mock.calls.length
    terminal.write('\x1b[1;1Hpending\x1b[2;1Hnew é 🧑‍💻')
    expect(() => clock.flush()).toThrow('injected DOM paint failure')
    expect(errors).toEqual([])
    expect(retain.mock.calls).toHaveLength(captures)
    expect(terminal.visibleLines()).toEqual(owned)
    expect(JSON.stringify(delivered)).toBe(held)
    paint.mockRestore()
    terminal.refresh(0, 3)
    clock.flushTimers()
    clock.flush()
    const accepted = terminal.visibleLines()
    expect(accepted[0]).toContain('pending')
    expect(accepted[1]).toContain('new é 🧑‍💻')
    expect(delivered.at(-1)!.rows.map((row) => row.text)).toEqual(accepted)
    const domRows = [...host.querySelector('.ghostty-webgpu-frame')!.children]
    expect(domRows.map((row) => row.textContent?.trimEnd())).toEqual(
      accepted.map((row) => row.trimEnd()),
    )
    expect(JSON.stringify(delivered.slice(0, -1))).toBe(held)
  })

  it('pulls the accepted DOM viewport after long idle demand, alternate screen, selection and grid return', async () => {
    const count = extractionCount()
    const { terminal, session, clock, errors, host } = await fixture('dom')
    for (let index = 0; index < 40; index++) {
      terminal.write(`\x1b[${(index % 4) + 1};1H\x1b[2K${index} 界 é 🧑‍💻`)
      clock.flush()
    }
    expect(count()).toBe(0)
    const accepted = terminal.visibleLines()
    const saved = terminal.frameSnapshot()!
    const savedJson = JSON.stringify(saved)
    const domText = () =>
      [...host.querySelector('.ghostty-webgpu-frame')!.children].map((row) =>
        row.textContent?.trimEnd(),
      )
    expect(domText()).toEqual(accepted.map((row) => row.trimEnd()))
    const delivered: TerminalSubmittedText[] = []
    const subscription = terminal.onText((text) => delivered.push(text))
    terminal.write('\x1b[1;1H\x1b[2Ksubscribed 界')
    clock.flush()
    expect(delivered.at(-1)!.rowPatches.map((row) => row.y)).toEqual([0])
    expect(delivered.at(-1)!.rows.map((row) => row.text)).toEqual(terminal.visibleLines())
    terminal.write('\x1b[?1049h\x1b[2Jalternate é 🧑‍💻')
    clock.flush()
    expect(domText()).toEqual(terminal.visibleLines().map((row) => row.trimEnd()))
    terminal.write('\x1b[?1049l')
    clock.flush()
    expect(terminal.visibleLines()[0]).toContain('subscribed 界')
    terminal.selectRange({ x: 0, y: 0 }, { x: 6, y: 0 })
    clock.flush()
    expect(domText()).toEqual(terminal.visibleLines().map((row) => row.trimEnd()))
    session.resize({ columns: 34, rows: 5 })
    clock.flush()
    session.resize({ columns: 30, rows: 4 })
    clock.flush()
    terminal.write('\x1b[4;1H\x1b[2Kreturned grid')
    clock.flush()
    expect(terminal.visibleLines()[3]).toContain('returned grid')
    expect(domText()).toEqual(terminal.visibleLines().map((row) => row.trimEnd()))
    expect(delivered.at(-1)!.rows.map((row) => row.text)).toEqual(terminal.visibleLines())
    subscription.dispose()
    const idle = count()
    terminal.write('\x1b[3;1H\x1b[2Kunsubscribed again')
    clock.flush()
    expect(count()).toBe(idle)
    expect(JSON.stringify(saved)).toBe(savedJson)
    expect(errors).toEqual([])
  })
})
