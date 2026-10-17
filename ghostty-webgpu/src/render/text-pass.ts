import { createGhosttyError } from '../core/error.js'
import type { AtlasGpuTextures } from './atlas/gpu-textures.js'
import type { RowInstanceUpdate } from './instances/types.js'
import {
  planSparseUploadRanges,
  planUploadRanges,
  planWrappedUploadRanges,
  type UploadPlan,
} from './instances/upload-ranges.js'
import {
  CELL_INSTANCE_BYTES,
  GLYPH_INSTANCE_BYTES,
  GLYPH_INSTANCE_FLOATS,
  GlyphFlag,
  GlyphOffset,
} from './instances/layout.js'
import { cellShader } from './shaders/cell.wgsl.js'
import { glyphShader } from './shaders/glyph.wgsl.js'
import {
  compositorPresentationShader,
  computeCompositorShader,
  fullscreenCompositorShader,
} from './shaders/pixel-compositor.wgsl.js'

export type ExperimentalWebGpuCompositor = 'compute' | 'fullscreen-fragment'

export interface TextPassMetrics {
  dispatches: number
  draws: number
  submittedFrames: number
  uploadedBytes: number
  uploadOperations: number
}

export interface WebGpuTextPassOptions {
  experimentalCompositor?: ExperimentalWebGpuCompositor
  columns?: number
  cellWidth?: number
  cellHeight?: number
  device: GPUDevice
  format: GPUTextureFormat
  height: number
  instanceCount: number
  width: number
}

export interface TextPassCopy {
  buffer: GPUBuffer
  bytesPerRow: number
  size: GPUExtent3DStrict
  texture: GPUTexture
}

type FrameRows =
  | {
      readonly stableRows?: false
      readonly columns?: number
      readonly rowHeight?: number
      readonly rowOffset?: number
    }
  | {
      readonly stableRows: boolean
      readonly columns: number
      readonly rowHeight: number
      readonly rowOffset: number
    }

interface PipelineResources {
  readonly kind: 'instanced'
  cellBindGroup: GPUBindGroup
  cellPipeline: GPURenderPipeline
  glyphPipeline: GPURenderPipeline
}

interface PixelGeometry {
  readonly columns: number
  readonly rows: number
  readonly cellWidth: number
  readonly cellHeight: number
}

interface FragmentResources {
  readonly kind: 'fullscreen-fragment'
  readonly pipeline: GPURenderPipeline
  bindGroup?: GPUBindGroup
}

interface ComputeResources {
  readonly kind: 'compute'
  readonly pipeline: GPUComputePipeline
  readonly output: GPUTexture
  readonly outputView: GPUTextureView
  readonly presentPipeline: GPURenderPipeline
  readonly presentBindGroup: GPUBindGroup
  bindGroup?: GPUBindGroup
}

type TextPipelineResources = PipelineResources | FragmentResources | ComputeResources

function pixelGeometry(options: WebGpuTextPassOptions): PixelGeometry | undefined {
  if (!options.experimentalCompositor) return undefined
  const { columns, cellWidth, cellHeight, instanceCount, width, height } = options
  if (
    columns === undefined ||
    cellWidth === undefined ||
    cellHeight === undefined ||
    !Number.isSafeInteger(columns) ||
    columns <= 0 ||
    instanceCount % columns !== 0 ||
    !Number.isSafeInteger(cellWidth) ||
    cellWidth <= 0 ||
    !Number.isSafeInteger(cellHeight) ||
    cellHeight <= 0 ||
    width !== columns * cellWidth ||
    height !== (instanceCount / columns) * cellHeight
  ) {
    throw createGhosttyError(
      'webgpu_compositor',
      'Pixel composition requires integer grid and cell geometry matching the viewport',
    )
  }
  if (options.format !== 'rgba8unorm' && options.format !== 'bgra8unorm') {
    throw createGhosttyError(
      'webgpu_compositor',
      'Pixel composition requires an rgba8unorm or bgra8unorm target',
    )
  }
  const limit = options.device.limits.maxTextureDimension2D
  if (width > limit || height > limit) {
    throw createGhosttyError(
      'webgpu_capacity',
      `The compositor viewport exceeds the ${limit}-pixel texture dimension limit`,
    )
  }
  return { columns, rows: instanceCount / columns, cellWidth, cellHeight }
}

interface GlyphBatch {
  readonly buffer: GPUBuffer
  readonly byteOffset: number
  readonly instanceCount: number
  bindGroup?: GPUBindGroup
}

export function textPassGlyphCapacity(device: GPUDevice, instanceCount: number): number {
  const byteLimit = Math.min(device.limits.maxBufferSize, device.limits.maxStorageBufferBindingSize)
  const cellBytes = instanceCount * CELL_INSTANCE_BYTES
  if (!Number.isSafeInteger(instanceCount) || instanceCount < 1 || cellBytes > byteLimit) {
    throw createGhosttyError(
      'webgpu_capacity',
      `The grid needs ${cellBytes} cell-storage bytes; this WebGPU device supports ${byteLimit}`,
    )
  }
  const capacity = Math.floor(byteLimit / GLYPH_INSTANCE_BYTES)
  if (capacity < 1) {
    throw createGhosttyError(
      'webgpu_capacity',
      `A native glyph record needs ${GLYPH_INSTANCE_BYTES} bytes; this WebGPU device supports ${byteLimit}`,
    )
  }
  return capacity
}

function blendState(): GPUBlendState {
  return {
    alpha: { dstFactor: 'one-minus-src-alpha', srcFactor: 'one' },
    color: { dstFactor: 'one-minus-src-alpha', srcFactor: 'one' },
  }
}

export class WebGpuTextPass {
  private readonly ownedBuffers: GPUBuffer[] = []
  private readonly cellBuffer: GPUBuffer
  private readonly device: GPUDevice
  private readonly glyphBuffer: GPUBuffer
  private readonly glyphBatches: GlyphBatch[] = []
  readonly drawCount: number
  readonly dispatchCount: number
  readonly supportsStableRows: boolean
  private frameUploadedBytesValue = 0
  private glyphBindGroupCreationCountValue = 0
  private glyphBindGroup?: GPUBindGroup
  private readonly instanceCount: number
  readonly metrics: TextPassMetrics = {
    dispatches: 0,
    draws: 0,
    submittedFrames: 0,
    uploadedBytes: 0,
    uploadOperations: 0,
  }
  private readonly resources: TextPipelineResources
  private readonly geometry?: PixelGeometry
  private readonly width: number
  private readonly height: number
  private readonly reach = new Float32Array(4)
  private readonly sampler: GPUSampler
  private readonly viewportBuffer: GPUBuffer
  private readonly rowData = new ArrayBuffer(24)
  private readonly rowView = new DataView(this.rowData)
  private rowOffset = 0
  private rowHeight = 0
  private rowColumns = 0
  private rowsInitialized = false
  private wrapRow = Infinity
  private editPlanner: (updates: readonly RowInstanceUpdate[], wrapRow: number) => UploadPlan =
    planUploadRanges

  constructor(options: WebGpuTextPassOptions) {
    this.device = options.device
    this.instanceCount = options.instanceCount
    this.width = options.width
    this.height = options.height
    this.geometry = pixelGeometry(options)
    const capacity = textPassGlyphCapacity(this.device, this.instanceCount)
    if (this.geometry && capacity < this.instanceCount) {
      throw createGhosttyError(
        'webgpu_capacity',
        'Pixel composition requires the glyph records to fit one storage binding',
      )
    }
    try {
      this.cellBuffer = this.createStorageBuffer(this.instanceCount * CELL_INSTANCE_BYTES)
      for (let first = 0; first < this.instanceCount; first += capacity) {
        const instanceCount = Math.min(capacity, this.instanceCount - first)
        this.glyphBatches.push({
          buffer: this.createStorageBuffer(instanceCount * GLYPH_INSTANCE_BYTES),
          byteOffset: first * GLYPH_INSTANCE_BYTES,
          instanceCount,
        })
      }
      this.glyphBuffer = this.glyphBatches[0]!.buffer
      this.drawCount = options.experimentalCompositor ? 1 : 1 + this.glyphBatches.length
      this.dispatchCount = options.experimentalCompositor === 'compute' ? 1 : 0
      this.supportsStableRows = this.glyphBatches.length === 1
      this.viewportBuffer = options.device.createBuffer({
        size: this.geometry ? 64 : 32,
        usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.UNIFORM,
      })
      this.ownedBuffers.push(this.viewportBuffer)
      this.sampler = options.device.createSampler({ magFilter: 'linear', minFilter: 'linear' })
      options.device.queue.writeBuffer(
        this.viewportBuffer,
        0,
        new Float32Array([options.width, options.height, 0, 0]),
      )
      this.resources = this.createResources(options.format, options.experimentalCompositor)
      this.initializePixelGeometry()
    } catch (cause) {
      this.destroy()
      throw cause
    }
  }

  syncAtlas(textures: AtlasGpuTextures): void {
    if (this.resources.kind !== 'instanced') {
      this.syncPixelAtlas(textures, this.resources)
      return
    }
    for (const batch of this.glyphBatches) {
      batch.bindGroup = this.device.createBindGroup({
        entries: [
          { binding: 0, resource: { buffer: batch.buffer } },
          { binding: 1, resource: { buffer: this.viewportBuffer } },
          { binding: 2, resource: this.sampler },
          { binding: 3, resource: textures.view('grayscale') },
          { binding: 4, resource: textures.view('color') },
        ],
        layout: this.resources.glyphPipeline.getBindGroupLayout(0),
      })
      this.glyphBindGroupCreationCountValue += 1
    }
    this.glyphBindGroup = this.glyphBatches[0]!.bindGroup
  }

  get glyphBindGroupCreationCount(): number {
    return this.glyphBindGroupCreationCountValue
  }

  get frameUploadedBytes(): number {
    return this.frameUploadedBytesValue
  }

  uploadFrame(
    data: FrameRows & {
      readonly cellData: Float32Array
      readonly glyphData: Float32Array
      readonly rowChanges?: number
    },
    updates: readonly RowInstanceUpdate[],
  ): number {
    this.frameUploadedBytesValue = 0
    const changes = data.rowChanges ?? 0
    if (!this.rowsInitialized || changes !== 0) {
      this.uploadRows(data)
      this.rowsInitialized = true
    }
    const plan =
      (changes & 1) === 0
        ? this.editPlanner(updates, this.wrapRow)
        : planSparseUploadRanges(updates)
    const cellData = data.cellData
    const glyphData = data.glyphData
    const reachOperations = this.geometry
      ? this.updateGlyphReach(glyphData, updates, data.stableRows ?? false)
      : 0
    for (const range of plan.cell) this.writeRange(this.cellBuffer, cellData, range)
    if (this.glyphBatches.length === 1) {
      for (const range of plan.glyph) this.writeRange(this.glyphBuffer, glyphData, range)
      return plan.cell.length + plan.glyph.length + reachOperations
    }
    let operations = plan.cell.length
    for (const range of plan.glyph) operations += this.writeGlyphRange(glyphData, range)
    return operations + reachOperations
  }

  submit(view: GPUTextureView, copy?: TextPassCopy): void {
    this.device.queue.submit([this.encode(view, copy)])
    this.acceptFrame()
  }

  acceptFrame(): void {
    this.metrics.draws += this.drawCount
    this.metrics.dispatches += this.dispatchCount
    this.metrics.submittedFrames += 1
  }

  encode(view: GPUTextureView, copy?: TextPassCopy): GPUCommandBuffer {
    const encoder = this.device.createCommandEncoder()
    this.encodeComposition(encoder, view)
    if (copy) {
      encoder.copyTextureToBuffer(
        { texture: copy.texture },
        { buffer: copy.buffer, bytesPerRow: copy.bytesPerRow },
        copy.size,
      )
    }
    return encoder.finish()
  }

  private encodeComposition(encoder: GPUCommandEncoder, view: GPUTextureView): void {
    if (this.resources.kind !== 'instanced') {
      this.encodePixels(encoder, view, this.resources)
      return
    }
    if (!this.glyphBindGroup)
      throw createGhosttyError('webgpu_atlas', 'Atlas textures must be synchronized before drawing')
    const pass = encoder.beginRenderPass({
      colorAttachments: [
        {
          clearValue: { a: 0, b: 0, g: 0, r: 0 },
          loadOp: 'clear',
          storeOp: 'store',
          view,
        },
      ],
    })
    pass.setPipeline(this.resources.cellPipeline)
    pass.setBindGroup(0, this.resources.cellBindGroup)
    pass.draw(6, this.instanceCount)
    pass.setPipeline(this.resources.glyphPipeline)
    pass.setBindGroup(0, this.glyphBindGroup)
    pass.draw(6, this.glyphBatches[0]!.instanceCount)
    for (let index = 1; index < this.glyphBatches.length; index += 1) {
      const batch = this.glyphBatches[index]!
      pass.setBindGroup(0, batch.bindGroup!)
      pass.draw(6, batch.instanceCount)
    }
    pass.end()
  }

  destroy(): void {
    for (const buffer of this.ownedBuffers) buffer.destroy()
    if (this.resources?.kind === 'compute') this.resources.output.destroy()
  }

  private uploadRows(data: FrameRows): void {
    const columns = data.stableRows ? data.columns : 0
    const height = data.stableRows ? data.rowHeight : 0
    const offset = data.stableRows ? data.rowOffset : 0
    if (columns === this.rowColumns && height === this.rowHeight && offset === this.rowOffset)
      return
    this.rowColumns = columns
    this.rowHeight = height
    this.rowOffset = offset
    this.wrapRow = offset === 0 ? Infinity : this.instanceCount / columns - offset
    this.editPlanner = offset === 0 ? planUploadRanges : planWrappedUploadRanges
    this.rowView.setUint32(0, columns, true)
    this.rowView.setFloat32(4, height, true)
    this.rowView.setUint32(8, offset, true)
    this.rowView.setUint32(12, this.instanceCount, true)
    this.device.queue.writeBuffer(this.viewportBuffer, 8, this.rowData)
    this.frameUploadedBytesValue += this.rowData.byteLength
    this.metrics.uploadedBytes += this.rowData.byteLength
    this.metrics.uploadOperations += 1
  }

  private createPipelines(format: GPUTextureFormat): PipelineResources {
    const cellPipeline = this.device.createRenderPipeline({
      fragment: {
        entryPoint: 'fragmentMain',
        module: this.device.createShaderModule({ code: cellShader }),
        targets: [{ blend: blendState(), format }],
      },
      layout: 'auto',
      primitive: { topology: 'triangle-list' },
      vertex: {
        entryPoint: 'vertexMain',
        module: this.device.createShaderModule({ code: cellShader }),
      },
    })
    const glyphPipeline = this.device.createRenderPipeline({
      fragment: {
        entryPoint: 'fragmentMain',
        module: this.device.createShaderModule({ code: glyphShader }),
        targets: [{ blend: blendState(), format }],
      },
      layout: 'auto',
      primitive: { topology: 'triangle-list' },
      vertex: {
        entryPoint: 'vertexMain',
        module: this.device.createShaderModule({ code: glyphShader }),
      },
    })
    const cellBindGroup = this.device.createBindGroup({
      entries: [
        { binding: 0, resource: { buffer: this.cellBuffer } },
        { binding: 1, resource: { buffer: this.viewportBuffer } },
      ],
      layout: cellPipeline.getBindGroupLayout(0),
    })
    return { kind: 'instanced', cellBindGroup, cellPipeline, glyphPipeline }
  }

  private createResources(
    format: GPUTextureFormat,
    compositor: ExperimentalWebGpuCompositor | undefined,
  ): TextPipelineResources {
    if (!compositor) return this.createPipelines(format)
    if (compositor === 'fullscreen-fragment') {
      return {
        kind: compositor,
        pipeline: this.createFullscreenPipeline(format, fullscreenCompositorShader),
      }
    }
    const output = this.device.createTexture({
      format: 'rgba8unorm',
      size: [this.width, this.height],
      usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING,
    })
    try {
      const outputView = output.createView()
      const presentPipeline = this.createFullscreenPipeline(format, compositorPresentationShader)
      const presentBindGroup = this.device.createBindGroup({
        layout: presentPipeline.getBindGroupLayout(0),
        entries: [{ binding: 0, resource: outputView }],
      })
      const pipeline = this.device.createComputePipeline({
        layout: 'auto',
        compute: {
          entryPoint: 'computeMain',
          module: this.device.createShaderModule({ code: computeCompositorShader }),
        },
      })
      return { kind: compositor, output, outputView, pipeline, presentPipeline, presentBindGroup }
    } catch (cause) {
      output.destroy()
      throw cause
    }
  }

  private createFullscreenPipeline(format: GPUTextureFormat, code: string): GPURenderPipeline {
    const module = this.device.createShaderModule({ code })
    return this.device.createRenderPipeline({
      layout: 'auto',
      fragment: { entryPoint: 'fragmentMain', module, targets: [{ format }] },
      vertex: { entryPoint: 'vertexMain', module },
      primitive: { topology: 'triangle-list' },
    })
  }

  private initializePixelGeometry(): void {
    const geometry = this.geometry
    if (!geometry) return
    const data = new ArrayBuffer(32)
    const view = new DataView(data)
    view.setUint32(0, geometry.columns, true)
    view.setUint32(4, geometry.rows, true)
    view.setFloat32(8, geometry.cellWidth, true)
    view.setFloat32(12, geometry.cellHeight, true)
    this.reach[2] = geometry.cellWidth
    this.reach[3] = geometry.cellHeight
    new Float32Array(data, 16).set(this.reach)
    this.device.queue.writeBuffer(this.viewportBuffer, 32, data)
  }

  private syncPixelAtlas(
    textures: AtlasGpuTextures,
    resources: FragmentResources | ComputeResources,
  ): void {
    const entries: GPUBindGroupEntry[] = [
      { binding: 0, resource: { buffer: this.cellBuffer } },
      { binding: 1, resource: { buffer: this.glyphBuffer } },
      { binding: 2, resource: { buffer: this.viewportBuffer } },
      { binding: 3, resource: this.sampler },
      { binding: 4, resource: textures.view('grayscale') },
      { binding: 5, resource: textures.view('color') },
    ]
    if (resources.kind === 'compute') entries.push({ binding: 6, resource: resources.outputView })
    resources.bindGroup = this.device.createBindGroup({
      entries,
      layout: resources.pipeline.getBindGroupLayout(0),
    })
    this.glyphBindGroupCreationCountValue += 1
  }

  private updateGlyphReach(
    data: Float32Array,
    updates: readonly RowInstanceUpdate[],
    stableRows: boolean,
  ): number {
    const geometry = this.geometry
    if (!geometry) return 0
    let changed = false
    for (const update of updates) {
      const first = update.glyph.byteOffset / Float32Array.BYTES_PER_ELEMENT
      const end = first + update.glyph.byteLength / Float32Array.BYTES_PER_ELEMENT
      for (let offset = first; offset < end; offset += GLYPH_INSTANCE_FLOATS) {
        changed = this.extendGlyphReach(data, offset, geometry, stableRows) || changed
      }
    }
    if (!changed) return 0
    this.device.queue.writeBuffer(this.viewportBuffer, 48, this.reach)
    this.frameUploadedBytesValue += this.reach.byteLength
    this.metrics.uploadedBytes += this.reach.byteLength
    this.metrics.uploadOperations += 1
    return 1
  }

  private extendGlyphReach(
    data: Float32Array,
    offset: number,
    geometry: PixelGeometry,
    stableRows: boolean,
  ): boolean {
    if ((data[offset + GlyphOffset.Meta]! & GlyphFlag.Glyph) === 0) return false
    const index = offset / GLYPH_INSTANCE_FLOATS
    const x = data[offset]! - (index % geometry.columns) * geometry.cellWidth
    const y =
      data[offset + 1]! -
      (stableRows ? 0 : Math.floor(index / geometry.columns) * geometry.cellHeight)
    const minX = Math.min(this.reach[0]!, x)
    const minY = Math.min(this.reach[1]!, y)
    const maxX = Math.max(this.reach[2]!, x + data[offset + 2]!)
    const maxY = Math.max(this.reach[3]!, y + data[offset + 3]!)
    const changed =
      minX !== this.reach[0] ||
      minY !== this.reach[1] ||
      maxX !== this.reach[2] ||
      maxY !== this.reach[3]
    this.reach[0] = minX
    this.reach[1] = minY
    this.reach[2] = maxX
    this.reach[3] = maxY
    return changed
  }

  private encodePixels(
    encoder: GPUCommandEncoder,
    view: GPUTextureView,
    resources: FragmentResources | ComputeResources,
  ): void {
    if (!resources.bindGroup)
      throw createGhosttyError('webgpu_atlas', 'Atlas textures must be synchronized before drawing')
    if (resources.kind === 'compute') {
      const pass = encoder.beginComputePass()
      pass.setPipeline(resources.pipeline)
      pass.setBindGroup(0, resources.bindGroup)
      pass.dispatchWorkgroups(Math.ceil(this.width / 8), Math.ceil(this.height / 8))
      pass.end()
      this.encodeFullscreen(encoder, view, resources.presentPipeline, resources.presentBindGroup)
      return
    }
    this.encodeFullscreen(encoder, view, resources.pipeline, resources.bindGroup)
  }

  private encodeFullscreen(
    encoder: GPUCommandEncoder,
    view: GPUTextureView,
    pipeline: GPURenderPipeline,
    bindGroup: GPUBindGroup,
  ): void {
    const pass = encoder.beginRenderPass({
      colorAttachments: [
        {
          clearValue: { r: 0, g: 0, b: 0, a: 0 },
          loadOp: 'clear',
          storeOp: 'store',
          view,
        },
      ],
    })
    pass.setPipeline(pipeline)
    pass.setBindGroup(0, bindGroup)
    pass.draw(3)
    pass.end()
  }

  private createStorageBuffer(size: number): GPUBuffer {
    const buffer = this.device.createBuffer({
      size,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.STORAGE,
    })
    this.ownedBuffers.push(buffer)
    return buffer
  }

  private writeGlyphRange(
    data: Float32Array,
    range: { byteLength: number; byteOffset: number },
  ): number {
    let operations = 0
    for (const batch of this.glyphBatches) {
      const start = Math.max(range.byteOffset, batch.byteOffset)
      const end = Math.min(
        range.byteOffset + range.byteLength,
        batch.byteOffset + batch.instanceCount * GLYPH_INSTANCE_BYTES,
      )
      if (end <= start) continue
      this.writeRange(
        batch.buffer,
        data,
        { byteOffset: start - batch.byteOffset, byteLength: end - start },
        start,
      )
      operations += 1
    }
    return operations
  }

  private writeRange(
    buffer: GPUBuffer,
    data: Float32Array | Uint32Array,
    range: { byteLength: number; byteOffset: number },
    sourceOffset = range.byteOffset,
  ): void {
    if (range.byteLength === 0) return
    this.device.queue.writeBuffer(
      buffer,
      range.byteOffset,
      data.buffer,
      data.byteOffset + sourceOffset,
      range.byteLength,
    )
    this.frameUploadedBytesValue += range.byteLength
    this.metrics.uploadedBytes += range.byteLength
    this.metrics.uploadOperations += 1
  }
}
