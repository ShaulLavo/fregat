import { createError } from '@singapore-editor/core/logging/evlog'
import { LineWindow } from './window'

export class PagedSourceInvalidatedError extends Error {
  constructor(cause?: unknown) {
    super('The paged source revision is no longer available', { cause })
    this.name = 'PagedSourceInvalidatedError'
  }
}

export type RangeSource = {
  readonly id: string
  readonly revision: string
  readonly byteLength: number
  readBytes(
    start: number,
    end: number,
    signal: AbortSignal,
  ): Promise<{
    readonly revision: string
    readonly bytes: Uint8Array
  }>
}

export type PagedOptions = {
  readonly pageBytes: number
  readonly cacheBytes: number
  readonly checkpointLimit: number
  readonly checkpointStride: number
  readonly maxInFlight: number
  readonly maxViews: number
  readonly maxWindowUnits: number
  readonly maxWindowRows: number
}

export const PAGED_PROOF_OPTIONS: PagedOptions = {
  pageBytes: 65_536,
  cacheBytes: 8 * 1024 * 1024,
  checkpointLimit: 4096,
  checkpointStride: 262_144,
  maxInFlight: 2,
  maxViews: 2,
  maxWindowUnits: 512 * 1024,
  maxWindowRows: 128,
}

type Checkpoint = { byteOffset: number; utf16Offset: number; line: number }
export type PagedRow = { readonly line: number; readonly offset: number; readonly text: string }
export type PagedWindow = {
  readonly revision: string
  readonly rows: readonly PagedRow[]
  readonly truncated: boolean
}

type Waiter = { run(): void; abort(): void }

function failure(message: string, code = 'PAGED_DOCUMENT_INVALID') {
  return createError({ message, code, status: 422 })
}

function cancelled() {
  return new DOMException('Range request cancelled', 'AbortError')
}

/** Experimental UTF-8 read-only source. Positions count raw decoded UTF-16, including a BOM. */
export class PagedDocument {
  readonly #source: RangeSource
  readonly #options: PagedOptions
  readonly #lifetime = new AbortController()
  readonly #pages = new Map<number, Uint8Array>()
  readonly #waiters: Waiter[] = []
  #checkpoints: Checkpoint[] = [{ byteOffset: 0, utf16Offset: 0, line: 0 }]
  #stride: number
  #active = 0
  #views = 0
  #indexPromise: Promise<void> | null = null
  #state: 'indexing' | 'ready' | 'stale' | 'failed' | 'disposed' = 'indexing'
  #error: unknown = null
  readonly #progress = new Set<() => void>()
  #lines = 1
  #units = 0
  #bytesRead = 0
  #peakCache = 0
  #peakInFlight = 0

  constructor(source: RangeSource, options: PagedOptions = PAGED_PROOF_OPTIONS) {
    for (const value of Object.values(options))
      if (!Number.isSafeInteger(value) || value <= 0)
        throw failure('Paging limits must be positive integers')
    if (
      options.checkpointLimit < 2 ||
      options.pageBytes < 4 ||
      options.cacheBytes < options.pageBytes
    )
      throw failure('Paging requires two checkpoints and room for one page')
    if (!Number.isSafeInteger(source.byteLength) || source.byteLength < 0)
      throw failure('The source byte length is invalid')
    this.#source = source
    this.#options = { ...options }
    this.#stride = options.checkpointStride
  }

  get stats() {
    return {
      state: this.#state,
      lines: this.#lines,
      utf16Length: this.#units,
      checkpoints: this.#checkpoints.length,
      checkpointStride: this.#stride,
      cachedBytes: this.cachedBytes(),
      peakCachedBytes: this.#peakCache,
      inFlight: this.#active,
      peakInFlight: this.#peakInFlight,
      bytesRead: this.#bytesRead,
      views: this.#views,
    }
  }

  initialize(): Promise<void> {
    this.assertLive()
    this.#indexPromise ??= this.buildIndex().catch((error: unknown) => {
      if (this.#state === 'indexing') this.#state = 'failed'
      this.#error = error
      this.notifyProgress()
      throw error
    })
    return this.#indexPromise
  }

  createView() {
    this.assertLive()
    if (this.#views === this.#options.maxViews)
      throw failure('The paged document view limit was reached')
    this.#views++
    return new PagedDocumentView(
      (line, count, signal) => this.readLines(line, count, signal),
      (start, end, signal) => this.copyRange(start, end, signal),
      () => {
        this.#views--
      },
    )
  }

  dispose() {
    this.#state = 'disposed'
    this.#lifetime.abort()
    this.#pages.clear()
    this.#checkpoints = []
    this.notifyProgress()
  }

  private async readLines(line: number, count: number, signal: AbortSignal): Promise<PagedWindow> {
    this.assertLive()
    if (
      !Number.isSafeInteger(line) ||
      line < 0 ||
      !Number.isSafeInteger(count) ||
      count <= 0 ||
      count > this.#options.maxWindowRows
    )
      throw failure('Line requests need a nonnegative line and positive count')
    if (line >= this.#lines) await this.waitUntilIndexed(line, signal)
    signal.throwIfAborted()
    this.assertLive()
    if (this.#state === 'ready' && line >= this.#lines)
      throw failure('The line is outside the document')
    await this.validateSource(signal)
    const checkpoint = this.checkpointForLine(line)
    const window = new LineWindow(
      line,
      count,
      checkpoint,
      this.#options.maxWindowUnits,
      this.#source.revision,
    )
    for await (const text of this.decoded(checkpoint.byteOffset, signal))
      if (window.append(text)) return window.result()
    return window.finish()
  }

  private async copyRange(start: number, end: number, signal: AbortSignal): Promise<string> {
    this.assertLive()
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end < start)
      throw failure('Copy requires an ordered UTF-16 range')
    if (end - start > this.#options.maxWindowUnits)
      throw failure('The copy exceeds the paged range limit')
    await this.waitUntilIndexed(Number.POSITIVE_INFINITY, signal)
    if (end > this.#units) throw failure('The copy range is outside the document')
    await this.validateSource(signal)
    const checkpoint = this.checkpointForOffset(start)
    let offset = checkpoint.utf16Offset
    let result = ''
    for await (const text of this.decoded(checkpoint.byteOffset, signal)) {
      result += text.slice(Math.max(0, start - offset), Math.max(0, end - offset))
      offset += text.length
      if (offset >= end) return result
    }
    return result
  }

  private notifyProgress() {
    for (const listener of this.#progress) listener()
  }

  private async waitUntilIndexed(line: number, signal: AbortSignal) {
    signal.throwIfAborted()
    void this.initialize().catch(() => {})
    await new Promise<void>((resolve, reject) => {
      const finish = () => {
        this.#progress.delete(progress)
        signal.removeEventListener('abort', abort)
      }
      const abort = () => {
        finish()
        reject(cancelled())
      }
      const progress = () => {
        if (line >= this.#lines && this.#state === 'indexing') return
        finish()
        resolve()
      }
      this.#progress.add(progress)
      signal.addEventListener('abort', abort, { once: true })
      progress()
    })
    signal.throwIfAborted()
    this.assertLive()
  }

  private async buildIndex() {
    const decoder = new TextDecoder('utf-8', { ignoreBOM: true })
    let units = 0
    let line = 0
    for (let start = 0; start < this.#source.byteLength; start += this.#options.pageBytes) {
      const bytes = await this.page(start, this.#lifetime.signal)
      let decodedThrough = 0
      for (let at = bytes.indexOf(10); at !== -1; at = bytes.indexOf(10, at + 1)) {
        line++
        const position = start + at + 1
        const last = this.#checkpoints[this.#checkpoints.length - 1]!
        if (position - last.byteOffset < this.#stride) continue
        units += decoder.decode(bytes.subarray(decodedThrough, at + 1), { stream: true }).length
        decodedThrough = at + 1
        this.addCheckpoint({ byteOffset: position, utf16Offset: units, line })
      }
      units += decoder.decode(bytes.subarray(decodedThrough), { stream: true }).length
      this.#lines = line + 1
      this.#units = units
      this.notifyProgress()
      if ((start + this.#options.pageBytes) % (1024 * 1024) === 0)
        // @justification Yields once per MiB so indexing a large source never holds the thread; it
        // only resolves the awaited promise, and the next page read carries the lifetime signal.
        await new Promise<void>((resolve) => setTimeout(resolve, 0))
    }
    this.#units = units + decoder.decode().length
    this.assertLive()
    this.#state = 'ready'
    this.notifyProgress()
  }

  private addCheckpoint(checkpoint: Checkpoint) {
    this.#checkpoints.push(checkpoint)
    if (this.#checkpoints.length < this.#options.checkpointLimit) return
    this.#checkpoints = this.#checkpoints.filter((_value, index) => index % 2 === 0)
    this.#stride *= 2
  }

  private checkpointForLine(line: number) {
    return this.#checkpoints.findLast((checkpoint) => checkpoint.line <= line)!
  }

  private checkpointForOffset(offset: number) {
    return this.#checkpoints.findLast((checkpoint) => checkpoint.utf16Offset <= offset)!
  }

  private async *decoded(start: number, signal: AbortSignal) {
    const decoder = new TextDecoder('utf-8', { ignoreBOM: true })
    for (let at = start; at < this.#source.byteLength;) {
      const pageStart = Math.floor(at / this.#options.pageBytes) * this.#options.pageBytes
      const bytes = await this.page(pageStart, signal)
      signal.throwIfAborted()
      const slice = bytes.subarray(at - pageStart)
      yield decoder.decode(slice, { stream: true })
      at += slice.length
    }
    yield decoder.decode()
  }

  private async page(start: number, signal: AbortSignal): Promise<Uint8Array> {
    this.assertLive()
    signal.throwIfAborted()
    const cached = this.#pages.get(start)
    if (cached) {
      this.#pages.delete(start)
      this.#pages.set(start, cached)
      return cached
    }
    const combined = AbortSignal.any([signal, this.#lifetime.signal])
    await this.acquire(combined)
    try {
      const end = Math.min(start + this.#options.pageBytes, this.#source.byteLength)
      const result = await this.readSource(start, end, combined)
      this.#bytesRead += result.bytes.byteLength
      combined.throwIfAborted()
      if (result.revision !== this.#source.revision) this.invalidate()
      if (result.bytes.byteLength !== end - start)
        throw failure('The range source returned an incomplete page')
      if (start === 0) rejectUtf16(result.bytes)
      this.#pages.delete(start)
      this.evictFor(result.bytes.byteLength)
      const bytes =
        result.bytes.byteLength === result.bytes.buffer.byteLength
          ? result.bytes
          : result.bytes.slice()
      this.#pages.set(start, bytes)
      this.#peakCache = Math.max(this.#peakCache, this.cachedBytes())
      return bytes
    } finally {
      this.#active--
      this.#waiters.shift()?.run()
    }
  }

  private async validateSource(signal: AbortSignal) {
    const combined = AbortSignal.any([signal, this.#lifetime.signal])
    await this.acquire(combined)
    try {
      // Cached bytes cannot observe a disk change; one empty range validates each view operation.
      const result = await this.readSource(0, 0, combined)
      combined.throwIfAborted()
      if (result.revision !== this.#source.revision) this.invalidate()
      if (result.bytes.byteLength !== 0)
        throw failure('The range source returned bytes for an empty range')
    } finally {
      this.#active--
      this.#waiters.shift()?.run()
    }
  }

  private async readSource(start: number, end: number, signal: AbortSignal) {
    try {
      return await this.#source.readBytes(start, end, signal)
    } catch (error) {
      signal.throwIfAborted()
      if (error instanceof PagedSourceInvalidatedError) this.invalidate()
      throw error
    }
  }

  private cachedBytes() {
    let bytes = 0
    for (const page of this.#pages.values()) bytes += page.byteLength
    return bytes
  }

  private evictFor(bytes: number) {
    while (this.cachedBytes() + bytes > this.#options.cacheBytes) {
      const first = this.#pages.keys().next().value
      if (first === undefined) break
      this.#pages.delete(first)
    }
  }

  private async acquire(signal: AbortSignal) {
    while (this.#active >= this.#options.maxInFlight) await this.waitForSlot(signal)
    signal.throwIfAborted()
    this.#active++
    this.#peakInFlight = Math.max(this.#peakInFlight, this.#active)
  }

  private waitForSlot(signal: AbortSignal): Promise<void> {
    signal.throwIfAborted()
    return new Promise((resolve, reject) => {
      const waiter: Waiter = {
        run: () => {
          signal.removeEventListener('abort', waiter.abort)
          resolve()
        },
        abort: () => {
          const index = this.#waiters.indexOf(waiter)
          if (index !== -1) this.#waiters.splice(index, 1)
          reject(cancelled())
        },
      }
      this.#waiters.push(waiter)
      signal.addEventListener('abort', waiter.abort, { once: true })
    })
  }

  private invalidate(): never {
    this.#state = 'stale'
    this.#lifetime.abort()
    this.#pages.clear()
    this.#checkpoints = []
    this.notifyProgress()
    throw failure('The file changed during the paged read', 'PAGED_DOCUMENT_STALE')
  }

  private assertLive() {
    if (this.#state === 'failed') throw this.#error
    if (this.#state === 'stale' || this.#state === 'disposed')
      throw failure(`The paged document is ${this.#state}`)
  }
}

function rejectUtf16(bytes: Uint8Array) {
  if ((bytes[0] === 0xff && bytes[1] === 0xfe) || (bytes[0] === 0xfe && bytes[1] === 0xff))
    throw failure(
      'The paged proof supports UTF-8; UTF-16 requires a resident editor',
      'PAGED_ENCODING_UNSUPPORTED',
    )
}

export class PagedDocumentView {
  #request: AbortController | null = null
  #disposed = false
  constructor(
    private readonly read: (
      line: number,
      count: number,
      signal: AbortSignal,
    ) => Promise<PagedWindow>,
    private readonly copy: (start: number, end: number, signal: AbortSignal) => Promise<string>,
    private readonly release: () => void,
  ) {}

  readLines(line: number, count: number, signal?: AbortSignal) {
    return this.read(line, count, this.begin(signal))
  }

  copyRange(start: number, end: number, signal?: AbortSignal) {
    return this.copy(start, end, this.begin(signal))
  }

  cancel() {
    this.#request?.abort()
    this.#request = null
  }

  dispose() {
    if (this.#disposed) return
    this.#disposed = true
    this.cancel()
    this.release()
  }

  private begin(signal?: AbortSignal) {
    if (this.#disposed) throw failure('The paged view is disposed')
    this.cancel()
    this.#request = new AbortController()
    return signal ? AbortSignal.any([signal, this.#request.signal]) : this.#request.signal
  }
}
