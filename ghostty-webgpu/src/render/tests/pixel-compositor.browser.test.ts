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
import { WebGpuTextPass, type WebGpuTextPassOptions } from '../text-pass.js'
import { createNativeTestState } from './native-state.js'
import { qualifyDeviceReplacement } from './adapter-qualification.js'
import { limitDeviceBuffers } from './device-limits.js'

type Compositor = NonNullable<WebGpuTextPassOptions['experimentalCompositor']>
const compositors: readonly Compositor[] = ['compute', 'fullscreen-fragment', 'compute-copy']
const columns = 7
const rows = 4
const cellSize = 16
const width = columns * cellSize
const height = rows * cellSize
const bytesPerRow = Math.ceil((width * 4) / 256) * 256
const hiddenCursor: CursorState = { style: 'outline', visible: false, x: 0, y: 0 }

function destroyResources(owned: { destroy(): void }[], device: GPUDevice): void {
  owned.reverse()
  for (const resource of owned) resource.destroy()
  device.destroy()
}

async function createGpu() {
  const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' })
  if (!adapter) throw new Error('WebGPU requestAdapter returned null')
  const requiredFeatures: GPUFeatureName[] = adapter.features.has('bgra8unorm-storage')
    ? ['bgra8unorm-storage']
    : []
  const device = await adapter.requestDevice({ requiredFeatures })
  const owned: { destroy(): void }[] = []
  let scopeOpen = true
  device.pushErrorScope('validation')
  async function validate(): Promise<void> {
    if (!scopeOpen) return
    await device.queue.onSubmittedWorkDone()
    expect(await device.popErrorScope()).toBeNull()
    scopeOpen = false
  }
  onTestFinished(async () => {
    try {
      await validate()
    } finally {
      destroyResources(owned, device)
    }
  })
  function own<T extends { destroy(): void }>(resource: T): T {
    owned.push(resource)
    return resource
  }
  return { adapter, device, own, validate }
}

type TestGpu = Awaited<ReturnType<typeof createGpu>>

function unpadPixels(mapped: Uint8Array): Uint8Array {
  const pixels = new Uint8Array(width * height * 4)
  for (let row = 0; row < height; row += 1) {
    pixels.set(mapped.subarray(row * bytesPerRow, row * bytesPerRow + width * 4), row * width * 4)
  }
  return pixels
}

function createTarget(gpu: TestGpu, experimentalCompositor?: Compositor) {
  const pass = gpu.own(
    new WebGpuTextPass({
      cellHeight: cellSize,
      cellWidth: cellSize,
      columns,
      device: gpu.device,
      experimentalCompositor,
      format: 'rgba8unorm',
      height,
      instanceCount: columns * rows,
      width,
    }),
  )
  const texture = gpu.own(
    gpu.device.createTexture({
      format: 'rgba8unorm',
      size: [width, height],
      usage:
        GPUTextureUsage.COPY_SRC | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
    }),
  )
  const output = gpu.own(
    gpu.device.createBuffer({
      size: bytesPerRow * height,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    }),
  )
  async function capture(): Promise<Uint8Array> {
    const copy = {
      buffer: output,
      bytesPerRow,
      size: { width, height },
      texture,
    }
    if (experimentalCompositor) {
      gpu.device.queue.submit([pass.encode(texture, copy)])
      pass.acceptFrame()
    }
    if (!experimentalCompositor) pass.submit(texture, copy)
    await output.mapAsync(GPUMapMode.READ)
    try {
      return unpadPixels(new Uint8Array(output.getMappedRange()))
    } finally {
      output.unmap()
    }
  }
  return { capture, pass }
}

function expectMatchingPixels(actual: Uint8Array, expected: Uint8Array, context = 'pixels'): void {
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
    `${context}, channel ${worst}: actual ${actual[worst]}, expected ${expected[worst]}`,
  ).toBeLessThanOrEqual(1)
}

function pixel(pixels: Uint8Array, x: number, y: number): number[] {
  const offset = (y * width + x) * 4
  return Array.from(pixels.subarray(offset, offset + 4))
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

function grayscale(width: number, height: number, offsetX = 0, offsetY = 0): GlyphBitmap {
  return {
    height,
    kind: 'grayscale',
    offsetX,
    offsetY,
    pixels: new Uint8Array(width * height).fill(128),
    width,
  }
}

function colorBitmap(width: number, height: number, offsetX = 0, offsetY = 0): GlyphBitmap {
  const pixels = new Uint8Array(width * height * 4)
  for (let offset = 0; offset < pixels.length; offset += 4) pixels.set([0, 255, 0, 128], offset)
  return { height, kind: 'color', offsetX, offsetY, pixels, width }
}

const overhangRasterizer: GlyphRasterizer = {
  rasterize(input) {
    if (!input.text.trim()) return undefined
    if (input.text === 'A') return grayscale(96, 64, -64, 0)
    if (input.text === 'B') return grayscale(96, 64, 0, -48)
    if (input.text === 'C') return colorBitmap(80, 64, -64, -32)
    return grayscale(cellSize, cellSize)
  },
}

const cellRasterizer: GlyphRasterizer = {
  rasterize(input) {
    if (!input.text.trim()) return undefined
    if (input.text === 'C') return colorBitmap(cellSize, cellSize)
    return grayscale(cellSize, cellSize)
  },
}

async function createComparison(
  mode: Compositor,
  renderRows: readonly RenderRow[],
  rasterizer: GlyphRasterizer,
  stableRows = false,
) {
  const gpu = await createGpu()
  const native = await createNativeTestState(columns, rows)
  native.writeRows(renderRows)
  const builder = native.state.createFrameBuilder(columns, rows)
  onTestFinished(() => builder.dispose())
  const atlas = new GlyphAtlas({ pageHeight: 512, pageWidth: 512 })
  const textures = gpu.own(new AtlasGpuTextures(gpu.device, atlas.textureLayout))
  const reference = createTarget(gpu)
  const candidate = createTarget(gpu, mode)
  reference.pass.syncAtlas(textures)
  candidate.pass.syncAtlas(textures)
  const theme = canonicalRendererTheme({
    ...defaultRendererTheme,
    cursor: { r: 250, g: 210, b: 30 },
    cursorText: { r: 20, g: 40, b: 240 },
    minimumContrast: 1,
    selectionBackground: { r: 40, g: 10, b: 210 },
  })
  async function render(full: boolean, cursor = hiddenCursor): Promise<Uint8Array> {
    native.state.update()
    expect(
      buildZigFrame(builder, atlas, rasterizer, {
        cellHeight: cellSize,
        cellWidth: cellSize,
        cursor,
        full,
        overlayRows: cursor.visible ? new Set([cursor.y]) : new Set(),
        stableRows,
        theme,
      }),
    ).toBe(0)
    textures.sync(atlas.consumeUploads())
    const updates = builder.changedRanges()
    reference.pass.uploadFrame(builder, updates)
    candidate.pass.uploadFrame(builder, updates)
    const expected = await reference.capture()
    const actual = await candidate.capture()
    expectMatchingPixels(actual, expected)
    native.state.acknowledge()
    return actual
  }
  return { builder, candidate, native, reference, render }
}

it.each(compositors)(
  '%s preserves ordered glyph overhang across distant columns and rows',
  async (mode) => {
    const fixture = await createComparison(
      mode,
      [
        row(0, [cell(5, { text: 'A', foreground: { r: 255, g: 0, b: 0 } })]),
        row(1, [
          cell(2, { background: { r: 31, g: 79, b: 113 }, style: { underline: 3 } }),
          cell(3, { style: { overline: true, strikethrough: true } }),
        ]),
        row(2, [cell(6, { text: 'C' })]),
        row(3, [cell(0, { text: 'B', foreground: { r: 0, g: 0, b: 255 } })]),
      ],
      overhangRasterizer,
    )
    const pixels = await fixture.render(true)
    // This pixel includes glyphs whose owning cells are several columns and rows away.
    expectMatchingPixels(Uint8Array.from(pixel(pixels, 40, 8)), new Uint8Array([32, 64, 128, 224]))
    expect(pixel(pixels, 4, 8)[3]).toBeGreaterThan(0)
    expect(pixel(pixels, 40, 24)[3]).toBe(255)
    expect(pixel(pixels, 108, 60)[3]).toBeGreaterThan(0)
    expect(fixture.candidate.pass.drawCount).toBe(mode === 'compute-copy' ? 0 : 1)
    expect(fixture.candidate.pass.metrics.dispatches).toBe(mode === 'fullscreen-fragment' ? 0 : 1)
  },
)

it.each(compositors)(
  '%s matches native faint/color glyphs, transparency, decorations and cursor styles',
  async (mode) => {
    const fixture = await createComparison(
      mode,
      [
        row(0, [
          cell(1, { background: { r: 91, g: 37, b: 13 } }),
          cell(2, { text: 'A', foreground: { r: 220, g: 60, b: 30 } }),
          cell(3, { text: 'C', style: { faint: true } }),
          cell(4, { text: 'C' }),
          cell(5, { text: 'A', style: { invisible: true } }),
          cell(6, { selected: true }),
        ]),
        row(
          1,
          Array.from({ length: 5 }, (_, x) => cell(x, { style: { underline: x + 1 } })).concat([
            cell(5, { style: { strikethrough: true } }),
            cell(6, { style: { overline: true } }),
          ]),
        ),
        row(2, [
          cell(2, {
            text: 'A',
            foreground: { r: 128, g: 128, b: 128 },
            background: { r: 128, g: 128, b: 128 },
            style: { inverse: true },
          }),
        ]),
        row(3, [cell(3, { text: 'A' })]),
      ],
      cellRasterizer,
    )
    const initial = await fixture.render(true)
    expect(pixel(initial, 8, 8)).toEqual([0, 0, 0, 0])
    expect(pixel(initial, 24, 8)).toEqual([91, 37, 13, 255])
    expect(pixel(initial, 56, 8)[3]).toBeLessThan(pixel(initial, 72, 8)[3]!)
    expect(pixel(initial, 88, 8)).toEqual([0, 0, 0, 0])
    const cursorStyles: readonly CursorState['style'][] = ['block', 'outline', 'bar', 'underline']
    for (const style of cursorStyles) {
      const cursor = { style, visible: true, x: 3, y: 3 }
      const pixels = await fixture.render(false, cursor)
      expect(pixels).not.toEqual(initial)
    }
  },
)

it.each(compositors)('%s replaces dirty glyph reach and removes old glyph pixels', async (mode) => {
  const fixture = await createComparison(
    mode,
    [row(2, [cell(3, { text: 'X' })])],
    overhangRasterizer,
  )
  const initial = await fixture.render(true)
  expect(pixel(initial, 8, 8)).toEqual([0, 0, 0, 0])
  fixture.native.writeRows([row(2, [cell(6, { text: 'C' })])])
  const expanded = await fixture.render(false)
  expect(pixel(expanded, 40, 8)[3]).toBeGreaterThan(0)
  fixture.native.writeRows([row(2, [])])
  const removed = await fixture.render(false)
  expect(removed.every((channel) => channel === 0)).toBe(true)
  fixture.native.writeRows([row(2, [cell(6, { text: 'C' })])])
  const restored = await fixture.render(false)
  expect(pixel(restored, 40, 8)[3]).toBeGreaterThan(0)
  expect(pixel(restored, 104, 40)[3]).toBeGreaterThan(0)
  expect(fixture.builder.rowRebuilds).toBeLessThan(rows)
})

it.each(compositors)(
  '%s keeps native row-ring wrap and regional moves pixel-identical',
  async (mode) => {
    const fixture = await createComparison(
      mode,
      [
        row(0, [cell(0, { text: 'A' })]),
        row(1, [cell(1, { text: 'C' })]),
        row(2, [cell(2, { text: 'B' })]),
        row(3, [cell(3, { text: 'A' })]),
      ],
      overhangRasterizer,
      true,
    )
    await fixture.render(true)
    let sawWrap = false
    for (let index = 0; index < rows * 2 + 1; index += 1) {
      fixture.native.terminal.write(`\x1b[4;1H\r\n${index % 2 === 0 ? 'C' : 'B'}`)
      await fixture.render(false)
      sawWrap ||= fixture.builder.rowOffset !== 0
    }
    expect(sawWrap).toBe(true)
    for (const input of ['\x1b[2;4r\x1b[4;1H\nA', '\x1b[2;1H\x1b[L', '\x1b[M', '\x1b[2;1H\x1bM']) {
      fixture.native.terminal.write(input)
      await fixture.render(false)
    }
  },
)

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
  experimentalCompositor?: Compositor,
  grid = { columns, rows },
  deviceFactory: () => Promise<GPUDevice> = async () => gpu.device,
) {
  const native = await createNativeTestState(grid.columns, grid.rows)
  native.terminal.write('\x1b[31mfirst\x1b[0m\r\n\x1b[4:3msecond\x1b[0m')
  const canvas = new OffscreenCanvas(1, 1)
  const clock = new ManualClock()
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
  const renderer = await WebGpuTerminalRenderer.create({
    canvas,
    columns: grid.columns,
    cursorBlink: false,
    deviceFactory,
    experimentalCompositor,
    font,
    renderState: native.state,
    rows: grid.rows,
    schedulerClock: clock,
  })
  gpu.own({ destroy: () => renderer.dispose() })
  return { canvas, clock, font, native, renderer }
}

async function expectMatchingRenderers(
  candidate: Awaited<ReturnType<typeof createRenderer>>,
  reference: Awaited<ReturnType<typeof createRenderer>>,
  stage: string,
): Promise<void> {
  // Queue both copies before yielding so both canvases still expose the painted swapchain texture.
  const [actual, expected] = await Promise.all([
    candidate.renderer.capturePixels(),
    reference.renderer.capturePixels(),
  ])
  expectMatchingPixels(
    actual,
    expected,
    `${stage} ${candidate.canvas.width}x${candidate.canvas.height}`,
  )
}

it.each(compositors)(
  '%s retains its renderer pipeline through geometry recreation',
  async (mode) => {
    const gpu = await createGpu()
    const reference = await createRenderer(gpu)
    const candidate = await createRenderer(gpu, mode)
    reference.clock.flush()
    candidate.clock.flush()
    await expectMatchingRenderers(candidate, reference, 'initial')
    for (const size of [
      { columns: 9, rows: 5 },
      { columns: 4, rows: 2 },
      { columns, rows },
    ]) {
      const draws = candidate.renderer.metrics.draws
      for (const fixture of [reference, candidate]) {
        fixture.native.terminal.resize(size)
        fixture.renderer.resize(size)
        fixture.clock.flush()
      }
      expect(candidate.renderer.metrics.draws - draws).toBe(mode === 'compute-copy' ? 0 : 1)
      expect(candidate.canvas.width).toBe(reference.canvas.width)
      expect(candidate.canvas.height).toBe(reference.canvas.height)
      await expectMatchingRenderers(
        candidate,
        reference,
        `resized ${size.columns}x${size.rows} grid`,
      )
    }
  },
)

it.each(compositors)(
  '%s preserves its usable grid after a glyph-binding resize rejection',
  async (mode) => {
    const gpu = await createGpu()
    limitDeviceBuffers(gpu.device, { maxStorageBufferBindingSize: 512 })
    const fixture = await createRenderer(gpu, mode, { columns: 2, rows: 2 })
    fixture.clock.flush()
    const before = await fixture.renderer.capturePixels()
    const size = [fixture.canvas.width, fixture.canvas.height]
    expect(() => fixture.renderer.resize({ columns: 3, rows: 2 })).toThrow(
      'glyph records to fit one storage binding',
    )
    expect([fixture.canvas.width, fixture.canvas.height]).toEqual(size)
    fixture.renderer.refreshRows(0, 1)
    fixture.clock.flush()
    expectMatchingPixels(await fixture.renderer.capturePixels(), before)
    for (const grid of [
      { columns: 1, rows: 2 },
      { columns: 2, rows: 2 },
    ]) {
      fixture.native.terminal.resize(grid)
      fixture.renderer.resize(grid)
      fixture.clock.flush()
      const pixels = await fixture.renderer.capturePixels()
      expect(pixels.some((channel, index) => index % 4 === 3 && channel > 0)).toBe(true)
    }
    expect([fixture.canvas.width, fixture.canvas.height]).toEqual(size)
  },
)

it.each(compositors)(
  '%s preserves geometry after texture-limit resize and font rejection',
  async (mode) => {
    const gpu = await createGpu()
    const fixture = await createRenderer(gpu, mode)
    fixture.clock.flush()
    const before = await fixture.renderer.capturePixels()
    const size = [fixture.canvas.width, fixture.canvas.height]
    const actualLimits = gpu.device.limits
    const limit = Math.max(fixture.canvas.width, fixture.canvas.height)
    const limited = vi.spyOn(gpu.device, 'limits', 'get').mockReturnValue(
      new Proxy(actualLimits, {
        get(target, key) {
          if (key === 'maxTextureDimension2D') return limit
          return Reflect.get(target, key, target)
        },
      }),
    )
    onTestFinished(() => limited.mockRestore())
    expect(() => fixture.renderer.resize({ columns: columns * 2, rows })).toThrow(
      'compositor viewport exceeds',
    )
    const largerFont = {
      ...fixture.font,
      cssCellWidth: fixture.font.cssCellWidth * 2,
      deviceCellWidth: fixture.font.deviceCellWidth * 2,
    }
    expect(() => fixture.renderer.setFont(largerFont)).toThrow('compositor viewport exceeds')
    expect([fixture.canvas.width, fixture.canvas.height]).toEqual(size)
    fixture.renderer.refreshRows(0, rows - 1)
    fixture.clock.flush()
    expectMatchingPixels(await fixture.renderer.capturePixels(), before)
    limited.mockRestore()
    fixture.renderer.setFont(largerFont)
    fixture.clock.flush()
    expect(fixture.canvas.width).toBe(size[0]! * 2)
    expect(
      (await fixture.renderer.capturePixels()).some(
        (channel, index) => index % 4 === 3 && channel > 0,
      ),
    ).toBe(true)
  },
)

it.each(['compute', 'compute-copy'] as const)(
  '%s destroys output and every buffer after pipeline construction fails',
  async (mode) => {
    const gpu = await createGpu()
    const buffers = vi.spyOn(gpu.device, 'createBuffer')
    const textures = vi.spyOn(gpu.device, 'createTexture')
    const bufferDestroy = vi.spyOn(GPUBuffer.prototype, 'destroy')
    const textureDestroy = vi.spyOn(GPUTexture.prototype, 'destroy')
    const pipeline = vi.spyOn(gpu.device, 'createComputePipeline').mockImplementationOnce(() => {
      throw new TypeError('Injected compute pipeline failure')
    })
    onTestFinished(() => {
      buffers.mockRestore()
      textures.mockRestore()
      bufferDestroy.mockRestore()
      textureDestroy.mockRestore()
      pipeline.mockRestore()
    })
    expect(
      () =>
        new WebGpuTextPass({
          cellHeight: cellSize,
          cellWidth: cellSize,
          columns: 2,
          device: gpu.device,
          experimentalCompositor: mode,
          format: 'rgba8unorm',
          height: cellSize * 2,
          instanceCount: 4,
          width: cellSize * 2,
        }),
    ).toThrow('Injected compute pipeline failure')
    expect(buffers.mock.results.length).toBeGreaterThanOrEqual(3)
    expect(textures).toHaveBeenCalledOnce()
    for (const result of buffers.mock.results) {
      if (result.type === 'return') expect(bufferDestroy.mock.contexts).toContain(result.value)
    }
    expect(textureDestroy.mock.contexts).toContain(textures.mock.results[0]!.value)
  },
)

it('retains the compute renderer after a qualified replacement device', async ({ skip }) => {
  const gpu = await createGpu()
  const qualification = qualifyDeviceReplacement(gpu.adapter.info, navigator.userAgent)
  if (qualification.kind === 'skip') skip(qualification.reason)
  if (qualification.kind === 'unresolved') expect.fail(qualification.reason)
  const replacement = await createGpu()
  let factoryCalls = 0
  const fixture = await createRenderer(gpu, 'compute', { columns, rows }, async () => {
    factoryCalls += 1
    return factoryCalls === 1 ? gpu.device : replacement.device
  })
  replacement.own({ destroy: () => fixture.renderer.dispose() })
  fixture.clock.flush()
  const before = await fixture.renderer.capturePixels()
  const draws = fixture.renderer.metrics.draws
  const dispatches = fixture.renderer.metrics.dispatches
  await gpu.validate()
  await fixture.renderer.simulateDeviceLoss()
  fixture.clock.flush()
  expect(factoryCalls).toBe(2)
  expect(fixture.renderer.metrics.deviceRestores).toBe(1)
  expect(fixture.renderer.metrics.draws - draws).toBe(1)
  expect(fixture.renderer.metrics.dispatches - dispatches).toBe(1)
  expectMatchingPixels(await fixture.renderer.capturePixels(), before)
})

it('destroys an unadopted compute replacement when canvas configuration fails', async () => {
  const gpu = await createGpu()
  const fixture = await createRenderer(gpu, 'compute')
  fixture.clock.flush()
  const before = await fixture.renderer.capturePixels()
  const size = [fixture.canvas.width, fixture.canvas.height]
  const context = fixture.canvas.getContext('webgpu')
  if (!context) throw new TypeError('WebGPU canvas context unavailable')
  const buffers = vi.spyOn(gpu.device, 'createBuffer')
  const textures = vi.spyOn(gpu.device, 'createTexture')
  const bufferDestroy = vi.spyOn(GPUBuffer.prototype, 'destroy')
  const textureDestroy = vi.spyOn(GPUTexture.prototype, 'destroy')
  const configure = vi.spyOn(context, 'configure').mockImplementationOnce(() => {
    throw new TypeError('Injected canvas configuration failure')
  })
  onTestFinished(() => {
    buffers.mockRestore()
    textures.mockRestore()
    bufferDestroy.mockRestore()
    textureDestroy.mockRestore()
    configure.mockRestore()
  })
  const largerFont = {
    ...fixture.font,
    cssCellWidth: fixture.font.cssCellWidth * 2,
    deviceCellWidth: fixture.font.deviceCellWidth * 2,
  }
  expect(() => fixture.renderer.setFont(largerFont)).toThrow(
    'Injected canvas configuration failure',
  )
  expect(buffers.mock.results.length).toBeGreaterThanOrEqual(3)
  expect(textures).toHaveBeenCalledOnce()
  for (const result of buffers.mock.results) {
    if (result.type === 'return') expect(bufferDestroy.mock.contexts).toContain(result.value)
  }
  expect(textureDestroy.mock.contexts).toContain(textures.mock.results[0]!.value)
  expect([fixture.canvas.width, fixture.canvas.height]).toEqual(size)
  fixture.renderer.refreshRows(0, rows - 1)
  fixture.clock.flush()
  expectMatchingPixels(await fixture.renderer.capturePixels(), before)
  fixture.renderer.setFont(largerFont)
  fixture.clock.flush()
  expect(fixture.canvas.width).toBe(size[0]! * 2)
  expect(
    (await fixture.renderer.capturePixels()).some(
      (channel, index) => index % 4 === 3 && channel > 0,
    ),
  ).toBe(true)
})
