import { createGhosttyError } from '../../core/error.js'
import type { GlyphBitmap } from '../atlas/types.js'

export interface StampStorage {
  readonly memory: WebAssembly.Memory
  allocate(bytes: number): number
  release(offset: number, bytes: number): void
}

export interface ResidentStamp {
  readonly offset: number
  readonly bytes: number
  readonly width: number
  readonly height: number
  readonly left: number
  readonly top: number
  readonly encoding: 'a8' | 'rgba'
  readonly generation: number
}

export class StampCache {
  readonly metrics = {
    hits: 0,
    misses: 0,
    rasterCalls: 0,
    rasterPayloadBytes: 0,
    stampCopies: 0,
    stampCopiedBytes: 0,
    evictions: 0,
    residentBytes: 0,
    residentEntries: 0,
  }
  private readonly entries = new Map<string, ResidentStamp | undefined>()
  private budget = 0
  private entryBudget = 0
  private generation = 0

  constructor(private readonly storage: StampStorage) {}

  resize(width: number, height: number): void {
    this.clear()
    this.budget = width * height * 4
    this.entryBudget = Math.max(1, Math.floor(this.budget / 64))
  }

  get(key: string, rasterize: () => GlyphBitmap | undefined): ResidentStamp | undefined {
    if (this.entries.has(key)) {
      const old = this.entries.get(key)
      this.entries.delete(key)
      this.entries.set(key, old)
      this.metrics.hits += 1
      return old
    }
    this.metrics.misses += 1
    this.metrics.rasterCalls += 1
    const bitmap = rasterize()
    const bytes = bitmap?.pixels.byteLength ?? 0
    this.metrics.rasterPayloadBytes += bytes
    if (bytes > this.budget)
      throw createGhosttyError('canvas.stamp', 'Canvas raster stamp exceeds the viewport extent')
    this.reserve(bytes)
    const entry = bitmap ? this.store(bitmap) : undefined
    this.entries.set(key, entry)
    this.metrics.residentBytes += bytes
    this.metrics.residentEntries = this.entries.size
    return entry
  }

  clear(): void {
    for (const entry of this.entries.values()) {
      if (entry) this.storage.release(entry.offset, entry.bytes)
    }
    this.entries.clear()
    this.generation += 1
    this.metrics.residentBytes = 0
    this.metrics.residentEntries = 0
  }

  dispose(): void {
    this.clear()
    this.budget = 0
    this.entryBudget = 0
  }

  private store(bitmap: GlyphBitmap): ResidentStamp {
    const bytes = bitmap.pixels.byteLength
    const channels = bitmap.kind === 'grayscale' ? 1 : 4
    if (
      !Number.isSafeInteger(bitmap.width) ||
      !Number.isSafeInteger(bitmap.height) ||
      bitmap.width <= 0 ||
      bitmap.height <= 0 ||
      bytes !== bitmap.width * bitmap.height * channels
    )
      throw createGhosttyError('canvas.stamp', 'Canvas raster stamp has invalid dimensions')
    const offset = this.storage.allocate(bytes)
    try {
      const buffer = this.storage.memory.buffer
      if (!(buffer instanceof ArrayBuffer))
        throw createGhosttyError('canvas.stamp', 'Canvas pixels require ordinary WASM memory')
      new Uint8Array(buffer, offset, bytes).set(bitmap.pixels)
    } catch (cause) {
      this.storage.release(offset, bytes)
      throw cause
    }
    this.metrics.stampCopies += 1
    this.metrics.stampCopiedBytes += bytes
    return {
      offset,
      bytes,
      width: bitmap.width,
      height: bitmap.height,
      left: bitmap.offsetX,
      top: bitmap.offsetY,
      encoding: channels === 1 ? 'a8' : 'rgba',
      generation: this.generation,
    }
  }

  private reserve(bytes: number): void {
    while (
      this.entries.size &&
      (this.metrics.residentBytes + bytes > this.budget || this.entries.size >= this.entryBudget)
    ) {
      const [key, entry] = this.entries.entries().next().value!
      if (entry) this.storage.release(entry.offset, entry.bytes)
      this.entries.delete(key)
      this.metrics.residentBytes -= entry?.bytes ?? 0
      this.metrics.evictions += 1
    }
    this.metrics.residentEntries = this.entries.size
  }
}
