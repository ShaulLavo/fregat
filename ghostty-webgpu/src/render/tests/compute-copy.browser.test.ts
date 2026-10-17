import { expect, it, onTestFinished, vi } from 'vitest'
import type { CellStyle, RenderCell, RenderRow } from '../../core/types.js'
import { fitTerminalFont } from '../../dom/fit.js'
import { GlyphAtlas } from '../atlas/atlas.js'
import { AtlasGpuTextures } from '../atlas/gpu-textures.js'
import type { GlyphBitmap, GlyphRasterizer } from '../atlas/types.js'
import { buildZigFrame } from '../atlas/zig-glyphs.js'
import { canonicalRendererTheme } from '../config.js'
import { defaultRendererTheme, type CursorState } from '../instances/types.js'
import { WebGpuTerminalRenderer } from '../renderer.js'
import type { RenderSchedulerClock } from '../scheduler.js'
import { WebGpuTextPass } from '../text-pass.js'
import { qualifyDeviceReplacement } from './adapter-qualification.js'
import { createNativeTestState } from './native-state.js'

const columns = 7
const rows = 12
const cellSize = 16
const width = columns * cellSize
const height = rows * cellSize
const bytesPerRow = Math.ceil((width * 4) / 256) * 256
const fullBands = Math.ceil(height / 8)
const hiddenCursor: CursorState = { style: 'outline', visible: false, x: 0, y: 0 }

function destroyResources(resources: { destroy(): void }[], device: GPUDevice): void {
  resources.reverse()
  for (const resource of resources) resource.destroy()
  device.destroy()
}

async function createGpu(skip: (reason: string) => never, enableStorage = true) {
  const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' })
  if (!adapter) throw new TypeError('WebGPU requestAdapter returned null')
  if (enableStorage && !adapter.features.has('bgra8unorm-storage')) {
    skip('This adapter lacks bgra8unorm-storage, required by the explicit BGRA compute-copy tests.')
  }
  const device = await adapter.requestDevice({
    requiredFeatures: enableStorage ? ['bgra8unorm-storage'] : [],
  })
  const resources: { destroy(): void }[] = []
  let validationOpen = true
  device.pushErrorScope('validation')
  async function validate(): Promise<void> {
    if (!validationOpen) return
    await device.queue.onSubmittedWorkDone()
    expect(await device.popErrorScope()).toBeNull()
    validationOpen = false
  }
  onTestFinished(async () => {
    try {
      await validate()
    } finally {
      destroyResources(resources, device)
    }
  })
  function own<T extends { destroy(): void }>(resource: T): T {
    resources.push(resource)
    return resource
  }
  return { adapter, device, own, validate }
}

type TestGpu = Awaited<ReturnType<typeof createGpu>>

function traceGpu() {
  const dispatch = vi.spyOn(GPUComputePassEncoder.prototype, 'dispatchWorkgroups')
  const copy = vi.spyOn(GPUCommandEncoder.prototype, 'copyTextureToTexture')
  const render = vi.spyOn(GPUCommandEncoder.prototype, 'beginRenderPass')
  onTestFinished(() => {
    dispatch.mockRestore()
    copy.mockRestore()
    render.mockRestore()
  })
  function reset(): void {
    dispatch.mockClear()
    copy.mockClear()
    render.mockClear()
  }
  function read() {
    return {
      groups: Array.from(dispatch.mock.calls, ([x, y = 1, z = 1]) => ({ x, y, z })),
      renderPasses: render.mock.calls.length,
      copies: Array.from(copy.mock.calls, ([source, destination]) => ({
        format: source.texture.format,
        destinationFormat: destination.texture.format,
        sourceUsage: source.texture.usage,
      })),
    }
  }
  return { read, reset }
}

type Work = ReturnType<ReturnType<typeof traceGpu>['read']>

function expectCopy(work: Work, format: GPUTextureFormat = 'bgra8unorm'): void {
  expect(work.renderPasses).toBe(0)
  expect(work.copies).toEqual([
    {
      format,
      destinationFormat: format,
      sourceUsage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.COPY_SRC,
    },
  ])
}

function expectBands(work: Work, bands: number, pixelWidth = width): void {
  const expected = bands === 0 ? [] : [{ x: Math.ceil(pixelWidth / 8), y: bands, z: 1 }]
  expect(work.groups).toEqual(expected)
}

function bandCount(work: Work): number {
  return work.groups.reduce((total, group) => total + group.y, 0)
}

function expectPixels(actual: Uint8Array, expected: Uint8Array): void {
  expect(actual.length).toBe(expected.length)
  let maximum = 0
  let worst = 0
  for (let index = 0; index < actual.length; index += 1) {
    const difference = Math.abs(actual[index]! - expected[index]!)
    if (difference <= maximum) continue
    maximum = difference
    worst = index
  }
  expect(
    maximum,
    `channel ${worst}: actual ${actual[worst]}, expected ${expected[worst]}`,
  ).toBeLessThanOrEqual(1)
}

function pixel(pixels: Uint8Array, x: number, y: number): Uint8Array {
  return pixels.slice((y * width + x) * 4, (y * width + x + 1) * 4)
}

function unpadPixels(mapped: Uint8Array): Uint8Array {
  const pixels = new Uint8Array(width * height * 4)
  for (let y = 0; y < height; y += 1) {
    pixels.set(mapped.subarray(y * bytesPerRow, y * bytesPerRow + width * 4), y * width * 4)
  }
  return pixels
}

function createTarget(gpu: TestGpu, computeCopy: boolean) {
  const pass = gpu.own(
    new WebGpuTextPass({
      cellHeight: cellSize,
      cellWidth: cellSize,
      columns,
      device: gpu.device,
      experimentalCompositor: computeCopy ? 'compute-copy' : undefined,
      format: 'bgra8unorm',
      height,
      instanceCount: columns * rows,
      width,
    }),
  )
  const output = gpu.own(
    gpu.device.createBuffer({
      size: bytesPerRow * height,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    }),
  )
  async function capture(accept = true): Promise<Uint8Array> {
    // Every presentation gets a fresh destination, including frames with no dirty work.
    const texture = gpu.device.createTexture({
      format: 'bgra8unorm',
      size: [width, height],
      usage:
        GPUTextureUsage.COPY_DST | GPUTextureUsage.COPY_SRC | GPUTextureUsage.RENDER_ATTACHMENT,
    })
    let mapped = false
    try {
      const copy = { buffer: output, bytesPerRow, size: { width, height }, texture }
      gpu.device.queue.submit([pass.encode(computeCopy ? texture : texture.createView(), copy)])
      if (accept) pass.acceptFrame()
      await output.mapAsync(GPUMapMode.READ)
      mapped = true
      return unpadPixels(new Uint8Array(output.getMappedRange()))
    } finally {
      if (mapped) output.unmap()
      texture.destroy()
    }
  }
  return { capture, pass }
}

function cell(
  x: number,
  overrides: Omit<Partial<RenderCell>, 'style'> & { style?: Partial<CellStyle> } = {},
): RenderCell {
  const style = overrides.style
  return {
    continuation: false,
    selected: false,
    text: '',
    x,
    ...overrides,
    style: style
      ? {
          blink: false,
          bold: false,
          faint: false,
          invisible: false,
          inverse: false,
          italic: false,
          overline: false,
          strikethrough: false,
          underline: 0,
          ...style,
        }
      : undefined,
  }
}

function row(y: number, cells: readonly RenderCell[]): RenderRow {
  return { cells, dirty: true, y }
}

function bitmap(
  kind: 'color' | 'grayscale',
  width: number,
  height: number,
  offsetX = 0,
  offsetY = 0,
): GlyphBitmap {
  const pixels = new Uint8Array(width * height * (kind === 'color' ? 4 : 1)).fill(128)
  if (kind === 'color') {
    for (let offset = 0; offset < pixels.length; offset += 4) pixels.set([0, 255, 0, 128], offset)
  }
  return { height, kind, offsetX, offsetY, pixels, width }
}

const rasterizer: GlyphRasterizer = {
  rasterize(input) {
    if (!input.text.trim()) return undefined
    if (input.text === 'A') return bitmap('grayscale', 96, 64, -64, 0)
    if (input.text === 'B') return bitmap('grayscale', 96, 64, 0, -48)
    if (input.text === 'C') return bitmap('color', 80, 64, -64, -32)
    return bitmap('grayscale', cellSize, cellSize)
  },
}

async function createComparison(
  gpu: TestGpu,
  renderRows: readonly RenderRow[],
  stableRows = false,
) {
  const native = await createNativeTestState(columns, rows)
  native.writeRows(renderRows)
  const builder = native.state.createFrameBuilder(columns, rows)
  onTestFinished(() => builder.dispose())
  const atlas = new GlyphAtlas({ pageHeight: 512, pageWidth: 512 })
  const textures = gpu.own(new AtlasGpuTextures(gpu.device, atlas.textureLayout))
  const reference = createTarget(gpu, false)
  const candidate = createTarget(gpu, true)
  reference.pass.syncAtlas(textures)
  candidate.pass.syncAtlas(textures)
  const trace = traceGpu()
  const theme = canonicalRendererTheme(defaultRendererTheme)
  let previousCursor = hiddenCursor
  function prepare(full: boolean, cursor = hiddenCursor): void {
    native.state.update()
    const overlayRows = new Set<number>()
    if (previousCursor.visible) overlayRows.add(previousCursor.y)
    if (cursor.visible) overlayRows.add(cursor.y)
    previousCursor = cursor
    expect(
      buildZigFrame(builder, atlas, rasterizer, {
        cellHeight: cellSize,
        cellWidth: cellSize,
        cursor,
        full,
        overlayRows,
        stableRows,
        theme,
      }),
    ).toBe(0)
    textures.sync(atlas.consumeUploads())
    const updates = builder.changedRanges()
    reference.pass.uploadFrame(builder, updates)
    candidate.pass.uploadFrame(builder, updates)
  }
  async function capture(accept = true) {
    trace.reset()
    const pixels = await candidate.capture(accept)
    const work = trace.read()
    expectCopy(work)
    expectPixels(pixels, await reference.capture())
    return { pixels, work }
  }
  async function render(full: boolean, cursor = hiddenCursor) {
    prepare(full, cursor)
    const frame = await capture()
    native.state.acknowledge()
    return frame
  }
  return { builder, candidate, capture, native, prepare, render }
}

it('copies owned BGRA storage pixels with arbitrary ordered overhang, color and faint alpha', async ({
  skip,
}) => {
  const gpu = await createGpu(skip)
  expect(gpu.device.features.has('bgra8unorm-storage')).toBe(true)
  const fixture = await createComparison(gpu, [
    row(0, [cell(5, { text: 'A', foreground: { r: 255, g: 0, b: 0 } })]),
    row(1, [cell(2, { background: { r: 31, g: 79, b: 113 }, style: { underline: 3 } })]),
    row(2, [cell(6, { text: 'C', style: { faint: true } })]),
    row(3, [cell(0, { text: 'B', foreground: { r: 0, g: 0, b: 255 } })]),
  ])
  const frame = await fixture.render(true)
  expectBands(frame.work, fullBands)
  expectPixels(pixel(frame.pixels, 40, 8), new Uint8Array([128, 32, 48, 208]))
  expect(pixel(frame.pixels, 40, 24)[3]).toBe(255)
  expect(pixel(frame.pixels, 4, 8)[3]).toBeGreaterThan(0)
  expect(pixel(frame.pixels, 108, 60)[3]).toBeGreaterThan(0)
  expect(fixture.candidate.pass.drawCount).toBe(0)
  expect(fixture.candidate.pass.metrics.textureCopies).toBe(1)
})

it('dispatches sparse bands for edits and cursor movement while retaining clean BGRA pixels', async ({
  skip,
}) => {
  const gpu = await createGpu(skip)
  const fixture = await createComparison(
    gpu,
    Array.from({ length: rows }, (_, y) =>
      row(y, [cell(0, { background: { r: 30 + y, g: 50, b: 80 } }), cell(2, { text: 'X' })]),
    ),
  )
  const initial = await fixture.render(true, { style: 'outline', visible: true, x: 4, y: 2 })
  fixture.native.writeRows([
    row(6, [cell(0, { background: { r: 10, g: 190, b: 60 } }), cell(2, { text: 'Y' })]),
  ])
  const edited = await fixture.render(false, { style: 'block', visible: true, x: 3, y: 6 })
  expect(bandCount(edited.work)).toBeGreaterThan(0)
  expect(bandCount(edited.work)).toBeLessThan(fullBands)
  expect(edited.pixels.slice(0, width * cellSize * 4)).toEqual(
    initial.pixels.slice(0, width * cellSize * 4),
  )
  const hidden = await fixture.render(false)
  expect(bandCount(hidden.work)).toBeGreaterThan(0)
  expect(bandCount(hidden.work)).toBeLessThan(fullBands)
  expect(hidden.pixels).not.toEqual(edited.pixels)
})

it('recomputes old and new overhang reach on partial replacement and removes old ink', async ({
  skip,
}) => {
  const gpu = await createGpu(skip)
  const fixture = await createComparison(gpu, [row(6, [cell(3, { text: 'X' })])])
  await fixture.render(true)
  fixture.native.writeRows([row(6, [cell(6, { text: 'C' })])])
  const expanded = await fixture.render(false)
  expect(bandCount(expanded.work)).toBeLessThan(fullBands)
  expect(pixel(expanded.pixels, 40, 72)[3]).toBeGreaterThan(0)
  fixture.native.writeRows([row(6, [])])
  const removed = await fixture.render(false)
  expect(bandCount(removed.work)).toBeGreaterThan(0)
  expect(bandCount(removed.work)).toBeLessThan(fullBands)
  expect(removed.pixels.every((channel) => channel === 0)).toBe(true)
})

it('copies unchanged accepted pixels without dispatch and preserves dirty work until acceptance', async ({
  skip,
}) => {
  const gpu = await createGpu(skip)
  const fixture = await createComparison(gpu, [row(6, [cell(3, { text: 'X' })])])
  const initial = await fixture.render(true)
  const unchanged = await fixture.render(false)
  expectBands(unchanged.work, 0)
  expect(unchanged.pixels).toEqual(initial.pixels)
  fixture.native.writeRows([row(6, [cell(3, { text: 'Y', foreground: { r: 250, g: 40, b: 90 } })])])
  fixture.prepare(false)
  const unaccepted = await fixture.capture(false)
  const retried = await fixture.capture()
  expect(bandCount(unaccepted.work)).toBeGreaterThan(0)
  expect(retried.work.groups).toEqual(unaccepted.work.groups)
  expect(retried.pixels).toEqual(unaccepted.pixels)
  const accepted = await fixture.capture()
  expectBands(accepted.work, 0)
  expect(accepted.pixels).toEqual(retried.pixels)
})

it('invalidates every band on native row-ring changes and scrolling wrap', async ({ skip }) => {
  const gpu = await createGpu(skip)
  const fixture = await createComparison(
    gpu,
    Array.from({ length: rows }, (_, y) => row(y, [cell(y % columns, { text: 'X' })])),
    true,
  )
  await fixture.render(true)
  let wrapped = false
  for (let index = 0; index < rows + 1; index += 1) {
    fixture.native.terminal.write(`\x1b[${rows};1H\r\n${index % 2 === 0 ? 'C' : 'B'}`)
    const frame = await fixture.render(false)
    expectBands(frame.work, fullBands)
    wrapped ||= fixture.builder.rowOffset !== 0
  }
  expect(wrapped).toBe(true)
  for (const input of ['\x1b[2;12r\x1b[12;1H\nA', '\x1b[2;1H\x1b[L', '\x1b[M']) {
    fixture.native.terminal.write(input)
    const frame = await fixture.render(false)
    if (fixture.builder.rowChanges !== 0) expectBands(frame.work, fullBands)
  }
})

it('rejects explicit BGRA compute-copy on a device that did not enable storage support', async ({
  skip,
}) => {
  const gpu = await createGpu(skip, false)
  expect(gpu.device.features.has('bgra8unorm-storage')).toBe(false)
  expect(
    () =>
      new WebGpuTextPass({
        cellHeight: cellSize,
        cellWidth: cellSize,
        columns,
        device: gpu.device,
        experimentalCompositor: 'compute-copy',
        format: 'bgra8unorm',
        height,
        instanceCount: columns * rows,
        width,
      }),
  ).toThrow('bgra8unorm-storage')
})

class ManualClock implements RenderSchedulerClock {
  private next = 0
  private readonly frames = new Map<number, () => void>()
  cancelFrame(handle: number): void {
    this.frames.delete(handle)
  }
  clearTimer(): void {}
  requestFrame(callback: () => void): number {
    this.next += 1
    this.frames.set(this.next, callback)
    return this.next
  }
  setTimer(): number {
    return 0
  }
  flush(): void {
    const frames = Array.from(this.frames.values())
    this.frames.clear()
    for (const callback of frames) callback()
  }
}

async function createRenderer(
  gpu: TestGpu,
  computeCopy: boolean,
  deviceFactory: () => Promise<GPUDevice> = async () => gpu.device,
) {
  const native = await createNativeTestState(columns, rows)
  native.terminal.write('\x1b[31mfirst\x1b[0m\r\n\x1b[4:3msecond\x1b[0m')
  const canvas = new OffscreenCanvas(1, 1)
  const clock = new ManualClock()
  const renderer = await WebGpuTerminalRenderer.create({
    canvas,
    columns,
    cursorBlink: false,
    deviceFactory,
    experimentalCompositor: computeCopy ? 'compute-copy' : undefined,
    font: fitTerminalFont(
      document,
      {
        boldWeight: 700,
        family: 'monospace',
        letterSpacing: 0,
        lineHeight: 1.2,
        size: 12,
        weight: 400,
      },
      1,
    ),
    renderState: native.state,
    rows,
    schedulerClock: clock,
  })
  gpu.own({ destroy: () => renderer.dispose() })
  return { canvas, clock, native, renderer }
}

async function compareRenderers(
  candidate: Awaited<ReturnType<typeof createRenderer>>,
  reference: Awaited<ReturnType<typeof createRenderer>>,
): Promise<void> {
  const [actual, expected] = await Promise.all([
    candidate.renderer.capturePixels(),
    reference.renderer.capturePixels(),
  ])
  expectPixels(actual, expected)
}

it('retains same-format compute-copy through renderer geometry recreation', async ({ skip }) => {
  const gpu = await createGpu(skip)
  const reference = await createRenderer(gpu, false)
  const candidate = await createRenderer(gpu, true)
  const trace = traceGpu()
  reference.clock.flush()
  trace.reset()
  candidate.clock.flush()
  expectCopy(trace.read(), navigator.gpu.getPreferredCanvasFormat())
  await compareRenderers(candidate, reference)
  for (const grid of [
    { columns: 9, rows: 5 },
    { columns: 4, rows: 2 },
    { columns, rows },
  ]) {
    reference.native.terminal.resize(grid)
    reference.renderer.resize(grid)
    reference.clock.flush()
    candidate.native.terminal.resize(grid)
    trace.reset()
    candidate.renderer.resize(grid)
    candidate.clock.flush()
    const work = trace.read()
    expectCopy(work, navigator.gpu.getPreferredCanvasFormat())
    expectBands(work, Math.ceil(candidate.canvas.height / 8), candidate.canvas.width)
    await compareRenderers(candidate, reference)
  }
})

it('restores compute-copy on a qualified replacement with explicitly enabled BGRA storage', async ({
  skip,
}) => {
  const gpu = await createGpu(skip)
  const qualification = qualifyDeviceReplacement(gpu.adapter.info, navigator.userAgent)
  if (qualification.kind === 'skip') skip(qualification.reason)
  if (qualification.kind === 'unresolved') expect.fail(qualification.reason)
  const replacement = await createGpu(skip)
  let calls = 0
  const fixture = await createRenderer(gpu, true, async () => {
    calls += 1
    return calls === 1 ? gpu.device : replacement.device
  })
  replacement.own({ destroy: () => fixture.renderer.dispose() })
  fixture.clock.flush()
  const before = await fixture.renderer.capturePixels()
  await gpu.validate()
  await fixture.renderer.simulateDeviceLoss()
  const trace = traceGpu()
  trace.reset()
  fixture.clock.flush()
  expect(calls).toBe(2)
  expect(replacement.device.features.has('bgra8unorm-storage')).toBe(true)
  expectCopy(trace.read(), navigator.gpu.getPreferredCanvasFormat())
  expectBands(trace.read(), Math.ceil(fixture.canvas.height / 8), fixture.canvas.width)
  expectPixels(await fixture.renderer.capturePixels(), before)
})

async function validateDevice(device: GPUDevice): Promise<void> {
  await device.queue.onSubmittedWorkDone()
  expect(await device.popErrorScope()).toBeNull()
}

async function disposeRenderers(renderers: readonly WebGpuTerminalRenderer[]): Promise<void> {
  await Promise.all(renderers.map((renderer) => renderer.dispose()))
}

it('submits shared compute-copy surfaces before a peer reenters with a font change', async ({
  skip,
}) => {
  const adapter = await navigator.gpu.requestAdapter()
  if (!adapter) throw new TypeError('WebGPU requestAdapter returned null')
  if (!adapter.features.has('bgra8unorm-storage'))
    skip('Shared BGRA compute-copy requires bgra8unorm-storage.')
  const devices = new Set<GPUDevice>()
  const renderers: WebGpuTerminalRenderer[] = []
  const requestDevice = GPUAdapter.prototype.requestDevice
  const requests = vi
    .spyOn(GPUAdapter.prototype, 'requestDevice')
    .mockImplementation(async function (this: GPUAdapter, options) {
      const device = await requestDevice.call(this, options)
      device.pushErrorScope('validation')
      devices.add(device)
      return device
    })
  onTestFinished(async () => {
    try {
      await Promise.all(Array.from(devices, validateDevice))
    } finally {
      await disposeRenderers(renderers)
      requests.mockRestore()
    }
  })
  const sources = await Promise.all([
    createNativeTestState(columns, rows),
    createNativeTestState(columns, rows),
  ])
  sources[0].terminal.write('first')
  sources[1].terminal.write('second')
  const canvases = [new OffscreenCanvas(1, 1), new OffscreenCanvas(1, 1)]
  const font = fitTerminalFont(
    document,
    {
      boldWeight: 700,
      family: 'monospace',
      letterSpacing: 0,
      lineHeight: 1.2,
      size: 12,
      weight: 400,
    },
    1,
  )
  const largerFont = {
    ...font,
    cssCellWidth: font.cssCellWidth + 1,
    deviceCellWidth: font.deviceCellWidth + 1,
  }
  const captures: { index: number; width: number; height: number; pixels: Promise<Uint8Array> }[] =
    []
  function captureSurface(index: number): void {
    const renderer = renderers[index]
    if (!renderer) return
    captures.push({
      index,
      width: canvases[index]!.width,
      height: canvases[index]!.height,
      pixels: renderer.capturePixels(),
    })
  }
  let armed = false
  let reentered = false
  const readCursor = sources[1].state.readCursor.bind(sources[1].state)
  sources[1].state.readCursor = () => {
    if (armed) {
      armed = false
      reentered = true
      renderers[0]!.setFont(largerFont)
    }
    return readCursor()
  }
  await Promise.all(
    sources.map(async (source, index) => {
      const renderer = await WebGpuTerminalRenderer.create({
        canvas: canvases[index]!,
        columns,
        cursorBlink: false,
        experimentalCompositor: 'compute-copy',
        font,
        renderState: source.state,
        rows,
        onFrame: () => captureSurface(index),
      })
      renderers[index] = renderer
    }),
  )
  await expect
    .poll(() => renderers.every((renderer) => renderer.metrics.submittedFrames >= 1))
    .toBe(true)
  expect(requests).toHaveBeenCalledOnce()
  expect(Array.from(devices).every((device) => device.features.has('bgra8unorm-storage'))).toBe(
    true,
  )
  const context = canvases[0]!.getContext('webgpu')
  if (!context) throw new TypeError('WebGPU canvas context unavailable')
  const events: string[] = []
  const submit = GPUQueue.prototype.submit
  const submissions = vi.spyOn(GPUQueue.prototype, 'submit').mockImplementation(function (
    this: GPUQueue,
    commands,
  ) {
    events.push('submit')
    submit.call(this, commands)
  })
  const configureContext = context.configure.bind(context)
  const configure = vi.spyOn(context, 'configure').mockImplementation((options) => {
    events.push('configure')
    configureContext(options)
  })
  onTestFinished(() => {
    submissions.mockRestore()
    configure.mockRestore()
  })
  const trace = traceGpu()
  const before = renderers[0]!.metrics.submittedFrames
  await Promise.all(captures.map((capture) => capture.pixels))
  captures.length = 0
  armed = true
  sources.forEach((source) => source.terminal.write('\x1b[1;1HX'))
  renderers.forEach((renderer) => renderer.notifyWrite())
  await expect
    .poll(() => reentered && renderers[0]!.metrics.submittedFrames >= before + 2)
    .toBe(true)
  expect(events.indexOf('submit')).toBeLessThan(events.indexOf('configure'))
  const work = trace.read()
  expect(work.renderPasses).toBe(0)
  expect(work.copies.length).toBeGreaterThanOrEqual(3)
  expect(work.copies.every((copy) => copy.format === copy.destinationFormat)).toBe(true)
  const pixels = await Promise.all(captures.map((capture) => capture.pixels))
  const targetCaptures = captures.filter((capture) => capture.index === 0)
  expect(targetCaptures.map((capture) => capture.width)).toEqual([
    columns * font.deviceCellWidth,
    columns * largerFont.deviceCellWidth,
  ])
  for (const [index, capture] of captures.entries()) {
    expect(pixels[index]!.length).toBe(capture.width * capture.height * 4)
    expect(
      pixels[index]!.some((channel, channelIndex) => channelIndex % 4 === 3 && channel > 0),
    ).toBe(true)
    expect(
      pixels[index]!.subarray(capture.width * font.deviceCellHeight * 4).every(
        (channel) => channel === 0,
      ),
    ).toBe(true)
  }
})
