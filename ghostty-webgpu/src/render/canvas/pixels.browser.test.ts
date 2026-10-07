import { afterEach, expect, it, vi } from 'vitest'
import { page } from 'vitest/browser'
import { GhosttyRuntime } from '../../core/runtime.js'
import { fitTerminalFont } from '../../dom/fit.js'
import { canonicalRendererTheme, mergeRendererTheme } from '../config.js'
import { TestClock } from '../webgl/tests/fixture.js'
import { CanvasTerminalRenderer } from './renderer.js'
import { ComposeKernel } from './kernel.js'
import { CanvasRowPainter } from './painter.js'
import { StampTarget } from './stamp-target.js'
import { fittedFont } from './tests/font.js'
import { PixelFrame } from './pixel-frame.js'
import type { Canvas2dContext } from './painter.js'

const cleanups: (() => void)[] = []
afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup()
  vi.restoreAllMocks()
})

function frameFixture(offscreen: boolean, width: number, height: number, rowHeight = 1) {
  const canvas = offscreen ? new OffscreenCanvas(width, height) : document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d', { alpha: true, willReadFrequently: false })!
  const memory = new WebAssembly.Memory({ initial: Math.ceil((64 + width * height * 4) / 65536) })
  const output = { offset: 64, width, height, generation: 0 }
  const frame = new PixelFrame(memory, context)
  frame.bind(output, rowHeight)
  cleanups.push(() => frame.dispose())
  return { canvas, context, memory, output, frame }
}

function hostileState(context: Canvas2dContext) {
  context.globalAlpha = 0
  context.globalCompositeOperation = 'destination-out'
  context.filter = 'blur(3px)'
  context.shadowBlur = 3
  context.shadowColor = 'red'
  context.imageSmoothingEnabled = true
  context.setTransform(3, 0, 0, 3, 100, 100)
  context.beginPath()
  context.rect(0, 0, 0, 0)
  context.clip()
}

it.each([false, true])(
  'matches direct RGBA uploads through hostile target state, offscreen=%s',
  (offscreen) => {
    const { context, frame } = frameFixture(offscreen, 256, 256)
    const reference = frameFixture(offscreen, 256, 256).context
    const image = frame.getImage()
    for (let alpha = 0; alpha < 256; alpha++) {
      for (let value = 0; value < 256; value++) {
        image.data.set([value, value, value, alpha], (alpha * 256 + value) * 4)
      }
    }
    context.fillStyle = 'white'
    context.fillRect(0, 0, 256, 256)
    reference.fillStyle = 'white'
    reference.fillRect(0, 0, 256, 256)
    hostileState(context)
    hostileState(reference)
    const before = context.getTransform()
    reference.putImageData(image, 0, 0)
    frame.present()
    expect(context.getImageData(0, 0, 256, 256).data).toEqual(
      reference.getImageData(0, 0, 256, 256).data,
    )
    expect(context.getTransform()).toEqual(before)
    expect(context.globalAlpha).toBe(0)
    expect(context.globalCompositeOperation).toBe('destination-out')
    expect(context.filter).toBe('blur(3px)')
    expect(context.shadowBlur).toBe(3)
    expect(context.imageSmoothingEnabled).toBe(true)
    if (context instanceof CanvasRenderingContext2D)
      expect(context.getContextAttributes()).toMatchObject({
        alpha: true,
        willReadFrequently: false,
        desynchronized: false,
      })
  },
)

it.each([false, true])(
  'preserves row gaps, offsets, growth and staging disposal, offscreen=%s',
  (offscreen) => {
    const { context, frame, memory, output } = frameFixture(offscreen, 4, 6, 2)
    const reference = frameFixture(offscreen, 4, 6, 2).context
    frame.getImage().data.fill(255)
    frame.present()
    const image = frame.getImage()
    reference.putImageData(image, 0, 0)
    image.data.fill(0)
    frame.markRow(0)
    frame.markRow(2)
    const submit = vi.spyOn(context, 'putImageData')
    frame.present()
    reference.putImageData(image, 0, 0, 0, 0, 4, 2)
    reference.putImageData(image, 0, 0, 0, 4, 4, 2)
    expect(context.getImageData(0, 0, 4, 6).data).toEqual(reference.getImageData(0, 0, 4, 6).data)
    expect(submit.mock.calls.map(([rows, x, y]) => [rows.width, rows.height, x, y])).toEqual([
      [4, 2, 0, 0],
      [4, 2, 0, 4],
    ])
    memory.grow(1)
    const moved = { ...output, offset: 192, generation: 1 }
    frame.bind(moved, 2)
    frame.getImage().data.set(new Uint8ClampedArray([64, 128, 192, 128]))
    reference.putImageData(frame.getImage(), 0, 0)
    frame.present()
    expect(context.getImageData(0, 0, 4, 6).data).toEqual(reference.getImageData(0, 0, 4, 6).data)
    frame.bind({ ...moved, width: 2, height: 2 }, 1)
    frame.present()
    expect(frame.metrics.stagingPixelBytes).toBe(16)
    expect(frame.metrics.peakStagingPixelBytes).toBe(96)
    const allocated = frame.metrics.stagingImageAllocations
    frame.invalidate()
    expect(frame.metrics.stagingPixelBytes).toBe(0)
    frame.present()
    expect(frame.metrics.stagingImageAllocations).toBe(allocated + 2)
    frame.dispose()
    expect(frame.metrics.stagingPixelBytes).toBe(0)
    expect(frame.metrics.copiedFrameBytes).toBe(0)
    expect(() => frame.getImage()).toThrow('unavailable')
  },
)

it.each(['putImageData', 'getImageData'] as const)(
  'retains damage after a staging %s failure',
  (method) => {
    const { context, frame } = frameFixture(false, 4, 6, 2)
    frame.getImage().data.fill(255)
    frame.present()
    frame.getImage().data.fill(0)
    frame.markRow(0)
    frame.markRow(2)
    const target = vi.spyOn(context, 'putImageData')
    const failure = vi.spyOn(CanvasRenderingContext2D.prototype, method)
    failure.mockImplementationOnce(() => {
      throw new TypeError('external staging failure')
    })
    expect(() => frame.present()).toThrow('external staging failure')
    expect(target).not.toHaveBeenCalled()
    failure.mockRestore()
    frame.present()
    expect(target.mock.calls.map(([rows, x, y]) => [rows.width, rows.height, x, y])).toEqual([
      [4, 2, 0, 0],
      [4, 2, 0, 4],
    ])
  },
)

it('rejects memory growth during staging readback and retries from the current alias', () => {
  const { frame, memory, context } = frameFixture(false, 4, 6, 2)
  frame.getImage().data.fill(255)
  const readback = CanvasRenderingContext2D.prototype.getImageData
  const growth = vi.spyOn(CanvasRenderingContext2D.prototype, 'getImageData')
  growth.mockImplementationOnce(function (this: CanvasRenderingContext2D, ...args) {
    const result = readback.apply(this, args)
    memory.grow(1)
    return result
  })
  const target = vi.spyOn(context, 'putImageData')
  expect(() => frame.present()).toThrow('memory changed')
  expect(target).not.toHaveBeenCalled()
  growth.mockRestore()
  frame.present()
  expect(target).toHaveBeenCalledTimes(1)
  expect(frame.getImage().data.buffer).toBe(memory.buffer)
})

async function native(content: string, columns = 24, rows = 4) {
  const runtime = await GhosttyRuntime.create()
  cleanups.push(() => runtime.dispose())
  const terminal = runtime.createTerminal({ columns, rows })
  const state = runtime.createRenderState(terminal)
  terminal.write(content)
  state.update()
  return { terminal, state }
}

it.each([1, 2])(
  'composes real native owners at DPR %s with warm zero glyph raster work',
  async (dpr) => {
    const { state } = await native(
      '\x1b[?25l\x1b[?2027lÁ界👩‍💻\r\n\x1b[?2027h👩‍💻\x1b[1;3;2m faint\x1b[0m\r\n\x1b[4:3mwave\x1b[4:4mdots\x1b[4:5mdash\x1b[0m',
    )
    const font = fittedFont(dpr)
    const canvas = document.createElement('canvas')
    canvas.width = 24 * font.deviceCellWidth
    canvas.height = 4 * font.deviceCellHeight
    const output = canvas.getContext('2d')!
    const kernel = await ComposeKernel.create()
    const target = new StampTarget(kernel, output)
    cleanups.push(() => target.dispose())
    target.resize(canvas.width, canvas.height, font.deviceCellHeight)
    target.setFont(font)
    const painter = new CanvasRowPainter(
      target,
      font,
      canonicalRendererTheme(mergeRendererTheme({ minimumContrast: 1 })),
    )
    painter.resetContext(font)
    const draw = () => {
      for (const row of state.readRows()) {
        target.beginRow(row.y)
        painter.paint(row, undefined, canvas.width)
        target.finishRow(row.y)
      }
      target.present()
    }
    const rasterText = vi.spyOn(OffscreenCanvasRenderingContext2D.prototype, 'fillText')
    const readback = vi.spyOn(OffscreenCanvasRenderingContext2D.prototype, 'getImageData')
    const submit = vi.spyOn(output, 'putImageData')
    const glyphs = vi.spyOn(target, 'glyph')
    draw()
    expect(
      glyphs.mock.calls
        .filter(([input]) => input.text.includes('👩') || input.text === '💻')
        .map(([input, x, y]) => [input.text, input.cellSpan, x, y]),
    ).toEqual([
      ['👩‍', 2, 30 * dpr, 0],
      ['💻', 2, 50 * dpr, 0],
      ['👩‍💻', 2, 0, 20 * dpr],
    ])
    expect(rasterText.mock.calls.length).toBeGreaterThan(0)
    expect(readback.mock.calls.length).toBeGreaterThan(0)
    const first = target.frame.getImage()
    expect(first.data.buffer).toBe(kernel.memory.buffer)
    const exact = first.data.slice()
    const cache = { ...target.cache.metrics }
    rasterText.mockClear()
    readback.mockClear()
    submit.mockClear()
    draw()
    expect(rasterText).not.toHaveBeenCalled()
    expect(readback).not.toHaveBeenCalled()
    expect(target.cache.metrics.stampCopies).toBe(cache.stampCopies)
    expect(target.cache.metrics.stampCopiedBytes).toBe(cache.stampCopiedBytes)
    expect(target.frame.getImage().data).toEqual(exact)
    expect(submit).toHaveBeenCalledTimes(1)
    expect(submit.mock.calls[0]![0].data.buffer).not.toBe(kernel.memory.buffer)
    const reference = document.createElement('canvas')
    reference.width = canvas.width
    reference.height = canvas.height
    const referenceContext = reference.getContext('2d')!
    referenceContext.putImageData(first, 0, 0)
    expect(output.getImageData(0, 0, canvas.width, canvas.height).data).toEqual(
      referenceContext.getImageData(0, 0, canvas.width, canvas.height).data,
    )
    expect(target.frame.metrics.stagingReadbackBytes).toBe(exact.byteLength * 2)
    expect(target.frame.metrics.copiedFrameBytes).toBe(0)
    expect(target.metrics.rowCopyBytes).toBe(0)
    document.body.append(canvas)
    cleanups.push(() => canvas.remove())
    await page.screenshot({
      element: canvas,
      path: `../../../.artifacts/canvas-packed-dpr-${dpr}.png`,
      scale: 'css',
    })
  },
)

it('keeps default fillText free of compose downloads and explicit pixels on the same native state', async () => {
  const { state } = await native('\x1b[?25lhello 界')
  const options = { columns: 24, rows: 4, font: fittedFont(), renderState: state }
  const fetches = vi.spyOn(globalThis, 'fetch')
  const plainClock = new TestClock()
  const plain = await CanvasTerminalRenderer.create({
    ...options,
    canvas: document.createElement('canvas'),
    schedulerClock: plainClock,
  })
  cleanups.push(() => plain.dispose())
  plainClock.flushFrame()
  expect(plain.canvasPaintMode).toBe('fill-text')
  expect(fetches.mock.calls.some(([url]) => String(url).includes('canvas-compose'))).toBe(false)
  const pixelClock = new TestClock()
  const pixels = await CanvasTerminalRenderer.create({
    ...options,
    canvas: document.createElement('canvas'),
    schedulerClock: pixelClock,
    rendererMode: 'canvas2d-pixels',
  })
  cleanups.push(() => pixels.dispose())
  pixelClock.flushFrame()
  expect(pixels.canvasPaintMode).toBe('pixels')
  expect(fetches.mock.calls.filter(([url]) => String(url).includes('canvas-compose'))).toHaveLength(
    1,
  )
})

it('matches a fresh packed repaint after scroll, cursor, theme, DPR and atlas invalidation', async () => {
  const { state, terminal } = await native('\x1b[?25lone 界\r\ntwo é\r\nthree 😀\r\nfour')
  const font = fittedFont()
  const clock = new TestClock()
  const canvas = document.createElement('canvas')
  const renderer = await CanvasTerminalRenderer.create({
    canvas,
    columns: 24,
    rows: 4,
    font,
    renderState: state,
    schedulerClock: clock,
    rendererMode: 'canvas2d-pixels',
    theme: { minimumContrast: 1 },
  })
  cleanups.push(() => renderer.dispose())
  clock.flushFrame()
  const check = async (currentFont = font, theme = { minimumContrast: 1 }) => {
    const referenceCanvas = document.createElement('canvas')
    const referenceClock = new TestClock()
    const reference = await CanvasTerminalRenderer.create({
      canvas: referenceCanvas,
      columns: 24,
      rows: 4,
      font: currentFont,
      renderState: state,
      schedulerClock: referenceClock,
      rendererMode: 'canvas2d-pixels',
      theme,
    })
    try {
      referenceClock.flushFrame()
      expect(canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data).toEqual(
        referenceCanvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data,
      )
    } finally {
      reference.dispose()
    }
  }
  terminal.write('\r\nfive 👩‍💻')
  renderer.notifyWrite()
  clock.flushFrame()
  expect(renderer.pixelMetrics.bufferMoves).toBeGreaterThan(0)
  await check()
  terminal.write('\x1b[2;3H\x1b[?25h')
  renderer.notifyWrite()
  clock.flushFrame()
  await check()
  renderer.clearTextureAtlas()
  clock.flushFrame()
  await check()
  const theme = { minimumContrast: 1, foreground: { r: 19, g: 70, b: 200 } }
  renderer.setTheme(theme)
  clock.flushFrame()
  await check(font, theme)
  renderer.setFont(fittedFont(2))
  clock.flushFrame()
  await check(fittedFont(2), theme)
  expect(renderer.hasPendingFrame).toBe(false)
  expect(renderer.hasPendingTimer).toBe(false)
})

it('retains native scheduled damage when a pixel submission fails', async () => {
  const { state, terminal } = await native('\x1b[?25lhello')
  const clock = new TestClock()
  const canvas = document.createElement('canvas')
  const renderer = await CanvasTerminalRenderer.create({
    canvas,
    columns: 24,
    rows: 4,
    font: fittedFont(),
    renderState: state,
    schedulerClock: clock,
    rendererMode: 'canvas2d-pixels',
  })
  cleanups.push(() => renderer.dispose())
  clock.flushFrame()
  terminal.write('\x1b[2;1Hnew text')
  renderer.notifyWrite()
  const output = canvas.getContext('2d')!
  const failure = vi.spyOn(output, 'putImageData').mockImplementationOnce(() => {
    throw new TypeError('external canvas upload failure')
  })
  expect(() => clock.flushFrame()).toThrow('external canvas upload failure')
  failure.mockRestore()
  renderer.schedule()
  clock.flushFrame()
  expect(renderer.hasPendingFrame).toBe(false)
  expect(renderer.pixelMetrics.uploadedRegions).toBeGreaterThan(1)
})

it('rebuilds pixels and native font state after Canvas restoration events', async () => {
  const { state } = await native('\x1b[?25lrestore 界')
  const clock = new TestClock()
  const canvas = document.createElement('canvas')
  const renderer = await CanvasTerminalRenderer.create({
    canvas,
    columns: 24,
    rows: 4,
    font: fittedFont(),
    renderState: state,
    schedulerClock: clock,
    rendererMode: 'canvas2d-pixels',
  })
  cleanups.push(() => renderer.dispose())
  clock.flushFrame()
  const output = canvas.getContext('2d')!
  const expected = output.getImageData(0, 0, canvas.width, canvas.height).data
  canvas.dispatchEvent(new Event('contextlost', { cancelable: true }))
  renderer.refreshRows(0, 3)
  expect(() => clock.flushFrame()).toThrow('awaiting restoration')
  output.reset()
  canvas.dispatchEvent(new Event('contextrestored'))
  clock.flushFrame()
  expect(output.getImageData(0, 0, canvas.width, canvas.height).data).toEqual(expected)
})

it('rejects framebuffer reallocation during synchronous presentation and disposes its alias', async () => {
  const canvas = document.createElement('canvas')
  const output = canvas.getContext('2d')!
  const kernel = await ComposeKernel.create()
  const target = new StampTarget(kernel, output)
  cleanups.push(() => target.dispose())
  target.resize(24, 20, 20)
  const submit = output.putImageData.bind(output)
  vi.spyOn(output, 'putImageData').mockImplementation((...args) => {
    expect(() => target.resize(48, 20, 20)).toThrow('presentation')
    expect(() => target.dispose()).toThrow('presentation')
    submit(...args)
  })
  target.present()
  expect(target.frame.getImage().data.buffer).toBe(kernel.memory.buffer)
  target.dispose()
  expect(() => target.frame.getImage()).toThrow('unavailable')
})

it.each([
  ['canvas2d-fill-text', 0],
  ['canvas2d-fill-text', -1],
  ['canvas2d-pixels', 0],
  ['canvas2d-pixels', -1],
] as const)(
  'settles a clipped family owner in a tiny %s viewport with letter spacing %s',
  async (rendererMode, letterSpacing) => {
    const { state, terminal } = await native('\x1b[?25l\x1b[?2027h👨‍👩‍👧‍👦', 2, 1)
    const font = fitTerminalFont(
      document,
      {
        family: 'monospace',
        size: 16,
        weight: 400,
        boldWeight: 700,
        lineHeight: 1,
        letterSpacing,
      },
      1,
    )
    const canvas = document.createElement('canvas')
    const clock = new TestClock()
    let frames = 0
    const renderer = await CanvasTerminalRenderer.create({
      canvas,
      columns: 2,
      rows: 1,
      font,
      renderState: state,
      schedulerClock: clock,
      rendererMode,
      theme: {
        background: { r: 0, g: 0, b: 0 },
        foreground: { r: 255, g: 255, b: 255 },
        minimumContrast: 1,
      },
      onFrame: () => {
        frames += 1
      },
    })
    cleanups.push(() => renderer.dispose())
    expect(() => clock.flushFrame()).not.toThrow()
    expect(frames).toBe(1)
    expect(renderer.hasPendingFrame).toBe(false)
    const output = canvas.getContext('2d')!
    const first = output.getImageData(0, 0, canvas.width, canvas.height).data
    expect(first.some((channel, index) => index % 4 !== 3 && channel > 0)).toBe(true)
    const readback = vi.spyOn(OffscreenCanvasRenderingContext2D.prototype, 'getImageData')
    renderer.refreshRows(0, 0)
    clock.flushFrame()
    expect(frames).toBe(2)
    expect(renderer.hasPendingFrame).toBe(false)
    expect(output.getImageData(0, 0, canvas.width, canvas.height).data).toEqual(first)
    expect(readback).not.toHaveBeenCalled()
    readback.mockRestore()
    for (const columns of [8, 2]) {
      terminal.resize({ columns, rows: 1 })
      expect(() => renderer.resize({ columns, rows: 1 })).not.toThrow()
      expect(renderer.hasPendingFrame).toBe(false)
    }
    expect(frames).toBe(4)
    expect(output.getImageData(0, 0, canvas.width, canvas.height).data).toEqual(first)
    document.body.append(canvas)
    cleanups.push(() => canvas.remove())
    await page.screenshot({
      element: canvas,
      path: `../../../.artifacts/canvas-clipped-${rendererMode}-${letterSpacing}.png`,
      scale: 'css',
    })
  },
)

it('keeps brush colors independent of alpha and restored drawing state', async () => {
  const canvas = document.createElement('canvas')
  canvas.width = 40
  canvas.height = 20
  const output = canvas.getContext('2d')!
  const kernel = await ComposeKernel.create()
  const target = new StampTarget(kernel, output)
  cleanups.push(() => target.dispose())
  target.resize(40, 20, 20)
  target.fillStyle = 'rgb(18.4, 100.5, 230.6)'
  target.fillRect(0, 0, 1, 1)
  target.globalAlpha = 0.5
  target.fillRect(1, 0, 1, 1)
  target.globalAlpha = 1
  target.save()
  target.fillStyle = 'rgb(200, 19, 80)'
  target.fillRect(2, 0, 1, 1)
  target.restore()
  target.fillRect(3, 0, 1, 1)
  expect(target.frame.getImage().data.slice(0, 16)).toEqual(
    new Uint8ClampedArray([
      18, 101, 231, 255, 18, 101, 231, 128, 200, 19, 80, 255, 18, 101, 231, 255,
    ]),
  )
  const paint = () => {
    target.clearRect(0, 0, 40, 20)
    target.fillStyle = 'rgb(18.4, 100.5, 230.6)'
    target.fillRect(1.5, 1.5, 5, 5)
    target.strokeStyle = 'rgb(200, 19, 80)'
    target.strokeRect(10.5, 2.5, 5, 5)
    target.fillRect(20.5, 1.5, 5, 5)
  }
  paint()
  const cold = target.frame.getImage().data.slice()
  paint()
  expect(target.frame.getImage().data).toEqual(cold)
  target.invalidate()
  target.setFont(fittedFont())
  paint()
  expect(target.frame.getImage().data).toEqual(cold)
})

it('defers invalid brush errors until a draw and retries every failed draw', async () => {
  const canvas = document.createElement('canvas')
  const output = canvas.getContext('2d')!
  const kernel = await ComposeKernel.create()
  const target = new StampTarget(kernel, output)
  cleanups.push(() => target.dispose())
  target.resize(40, 20, 20)
  target.setFont(fittedFont())
  const pattern = output.createPattern(canvas, 'repeat')!
  const glyph = {
    cellSpan: 1,
    foreground: { r: 220, g: 220, b: 220 },
    italic: false,
    weight: 'normal',
    text: '',
  } as const
  for (const brush of ['red', 'rgb(1,2,3)', output.createLinearGradient(0, 0, 1, 1), pattern]) {
    expect(() => {
      target.fillStyle = brush
    }).not.toThrow()
    expect(() => target.fillRect(0, 0, 1, 1)).toThrow('Canvas pixel')
    expect(() => target.fillRect(0, 0, 1, 1)).toThrow('Canvas pixel')
    expect(() => target.glyph(glyph, 0, 0)).not.toThrow()
    expect(() => target.glyph({ ...glyph, text: 'A' }, 0, 0)).toThrow('Canvas pixel')
    expect(() => {
      target.strokeStyle = brush
    }).not.toThrow()
    expect(() => target.strokeRect(1, 1, 4, 4)).toThrow('Canvas pixel')
    expect(() => target.strokeRect(1, 1, 4, 4)).toThrow('Canvas pixel')
  }
  target.fillStyle = 'rgb(1, 2, 3)'
  target.fillRect(0, 0, 1, 1)
  expect(target.frame.getImage().data.slice(0, 4)).toEqual(new Uint8ClampedArray([1, 2, 3, 255]))
})

it('keeps packed glyph variants distinct and clears font-scoped stamps across memory growth', async () => {
  const canvas = document.createElement('canvas')
  canvas.width = 240
  canvas.height = 40
  const kernel = await ComposeKernel.create()
  const target = new StampTarget(kernel, canvas.getContext('2d')!)
  cleanups.push(() => target.dispose())
  target.resize(canvas.width, canvas.height, 20)
  target.setFont(fittedFont())
  target.fillStyle = 'rgb(220, 220, 220)'
  const common = {
    cellSpan: 1,
    foreground: { r: 220, g: 220, b: 220 },
    italic: false,
    text: 'W',
    weight: 'normal',
  } as const
  const variants = [
    common,
    { ...common, cellSpan: 2 },
    { ...common, italic: true },
    { ...common, weight: 'bold' as const },
    { ...common, text: 'M' },
    { ...common, foreground: { r: 19, g: 70, b: 200 } },
    { ...common, text: '👩‍💻' },
    { ...common, text: 'é' },
    { ...common, text: '["W",1]' },
  ]
  for (const input of variants) target.glyph(input, 0, 0)
  const cold = { ...target.cache.metrics }
  expect(cold.rasterCalls).toBe(variants.length)
  expect(cold.residentEntries).toBe(variants.length)
  const first = target.frame.getImage()
  const owned = first.data.slice()
  const memory = first.data.buffer
  kernel.memory.grow(1)
  expect(memory.byteLength).toBe(0)
  expect(owned.some((channel) => channel !== 0)).toBe(true)
  for (const input of variants) target.glyph(input, 0, 0)
  expect(target.cache.metrics.rasterCalls).toBe(cold.rasterCalls)
  expect(target.cache.metrics.stampCopies).toBe(cold.stampCopies)
  expect(target.cache.metrics.hits - cold.hits).toBe(variants.length)
  expect(target.frame.getImage().data.buffer).toBe(kernel.memory.buffer)
  const nextFont = { ...fittedFont(), settings: { ...fittedFont().settings, size: 18 } }
  target.setFont(nextFont)
  expect(target.cache.metrics.residentEntries).toBe(0)
  for (const input of variants) target.glyph(input, 0, 0)
  expect(target.cache.metrics.rasterCalls - cold.rasterCalls).toBe(variants.length)
  expect(target.cache.metrics.residentEntries).toBe(variants.length)
})
