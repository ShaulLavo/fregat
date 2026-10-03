import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { page } from 'vitest/browser'
import { GhosttyRuntime } from '../../core/runtime.js'
import {
  zigFrameCursorStyles,
  zigGlyphCollisionFixtures,
  zigUnicodeFixtures,
} from '../../core/tests/zig-frame-fixtures.js'
import { ZigFrameBuilder } from '../../core/zig-frame.js'
import { CanvasGlyphRasterizer } from '../atlas/canvas-rasterizer.js'
import { defaultRendererTheme } from '../instances/types.js'
import { WebGpuTerminalRenderer, type WebGpuTerminalRendererOptions } from '../renderer.js'
import { WebGlTerminalRenderer } from '../webgl/renderer.js'
import { displayedPixels, fittedFont, TestClock } from '../webgl/tests/fixture.js'

const disposables: (() => void)[] = []
const devices: GPUDevice[] = []
const devicePool: GPUDevice[] = []
const resourceChecks: (() => void)[] = []
let sentinel: GPUDevice
const viewport = { width: window.innerWidth, height: window.innerHeight }
const intrinsicFont = new FontFace(
  'Zig Intrinsic Colors',
  `url(${new URL('./fixtures/intrinsic-colors.ttf', import.meta.url).href})`,
)

beforeAll(async () => {
  await page.viewport(900, 650)
  document.fonts.add(await intrinsicFont.load())
  const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' })
  expect(adapter).not.toBeNull()
  // Keep Dawn's instance alive between independently owned renderer devices.
  sentinel = await adapter!.requestDevice()
})

afterEach(async () => {
  for (const dispose of disposables.splice(0).reverse()) dispose()
  for (const check of resourceChecks.splice(0)) check()
  await Promise.all(devices.splice(0).map((device) => device.queue.onSubmittedWorkDone()))
  vi.restoreAllMocks()
})

afterAll(async () => {
  document.fonts.delete(intrinsicFont)
  const losses = devicePool.map((device) => device.lost)
  for (const device of devicePool) device.destroy()
  await Promise.all(losses)
  if (sentinel) {
    const lost = sentinel.lost
    sentinel.destroy()
    await lost
  }
  await page.viewport(viewport.width, viewport.height)
})

async function createDevice(): Promise<GPUDevice> {
  let device = devicePool[devices.length]
  if (!device) {
    const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' })
    expect(adapter).not.toBeNull()
    device = await adapter!.requestDevice()
    devicePool.push(device)
  }
  // The injected factory owns the pooled devices; renderer buffers and contexts still tear down.
  vi.spyOn(device, 'destroy').mockImplementation(() => {})
  const createBuffer = device.createBuffer.bind(device)
  vi.spyOn(device, 'createBuffer').mockImplementation((descriptor) => {
    const buffer = createBuffer(descriptor)
    const destroy = vi.spyOn(buffer, 'destroy')
    resourceChecks.push(() => expect(destroy).toHaveBeenCalledOnce())
    return buffer
  })
  const createTexture = device.createTexture.bind(device)
  vi.spyOn(device, 'createTexture').mockImplementation((descriptor) => {
    const texture = createTexture(descriptor)
    const destroy = vi.spyOn(texture, 'destroy')
    resourceChecks.push(() => expect(destroy).toHaveBeenCalledOnce())
    return texture
  })
  devices.push(device)
  return device
}

async function sourceFixture(content: string) {
  const runtime = await GhosttyRuntime.create()
  disposables.push(() => runtime.dispose())
  const terminal = runtime.createTerminal({ columns: 40, rows: 3 })
  const state = runtime.createRenderState(terminal)
  terminal.write(`\x1b[?25l\x1b[?2027h${content}`)
  return { runtime, state, terminal }
}

async function nativeFixture(
  backend: 'webgpu' | 'webgl2',
  content: string,
  options: Partial<WebGpuTerminalRendererOptions> = {},
) {
  const fixture = document.createElement('div')
  document.body.append(fixture)
  disposables.push(() => fixture.remove())
  const Renderer = backend === 'webgpu' ? WebGpuTerminalRenderer : WebGlTerminalRenderer
  const create = async () => {
    const source = await sourceFixture(content)
    const label = document.createElement('p')
    label.textContent = `${backend} / Zig`
    const canvas = document.createElement('canvas')
    const background = options.theme?.background ?? defaultRendererTheme.background
    canvas.style.backgroundColor = `rgb(${background.r}, ${background.g}, ${background.b})`
    fixture.append(label, canvas)
    const clock = new TestClock()
    const unconfigure =
      backend === 'webgpu' ? vi.spyOn(canvas.getContext('webgpu')!, 'unconfigure') : undefined
    const renderer = await Renderer.create({
      canvas,
      columns: 40,
      rows: 3,
      renderState: source.state,
      font: fittedFont(),
      schedulerClock: clock,
      deviceFactory: createDevice,
      ...options,
    })
    disposables.push(() => {
      renderer.dispose()
      expect(clock.frames.size).toBe(0)
      expect(clock.timers.size).toBe(0)
      if (unconfigure) expect(unconfigure).toHaveBeenCalledOnce()
      if (backend === 'webgl2')
        canvas.getContext('webgl2')?.getExtension('WEBGL_lose_context')?.loseContext()
    })
    return { ...source, canvas, clock, renderer }
  }
  const native = await create()
  const readRows = vi.spyOn(native.state, 'readRows')
  const builds = vi.spyOn(ZigFrameBuilder.prototype, 'build')
  return { fixture, native, readRows, builds }
}

type Fixture = Awaited<ReturnType<typeof nativeFixture>>

function flushFrame(pair: Fixture): void {
  for (let attempt = 0; attempt < 8 && pair.native.clock.frames.size > 0; attempt += 1)
    pair.native.clock.flushFrame()
  expect(pair.native.clock.frames.size).toBe(0)
  expect(pair.native.clock.timers.size).toBe(0)
}

function writeFrame(pair: Fixture, content: string): void {
  pair.native.terminal.write(content)
  pair.native.renderer.notifyWrite()

  flushFrame(pair)
}

async function expectPainted(pair: Fixture, submitted: number): Promise<Uint8Array> {
  expect(pair.native.renderer.metrics.submittedFrames).toBe(submitted)
  expect(pair.native.renderer.metrics.zigFrames).toBe(submitted)
  expect(pair.readRows).not.toHaveBeenCalled()
  const native = await displayedPixels(pair.native.canvas)
  expect(native.some((value, index) => index % 4 !== 3 && value > 0)).toBe(true)
  expect(pair.native.renderer.hasPendingFrame).toBe(false)
  return native
}

function cleanRowRecords(builder: ZigFrameBuilder) {
  const cells = builder.cellData
  const glyphs = builder.glyphData
  return [0, 2].map((row) => ({
    cells: new Uint8Array(cells.buffer, cells.byteOffset + row * 40 * 64, 40 * 64).slice(),
    glyphs: new Uint8Array(glyphs.buffer, glyphs.byteOffset + row * 40 * 96, 40 * 96).slice(),
  }))
}

for (const backend of ['webgpu', 'webgl2'] as const) {
  describe(`${backend} Zig Unicode compositor`, () => {
    it.each([...zigUnicodeFixtures, ...zigGlyphCollisionFixtures])(
      'submits $name entirely through Zig',
      async ({ content }) => {
        const pair = await nativeFixture(backend, content)
        flushFrame(pair)
        await expectPainted(pair, 1)
        expect(pair.builds.mock.results.at(-1)?.value).toBe(0)
        const glyphs = pair.native.state
          .readRows()[0]!
          .cells.filter((cell) => cell.text.trim().length > 0 && !cell.continuation)
        expect(glyphs.length).toBeGreaterThan(0)
      },
    )

    it.each(zigFrameCursorStyles)('matches a %s cursor on a wide head and tail', async (style) => {
      const pair = await nativeFixture(backend, '\x1b[?25h界é👩‍💻\x1b[1;1H')
      pair.native.renderer.setInactiveCursorStyle(style)
      flushFrame(pair)
      const head = await expectPainted(pair, 1)
      writeFrame(pair, '\x1b[1;2H')
      expect(pair.native.state.readCursor().viewport).toMatchObject({ x: 1, wideTail: true })
      const tailSubmissions = backend === 'webgpu' ? 2 : 1
      const tail = await expectPainted(pair, tailSubmissions)
      expect(tail).toEqual(head)
      writeFrame(pair, '\x1b[2;1H')
      const away = await expectPainted(pair, tailSubmissions + 1)
      expect(away).not.toEqual(tail)
    })

    it('matches selecting and clearing wide, combining and ZWJ glyphs without terminal writes', async () => {
      const pair = await nativeFixture(backend, '界é👩‍💻\r\nsecond')
      flushFrame(pair)
      const before = await expectPainted(pair, 1)

      expect(pair.native.terminal.selectAll()).toBe(true)
      pair.native.renderer.refreshRows(0, 2)

      flushFrame(pair)
      const selected = await expectPainted(pair, 2)
      expect(selected).not.toEqual(before)
      expect(pair.native.terminal.getSelection()).toContain('界é👩‍💻')

      pair.native.terminal.clearSelection()
      pair.native.renderer.refreshRows(0, 2)

      flushFrame(pair)
      expect(await expectPainted(pair, 3)).toEqual(before)
    })

    it.each([0, -1])(
      'keeps clean rows intact through wide missing-glyph retry and continuation erasure at baseline offset %i',
      async (baselineOffset) => {
        const font = fittedFont()
        const pair = await nativeFixture(backend, 'first\r\nsecond\r\nlast', {
          font: { ...font, deviceBaseline: font.deviceBaseline + baselineOffset },
        })
        flushFrame(pair)
        const before = await expectPainted(pair, 1)
        const builder = pair.builds.mock.contexts.at(-1) as ZigFrameBuilder
        const cleanRecords = cleanRowRecords(builder)
        pair.builds.mockClear()
        const uploaded = pair.native.renderer.metrics.uploadedBytes
        writeFrame(pair, '\x1b[2;1H\x1b[31;44m界é👩‍💻\x1b[0m')
        expect(pair.builds.mock.results.map((result) => result.value)).toEqual([2, 0])
        expect(pair.native.renderer.metrics.uploadedBytes - uploaded).toBe(2 * 40 * (64 + 96))
        const changed = await expectPainted(pair, 2)
        expect(changed).not.toEqual(before)
        // Glyph ink can cross screen-row edges; clean logical rows retain their exact records.
        expect(cleanRowRecords(builder)).toEqual(cleanRecords)
        writeFrame(pair, '\x1b[2;2H\x1b[33mX\x1b[0m')
        const erased = await expectPainted(pair, 3)
        expect(erased).not.toEqual(changed)
        expect(cleanRowRecords(builder)).toEqual(cleanRecords)
      },
    )

    it('matches intrinsic color glyph brush identity, selection and cursor recoloring', async () => {
      const fitted = fittedFont(24, 48, 32)
      const font = { ...fitted, settings: { ...fitted.settings, family: '"Zig Intrinsic Colors"' } }
      const rasterizer = new CanvasGlyphRasterizer({ font })
      expect(
        rasterizer.rasterize({
          cellSpan: 1,
          foreground: { r: 0, g: 255, b: 255 },
          italic: false,
          text: 'X',
          weight: 'normal',
        })?.kind,
      ).toBe('color')
      const pair = await nativeFixture(backend, '\x1b[36mXWBG\x1b[35mX\x1b[0m', { font })
      flushFrame(pair)
      const before = await expectPainted(pair, 1)

      pair.native.terminal.selectAll()
      pair.native.renderer.refreshRows(0, 2)

      flushFrame(pair)
      expect(await expectPainted(pair, 2)).not.toEqual(before)

      pair.native.terminal.clearSelection()
      pair.native.renderer.setInactiveCursorStyle('block')

      writeFrame(pair, '\x1b[?25h\x1b[1;1H')
      expect(await expectPainted(pair, 3)).not.toEqual(before)
    })

    it('keeps one grayscale descriptor through 1024 truecolor brushes with native records', async () => {
      const pair = await nativeFixture(backend, 'A')
      flushFrame(pair)
      for (let index = 0; index < 1024; index += 1) {
        writeFrame(pair, `\x1b[1;1H\x1b[38;2;${index & 255};${index >>> 8};91mA`)
        const builder = pair.builds.mock.contexts.at(-1) as ZigFrameBuilder
        expect(builder.glyphCount).toBe(1)
        expect(builder.glyphIndexRebuilds).toBe(0)
      }
      await expectPainted(pair, 1025)
    })

    it('records a visible Unicode specimen', async () => {
      const pair = await nativeFixture(backend, 'ASCII café ┌─┬─┐ \r\n界漢字 é ä́\r\n👩‍💻 👨‍👩‍👧‍👦 ❤️ 🏳️‍🌈')
      flushFrame(pair)
      await expectPainted(pair, 1)
      await page.screenshot({
        element: pair.fixture,
        path: `../../../.artifacts/zig-unicode-${backend}.png`,
        scale: 'css',
      })
    })
  })
}
