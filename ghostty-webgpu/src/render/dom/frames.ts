import type { RenderSchedulerClock } from '../scheduler.js'

interface PositionedSurface {
  measure(): void
  position(): void
}

const documents = new WeakMap<Document, DocumentFrames>()

export class DocumentFrames implements RenderSchedulerClock {
  private readonly surfaces = new Set<PositionedSurface>()
  private readonly callbacks = new Map<number, () => void>()
  private readonly view: Window
  private handle?: number
  private next = 0
  painting = false

  private constructor(private readonly document: Document) {
    this.view = document.defaultView!
  }

  static forDocument(document: Document): DocumentFrames {
    let frames = documents.get(document)
    if (!frames) {
      frames = new DocumentFrames(document)
      documents.set(document, frames)
    }
    return frames
  }

  add(surface: PositionedSurface): void {
    if (this.surfaces.size === 0)
      this.document.addEventListener('visibilitychange', this.visibilityChanged)
    this.surfaces.add(surface)
    this.schedule()
  }

  remove(surface: PositionedSurface): void {
    this.surfaces.delete(surface)
    if (this.surfaces.size > 0) return
    this.document.removeEventListener('visibilitychange', this.visibilityChanged)
    this.cancel()
  }

  requestFrame(callback: () => void): number {
    const handle = ++this.next
    this.callbacks.set(handle, callback)
    this.schedule()
    return handle
  }

  cancelFrame(handle: number): void {
    this.callbacks.delete(handle)
  }

  setTimer(callback: () => void, delayMs: number): number {
    return this.view.setTimeout(callback, delayMs)
  }

  clearTimer(handle: number): void {
    this.view.clearTimeout(handle)
  }

  private readonly visibilityChanged = (): void => {
    if (this.document.hidden) this.cancel()
    else this.schedule()
  }

  private cancel(): void {
    if (this.handle !== undefined) this.view.cancelAnimationFrame(this.handle)
    this.handle = undefined
  }

  private schedule(): void {
    if (this.handle !== undefined || this.document.hidden || this.surfaces.size === 0) return
    this.handle = this.view.requestAnimationFrame(this.frame)
  }

  private readonly frame = (): void => {
    this.handle = undefined
    const callbacks = [...this.callbacks.values()]
    this.callbacks.clear()
    try {
      // Every geometry read precedes row writes, including surfaces whose terminal is idle.
      for (const surface of this.surfaces) surface.measure()
      for (const surface of this.surfaces) surface.position()
      this.painting = true
      for (const callback of callbacks) {
        try {
          callback()
        } catch (error) {
          this.view.reportError(error)
        }
      }
    } finally {
      this.painting = false
      // CSSOM edits and flow movement have no observer that covers every position change.
      this.schedule()
    }
  }
}
