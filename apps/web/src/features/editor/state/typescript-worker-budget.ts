import type { EditorTextBuffer, TextReadSnapshot } from '@singapore-editor/core/document'
import type { EditorDocumentStoreApi } from './document-state'
import { clientErrors } from '@/lib/structured-errors'
import {
  editedByteDelta,
  snapshotBytes,
  textBytes,
} from '@/features/editor/utils/typescript-worker-bytes'
import { virtualPath } from '@/features/editor/utils/typescript-worker-paths'

type Live = {
  readonly buffer: EditorTextBuffer
  snapshot: TextReadSnapshot
  bytes: number
  unsubscribe(): void
}
export class WorkerBudget {
  private readonly disk = new Map<string, number>()
  private readonly live = new Map<string, Live>()
  private bytes = 0
  private count = 0
  private readonly unsubscribe: () => void

  constructor(
    private readonly options: {
      store: EditorDocumentStoreApi
      maxFiles: number
      maxBytes: number
      includes(path: string): boolean
      onRelease(path: string): void
      onError(error: unknown): void
    },
  ) {
    this.unsubscribe = options.store.subscribe((state, previous) => {
      if (state.liveDocumentsByKey === previous.liveDocumentsByKey) return
      this.reconcile()
    })
  }

  setDisk(files: readonly { path: string; text: string }[]) {
    this.disk.clear()
    for (const file of files) this.disk.set(file.path, textBytes(file.text))
    this.bytes = [...this.disk.values()].reduce((sum, bytes) => sum + bytes, 0)
    this.count = this.disk.size
    for (const [path, live] of this.live) {
      this.bytes += live.bytes - (this.disk.get(path) ?? 0)
      if (!this.disk.has(path)) this.count++
    }
    this.reconcile()
    this.check()
  }

  upsertDisk(files: readonly { path: string; text: string }[]) {
    for (const file of files) {
      const bytes = textBytes(file.text)
      if (!this.live.has(file.path)) this.bytes += bytes - (this.disk.get(file.path) ?? 0)
      if (!this.disk.has(file.path) && !this.live.has(file.path)) this.count++
      this.disk.set(file.path, bytes)
    }
    this.check()
  }

  deleteDisk(paths: readonly string[]) {
    for (const path of paths) {
      const bytes = this.disk.get(path)
      if (bytes === undefined) continue
      this.disk.delete(path)
      if (this.live.has(path)) continue
      this.bytes -= bytes
      this.count--
    }
  }

  dispose() {
    this.unsubscribe()
    for (const live of this.live.values()) live.unsubscribe()
    this.live.clear()
  }

  private reconcile() {
    const retained = new Set<string>()
    for (const document of Object.values(this.options.store.getState().liveDocumentsByKey)) {
      if (document.target.kind !== 'file') continue
      const path = virtualPath(document.target.resource.path)
      if (!this.options.includes(path)) continue
      retained.add(path)
      if (this.live.get(path)?.buffer === document.buffer) continue
      this.release(path, false)
      this.attach(path, document.buffer)
    }
    for (const path of this.live.keys()) if (!retained.has(path)) this.release(path, true)
  }

  private attach(path: string, buffer: EditorTextBuffer) {
    const snapshot = buffer.getTextSnapshot()
    const live: Live = {
      buffer,
      snapshot,
      bytes: snapshotBytes(snapshot),
      unsubscribe: () => undefined,
    }
    this.bytes += live.bytes - (this.disk.get(path) ?? 0)
    if (!this.disk.has(path)) this.count++
    live.unsubscribe = buffer.subscribe(({ change }) => {
      if (change.textSnapshot === live.snapshot) return
      const bytes = change.edits.length
        ? live.bytes + editedByteDelta(live.snapshot, change.edits)
        : snapshotBytes(change.textSnapshot)
      this.bytes += bytes - live.bytes
      live.bytes = bytes
      live.snapshot = change.textSnapshot
      this.checkSafely()
    })
    this.live.set(path, live)
    this.checkSafely()
  }

  private release(path: string, restore: boolean) {
    const live = this.live.get(path)
    if (!live) return
    live.unsubscribe()
    this.live.delete(path)
    this.bytes += (this.disk.get(path) ?? 0) - live.bytes
    if (!this.disk.has(path)) this.count--
    if (restore) this.options.onRelease(path)
  }

  private checkSafely() {
    try {
      this.check()
    } catch (error) {
      this.options.onError(error)
    }
  }
  private check() {
    if (this.bytes <= this.options.maxBytes && this.count <= this.options.maxFiles) return
    throw clientErrors.TYPESCRIPT_WORKER_LIMIT({
      files: this.count,
      bytes: this.bytes,
      internal: { maxBytes: this.options.maxBytes, maxFiles: this.options.maxFiles },
    })
  }
}
