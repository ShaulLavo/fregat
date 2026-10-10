export { decodeSnapshot as decodePaintSnapshot } from './editor/documentPaint'
export type {
  PaintSnapshot,
  SavedDocumentPaint,
  DocumentPaintCapture,
} from './editor/documentPaint'
export type { MountedPaintSnapshot } from './virtualization/documentPaintRows'
import type { PaintSnapshot } from './editor/documentPaint'
import { mountDocumentPaint } from './virtualization/documentPaintRows'
import {
  activateDocumentPaintHighlights,
  prepareDocumentPaintHighlights,
  revealDocumentPaintHighlights,
} from './virtualization/documentPaintHighlights'
export type { ActivatedPaintSnapshotHighlights } from './virtualization/documentPaintHighlights'

export function mountPaintSnapshot(
  element: HTMLElement,
  paint: PaintSnapshot,
  options: { readonly width?: number } = {},
) {
  return paint.format === 6 ? mountDocumentPaint(element, paint, options) : null
}

/** Gate streamed snapshot visibility before inserting markup; release when parsing ends. */
export function preparePaintSnapshotHighlights(document: Document): void {
  prepareDocumentPaintHighlights(document)
}

/** Attach syntax paint to emitted snapshot HTML before its first visible frame. */
export function activatePaintSnapshotHighlights(element: HTMLElement, paint: PaintSnapshot) {
  try {
    return paint.format === 6 ? activateDocumentPaintHighlights(element, paint) : null
  } finally {
    revealDocumentPaintHighlights(element)
  }
}
