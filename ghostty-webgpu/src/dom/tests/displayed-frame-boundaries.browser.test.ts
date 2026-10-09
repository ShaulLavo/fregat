import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { GhosttyRuntime } from '../../core/runtime.js'
import { FrameCoordinator } from '../../render/frame-coordinator.js'
import { DomTerminalRenderer } from '../../render/dom/renderer.js'
import { WebGlTerminalRenderer } from '../../render/webgl/renderer.js'
import { CanvasTerminalRenderer } from '../../render/canvas/renderer.js'
import type { RendererTextFrameSnapshot } from '../../render/renderer.js'
import { WebGpuTerminalRenderer } from '../../render/renderer.js'
import type { TerminalSubmittedText } from '../submitted-frame.js'
import type { RenderSchedulerClock } from '../../render/scheduler.js'
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

async function fixture(
  backend: 'webgl' | 'webgpu' | 'canvas' | 'dom' = 'webgl',
  coordinated = false,
  deferOpen = false,
  publicFrames?: RendererTextFrameSnapshot[],
) {
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
      const onTextFrame = options.onTextFrame
      const capturedOptions = {
        ...options,
        schedulerClock: clock,
        onTextFrame: (snapshot: RendererTextFrameSnapshot) => {
          publicFrames?.push(snapshot)
          onTextFrame?.(snapshot)
        },
      }
      renderer = await {
        webgl: WebGlTerminalRenderer,
        webgpu: WebGpuTerminalRenderer,
        canvas: CanvasTerminalRenderer,
        dom: DomTerminalRenderer,
      }[backend].create(capturedOptions)
      if (coordinated) {
        const coordinator = new FrameCoordinator(clock)
        Reflect.set(renderer, 'coordinator', coordinator)
        Reflect.set(Reflect.get(renderer, 'scheduler'), 'clock', coordinator)
      }
      if (deferOpen) clock.flush()
      return renderer
    },
  })
  cleanups.push(() => terminal.dispose())
  const errors: unknown[] = []
  terminal.on('error', (event) => errors.push(event))
  if (!deferOpen) {
    await terminal.open(host)
    clock.flush()
  }
  return {
    terminal,
    session,
    clock,
    errors,
    host,
    get renderer() {
      return renderer
    },
  }
}

describe('review failure boundaries', () => {
  it('preserves previous lazy accepted text when extraction fails after native capture', async () => {
    const { terminal, clock, errors } = await fixture('webgl')
    terminal.write('accepted')
    clock.flush()
    const accepted = terminal.visibleLines()
    terminal.onText(() => {})
    const read = vi.spyOn(runtime.bridge, 'readTextRows').mockReturnValue(-1)
    cleanups.push(() => read.mockRestore())
    terminal.write('\rpending')
    clock.flush()
    read.mockRestore()
    expect(errors).toHaveLength(1)
    expect(terminal.visibleLines()).toEqual(accepted)
  })

  it('reports and recovers capture failure through coordinated WebGPU commits', async () => {
    const { terminal, clock, errors } = await fixture('webgpu', true)
    terminal.write('accepted')
    clock.flush()
    const accepted = terminal.visibleLines()
    const capture = vi.spyOn(runtime.bridge, 'captureRetainedFrame').mockReturnValue(-1)
    const escaped: (() => void)[] = []
    const microtask = vi.spyOn(globalThis, 'queueMicrotask').mockImplementation((fn) => {
      escaped.push(fn)
    })
    cleanups.push(() => {
      capture.mockRestore()
      microtask.mockRestore()
    })
    terminal.write('\rpending')
    clock.flush()
    capture.mockRestore()
    microtask.mockRestore()
    expect(terminal.visibleLines()).toEqual(accepted)
    expect({ reported: errors.length, escaped: escaped.length }).toEqual({
      reported: 1,
      escaped: 0,
    })
    clock.flush()
    expect(terminal.visibleLines()[0]).toContain('pending')
  })

  it('defers pre-open text listeners until public operations are available', async () => {
    const { terminal, host, clock, errors } = await fixture('webgl', false, true)
    const lifecycles: string[] = []
    let first = true
    terminal.onText(() => {
      lifecycles.push(terminal.lifecycle)
      if (!first) return
      first = false
      terminal.write('from listener')
    })
    await terminal.open(host)
    clock.flush()
    expect(errors).toEqual([])
    expect(lifecycles.every((state) => state === 'open')).toBe(true)
    expect(terminal.visibleLines()[0]).toContain('from listener')
  })

  it('keeps public renderer onTextFrame snapshots owned after the next capture', async () => {
    const frames: RendererTextFrameSnapshot[] = []
    const { terminal, clock } = await fixture('webgl', false, false, frames)
    terminal.write('held')
    clock.flush()
    const held = frames.at(-1)!
    const text = held.rows.map((row) => row.text)
    terminal.write('\rnew')
    clock.flush()
    expect(held.rows.map((row) => row.text)).toEqual(text)
  })

  it('keeps public renderer text snapshots cloneable without public native tokens', async () => {
    const frames: RendererTextFrameSnapshot[] = []
    const { terminal, clock } = await fixture('webgl', false, false, frames)
    terminal.write('held')
    clock.flush()
    const frame = frames.at(-1)!
    expect(() => structuredClone(frame)).not.toThrow()
    expect(frame).not.toHaveProperty('nativeFrame')
  })
})

describe('review text publication reentrancy and device recovery', () => {
  it('keeps accessibility on the newest frame after a reentrant WebGPU layout update', async () => {
    const { terminal, session, clock, host, errors } = await fixture('webgpu', true)
    terminal.write('row one\r\nrow two\r\nrow three\r\nrow four')
    clock.flush()
    let once = true
    const seen: number[] = []
    const observed: {
      event: number
      current: number | undefined
      eventRows: number
      displayedRows: number
      mirrorRows: number
    }[] = []
    terminal.onText(() => {
      if (!once) return
      once = false
      terminal.setAppearance({ grid: { columns: 34, rows: 5 } })
      terminal.setFont({ size: 18 })
    })
    terminal.setAccessibilityEnabled(true)
    terminal.onText((text) => {
      seen.push(text.frame)
      observed.push({
        event: text.frame,
        current: terminal.submittedFrame?.frame,
        eventRows: text.rows.length,
        displayedRows: terminal.visibleLines().length,
        mirrorRows: host.querySelectorAll('[role="list"] [role="listitem"]').length,
      })
    })
    terminal.write('\x1b[Hchanged')
    clock.flush()
    clock.flush()
    const text = Array.from(host.querySelectorAll('[role="list"] [role="listitem"]')).map((row) =>
      row.textContent?.trimEnd(),
    )
    expect(errors).toEqual([])
    expect(text).toEqual(terminal.visibleLines().map((row) => row.trimEnd()))
    expect(seen).toEqual([...seen].sort((a, b) => a - b))
    expect(observed.every((row) => row.eventRows === row.mirrorRows)).toBe(true)
  })
})
