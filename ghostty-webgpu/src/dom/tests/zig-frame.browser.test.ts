import { afterAll, afterEach, expect, it, onTestFinished, vi } from 'vitest'
import { page } from 'vitest/browser'
import { GhosttyRuntime } from '../../core/runtime.js'
import { ZigFrameBuilder } from '../../core/zig-frame.js'
import { CanvasGlyphRasterizer } from '../../render/atlas/canvas-rasterizer.js'
import { defaultRendererTheme } from '../../render/instances/types.js'
import { WebGpuTerminalRenderer } from '../../render/renderer.js'
import { WebGlTerminalRenderer } from '../../render/webgl/renderer.js'
import { displayedPixels, fittedFont, TestClock } from '../../render/webgl/tests/fixture.js'
import { TerminalSession } from '../../term/session.js'
import { createGhosttyWebGpuTerminalFromSession } from '../terminal.js'

const disposables: (() => void)[] = []
let sentinelDevice: GPUDevice | undefined

afterEach(() => {
  for (const dispose of disposables.splice(0).reverse()) dispose()
  vi.restoreAllMocks()
})

afterAll(async () => {
  if (!sentinelDevice) return
  const loss = sentinelDevice.lost
  sentinelDevice.destroy()
  await loss
})

async function retainGpuInstance(): Promise<void> {
  if (sentinelDevice) return
  const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' })
  expect(adapter).not.toBeNull()
  // Keep Dawn's external instance alive across test-owned device teardown.
  sentinelDevice = await adapter!.requestDevice()
}

async function hostFixture(
  backend: 'webgl2' | 'webgpu' = 'webgl2',
  grid = { columns: 12, rows: 3 },
  clock?: TestClock,
) {
  const runtime = await GhosttyRuntime.create()
  disposables.push(() => runtime.dispose())
  const host = document.createElement('div')
  host.style.width = '320px'
  host.style.height = '160px'
  document.body.append(host)
  disposables.push(() => {
    host
      .querySelector('canvas')
      ?.getContext('webgl2')
      ?.getExtension('WEBGL_lose_context')
      ?.loseContext()
    host.remove()
  })
  const session = await TerminalSession.create<Event>({
    appearance: {
      cursor: { blink: false },
      font: { family: 'monospace', size: 16 },
      grid: { ...grid, pixelRatio: 1 },
    },
    runtime: { kind: 'borrowed', runtime },
  })
  let renderer: WebGlTerminalRenderer | WebGpuTerminalRenderer | undefined
  const terminal = createGhosttyWebGpuTerminalFromSession(session, {
    autoFit: false,
    rendererFactory: async (options) => {
      if (backend === 'webgpu') {
        await retainGpuInstance()
        renderer = await WebGpuTerminalRenderer.create({ ...options, schedulerClock: clock })
        return renderer
      }
      renderer = await WebGlTerminalRenderer.create({ ...options, schedulerClock: clock })
      return renderer
    },
  })
  disposables.push(() => terminal.dispose())
  const errors: unknown[] = []
  terminal.on('error', (error) => errors.push(error))
  await terminal.open(host)
  expect(renderer).toBeDefined()
  return {
    canvas: host.querySelector('canvas')!,
    errors,
    host,
    renderer: renderer!,
    state: session.renderState,
    terminal,
  }
}

it.each(['webgl2', 'webgpu'] as const)('uses the native GPU producer (%s)', async (backend) => {
  const { canvas, terminal, renderer, errors } = await hostFixture(backend)
  await expect.poll(() => terminal.hasPendingFrame).toBe(false)
  const before = await displayedPixels(canvas)
  terminal.write('\x1b[?25l\x1b[31;44mASCII')
  await expect.poll(() => terminal.hasPendingFrame).toBe(false)
  expect(terminal.diagnostics.rendererBackend).toBe(backend)
  expect(renderer.metrics.zigFrames).toBe(renderer.metrics.submittedFrames)
  expect(await displayedPixels(canvas)).not.toEqual(before)
  expect(errors).toEqual([])
  terminal.dispose()
  expect(terminal.hasPendingFrame).toBe(false)
  expect(terminal.hasPendingTimer).toBe(false)
})

async function expectPainted(native: Awaited<ReturnType<typeof hostFixture>>): Promise<void> {
  await expect.poll(() => native.terminal.hasPendingFrame).toBe(false)
  const pixels = await displayedPixels(native.canvas)
  expect(pixels.byteLength).toBe(native.canvas.width * native.canvas.height * 4)
  expect(native.renderer.metrics.zigFrames).toBe(native.renderer.metrics.submittedFrames)
  expect(native.errors).toEqual([])
}

it.each(['webgl2', 'webgpu'] as const)(
  'keeps Unicode resident in the default native producer (%s)',
  async (backend) => {
    const native = await hostFixture(backend)
    native.terminal.write('\x1b[?25lASCII\r\nsecond\r\nthird')
    await expectPainted(native)
    expect(native.terminal.diagnostics.rendererBackend).toBe(backend)
    expect(native.renderer.metrics.zigFrames).toBeGreaterThan(0)
    const nativeFrames = native.renderer.metrics.zigFrames
    const build = vi.spyOn(ZigFrameBuilder.prototype, 'build')
    native.terminal.write('\x1b[3;1H界')
    await expectPainted(native)
    expect(build.mock.results.map((result) => result.value)).toEqual([2, 0])
    expect(native.renderer.metrics.zigFrames).toBe(nativeFrames + 1)
    build.mockClear()
    native.terminal.write('\x1b[1;1Hchanged')
    await expectPainted(native)
    expect(build.mock.results.at(-1)?.value).toBe(0)
    expect(native.renderer.metrics.zigFrames).toBe(nativeFrames + 2)
    build.mockClear()
    native.terminal.write('\x1b[3;1H\x1b[2KASCII')
    await expectPainted(native)
    expect(build.mock.results.at(-1)?.value).toBe(0)
    expect(native.renderer.metrics.zigFrames).toBe(nativeFrames + 3)

    native.terminal.dispose()
    expect(native.terminal.hasPendingFrame).toBe(false)
    expect(native.terminal.hasPendingTimer).toBe(false)
  },
)

it.each(['webgl2', 'webgpu'] as const)(
  'recovers real atlas pressure entirely through Zig and retains clean-row pixels (%s)',
  async (backend) => {
    const viewport = { width: window.innerWidth, height: window.innerHeight }
    onTestFinished(() => page.viewport(viewport.width, viewport.height))
    await page.viewport(800, 2400)
    const clocks = [new TestClock()]
    const native = await hostFixture(backend, { columns: 1, rows: 2 }, clocks[0])
    const flush = () => {
      for (const clock of clocks) {
        for (let attempt = 0; attempt < 8 && clock.frames.size > 0; attempt += 1) clock.flushFrame()
        expect(clock.frames.size).toBe(0)
      }
    }
    const font = fittedFont(320, 512, 500)

    native.host.style.height = '1040px'
    native.renderer.setFont(font)
    native.terminal.write('\x1b[?25lM\x1b[2;1H_')

    flush()
    await expectPainted(native)
    const before = await displayedPixels(native.canvas)
    const builds = vi.spyOn(ZigFrameBuilder.prototype, 'build')
    const glyphs = [...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'].flatMap((letter) => [
      `\x1b[0m${letter}`,
      `\x1b[1m${letter}`,
    ])
    for (const glyph of glyphs) {
      native.terminal.write(`\x1b[1;1H${glyph}`)
      flush()
      expect(native.renderer.metrics.zigFrames).toBe(native.renderer.metrics.submittedFrames)
    }
    expect(native.renderer.metrics.atlasEvictions).toBeGreaterThan(0)
    expect(
      builds.mock.results.some(
        (result, index, results) =>
          result.value === 2 && results[index + 1]?.value === 2 && results[index + 2]?.value === 0,
      ),
    ).toBe(true)
    flush()
    await expectPainted(native)
    const after = await displayedPixels(native.canvas)
    const rowBytes = native.canvas.width * font.deviceCellHeight * 4
    expect(after.subarray(rowBytes)).toEqual(before.subarray(rowBytes))
    const zigFrames = native.renderer.metrics.zigFrames

    native.renderer.setFont(fittedFont())
    native.terminal.write('\x1b[1;1H\x1b[0mé')

    flush()
    await expectPainted(native)
    expect(native.renderer.metrics.zigFrames).toBeGreaterThan(zigFrames)
  },
  30_000,
)

it.each(['webgl2', 'webgpu'] as const)(
  'bounds genuine native atlas exhaustion and returns to exact Zig pixels after shrinking (%s)',
  async (backend) => {
    const nativeClock = new TestClock()
    const native = await hostFixture(backend, { columns: 6, rows: 3 }, nativeClock)
    if (nativeClock.frames.size > 0) nativeClock.flushFrame()
    const face = new FontFace(
      'AtlasExhaustionTest',
      `url(${new URL('../../../site/public/fonts/jetbrains-mono-latin-400-normal.woff2', import.meta.url).href})`,
    )
    document.fonts.add(await face.load())
    onTestFinished(() => {
      document.fonts.delete(face)
    })
    const fitted = fittedFont(400, 650, 650)
    const font = { ...fitted, settings: { ...fitted.settings, family: 'AtlasExhaustionTest' } }
    const rasterizer = new CanvasGlyphRasterizer({ font })
    const glyphs = [...'ABCDEFGHIJKLMNOPQRSTUVWXYZ']
      .flatMap((text) => (['normal', 'bold'] as const).map((weight) => ({ text, weight })))
      .filter((input) => {
        const bitmap = rasterizer.rasterize({
          ...input,
          italic: false,
          cellSpan: 1,
          foreground: defaultRendererTheme.foreground,
        })
        return (
          bitmap &&
          bitmap.kind === 'grayscale' &&
          bitmap.width > 256 &&
          bitmap.height > 256 &&
          bitmap.width <= 510 &&
          bitmap.height <= 510
        )
      })
      .slice(0, 18)
    expect(glyphs).toHaveLength(18)
    native.renderer.setFont(font)
    if (nativeClock.frames.size > 0) nativeClock.flushFrame()
    const readRows = vi.spyOn(native.state, 'readRows')
    const build = vi.spyOn(ZigFrameBuilder.prototype, 'build')
    const before = native.renderer.metrics.submittedFrames
    const uploadOperations = native.renderer.metrics.instanceUploadOperations
    const atlasUploads = native.renderer.metrics.atlasUploadOperations
    const acknowledge = vi.spyOn(native.state, 'acknowledge')
    native.terminal.write(
      '\x1b[?25l' +
        glyphs
          .map(
            (glyph, index) =>
              `\x1b[${Math.floor(index / 6) + 1};${(index % 6) + 1}H\x1b[${glyph.weight === 'bold' ? 1 : 0}m${glyph.text}`,
          )
          .join(''),
    )
    expect(() => nativeClock.flushFrame()).toThrow(
      expect.objectContaining({
        operation: 'frame_builder',
        message: 'The native frame could not be built after atlas recovery (status 2)',
      }),
    )
    expect(build.mock.results.map((result) => result.value)).toEqual([2, 2, 2, 2])
    expect(readRows).not.toHaveBeenCalled()
    expect(native.renderer.metrics.submittedFrames).toBe(before)
    expect(native.renderer.metrics.instanceUploadOperations).toBe(uploadOperations)
    expect(native.renderer.metrics.atlasUploadOperations).toBe(atlasUploads)
    expect(acknowledge).not.toHaveBeenCalled()
    expect(native.renderer.hasPendingTimer).toBe(false)
    expect(native.terminal.hasPendingFrame).toBe(false)
    const nativeFrames = native.renderer.metrics.zigFrames
    native.terminal.write('\x1b[0m\x1b[2J\x1b[Hrecovered')
    native.renderer.setFont(fittedFont())
    if (nativeClock.frames.size > 0) nativeClock.flushFrame()
    expect(native.renderer.metrics.zigFrames).toBeGreaterThan(nativeFrames)
    await expectPainted(native)
    expect(native.terminal.hasPendingTimer).toBe(false)
  },
)

it('settles rolling ASCII scroll notifications without uploading unchanged native records', async () => {
  const native = await hostFixture()
  native.terminal.write('\x1b[?25lsame\r\nsame\r\nsame')
  await expect.poll(() => native.terminal.hasPendingFrame).toBe(false)
  const build = vi.spyOn(ZigFrameBuilder.prototype, 'build')
  const scroll = vi.spyOn(native.renderer, 'notifyScroll')
  const nativeDraw = vi.spyOn(native.canvas.getContext('webgl2')!, 'drawArraysInstanced')
  const uploaded = native.renderer.metrics.uploadedBytes
  const operations = native.renderer.metrics.instanceUploadOperations
  const submitted = native.renderer.metrics.submittedFrames
  native.terminal.write('\r\nsame')
  await expect.poll(() => native.terminal.hasPendingFrame).toBe(false)
  expect(scroll).toHaveBeenCalledOnce()
  expect(nativeDraw).toHaveBeenCalledTimes(
    (native.renderer.metrics.submittedFrames - submitted) * 2,
  )
  expect({
    full: build.mock.calls.map(([options]) => options.full),
    uploadedBytes: native.renderer.metrics.uploadedBytes - uploaded,
    uploadOperations: native.renderer.metrics.instanceUploadOperations - operations,
  }).toEqual({ full: [false], uploadedBytes: 0, uploadOperations: 0 })
  expect(native.errors).toEqual([])
})
