import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { join } from 'node:path'

type NodeView = Window & typeof globalThis & { readonly happyDOM: { close(): Promise<void> } }
interface NativeCanvas {
  createCanvas(width: number, height: number): { getContext(kind: '2d'): CanvasRenderingContext2D }
  readonly GlobalFonts: {
    removeAll(): void
    registerFromPath(path: string, family: string): unknown
    readonly families: readonly unknown[]
  }
}

export async function createNodePlatform(root: string, fontFile: string) {
  const require = createRequire(join(root, 'apps/web/package.json'))
  const { Window: ModelWindow } = require('happy-dom') as {
    Window: new (options: { url: string }) => NodeView
  }
  const canvasRequire = createRequire(require.resolve('pdfjs-dist/package.json'))
  const { createCanvas, GlobalFonts } = canvasRequire('@napi-rs/canvas') as NativeCanvas
  const fixtureFamily = 'X6FixtureMono'
  GlobalFonts.removeAll()
  assert(GlobalFonts.registerFromPath(fontFile, fixtureFamily))
  const files = [
    fontFile,
    require.resolve('happy-dom/package.json'),
    canvasRequire.resolve('@napi-rs/canvas/package.json'),
    ...Object.keys(require.cache).filter((file) => file.endsWith('.node')),
  ]
  const hashes: Record<string, string> = {}
  for (const file of files)
    hashes[file] = createHash('sha256')
      .update(await readFile(file))
      .digest('hex')
  const view = new ModelWindow({ url: 'http://node-fixture.invalid/' })
  // HappyDOM aliases CompositionEvent to Event and drops the public data field.
  class NodeCompositionEvent extends view.Event {
    readonly data: string
    constructor(type: string, options: CompositionEventInit = {}) {
      super(type, options)
      this.data = options.data ?? ''
    }
  }
  Object.defineProperty(view, 'CompositionEvent', {
    configurable: true,
    value: NodeCompositionEvent,
  })
  const nativeFonts = new view.EventTarget()
  Object.defineProperties(nativeFonts, {
    ready: { value: Promise.resolve(nativeFonts) },
    status: { value: 'loaded' },
  })
  Object.defineProperty(view.document, 'fonts', { value: nativeFonts })
  for (const name of [
    'window',
    'document',
    'navigator',
    'HTMLElement',
    'HTMLCanvasElement',
    'Element',
    'Node',
    'Event',
    'KeyboardEvent',
    'CompositionEvent',
    'InputEvent',
    'PointerEvent',
    'MouseEvent',
    'WheelEvent',
    'ClipboardEvent',
    'DataTransfer',
    'AbortController',
    'AbortSignal',
    'ResizeObserver',
  ]) {
    const value = name === 'window' ? view : (view as unknown as Record<string, unknown>)[name]
    if (value !== undefined) Object.defineProperty(globalThis, name, { configurable: true, value })
  }
  const contexts = new WeakMap<HTMLCanvasElement, CanvasRenderingContext2D>()
  Object.defineProperty(view.HTMLCanvasElement.prototype, 'getContext', {
    configurable: true,
    value: function (this: HTMLCanvasElement, kind: string) {
      if (kind !== '2d') return null
      let context = contexts.get(this)
      if (!context) {
        context = createCanvas(this.width || 1, this.height || 1).getContext('2d')
        contexts.set(this, context)
      }
      return context
    },
  })
  return {
    view,
    fixtureFamily,
    inputs: {
      hashes,
      fontFile,
      fixtureFamily,
      families: GlobalFonts.families,
      happyDomVersion: (require('happy-dom/package.json') as { version: string }).version,
      canvasVersion: (canvasRequire('@napi-rs/canvas/package.json') as { version: string }).version,
      dom: 'HappyDOM modeled DOM/layout; external CompositionEvent.data adapter',
      fonts:
        'Actual native Skia metrics; explicit registered font file; modeled synchronous font lifecycle',
      renderer: 'Actual DomTerminalRenderer with public schedulerClock and bounded callback pump',
      browser: 'N/A',
      headless: 'N/A',
      presentedFrames: 'UNKNOWN',
    },
  }
}

export function createNodeClock() {
  let serial = 0
  const frames = new Map<number, () => void>()
  const timers = new Map<number, ReturnType<typeof setTimeout>>()
  return {
    clock: {
      requestFrame(callback: () => void) {
        const id = ++serial
        frames.set(id, callback)
        return id
      },
      cancelFrame(id: number) {
        frames.delete(id)
      },
      setTimer(callback: () => void, delay: number) {
        const id = ++serial
        timers.set(
          id,
          setTimeout(() => {
            timers.delete(id)
            callback()
          }, delay),
        )
        return id
      },
      clearTimer(id: number) {
        const timer = timers.get(id)
        if (timer) clearTimeout(timer)
        timers.delete(id)
      },
    },
    drain(): void {
      let turns = 0
      while (frames.size) {
        assert(++turns <= 20, 'Bounded real renderer callback pump')
        const pending = [...frames.values()]
        frames.clear()
        for (const callback of pending) callback()
      }
    },
    close(): void {
      frames.clear()
      for (const timer of timers.values()) clearTimeout(timer)
      timers.clear()
    },
  }
}
