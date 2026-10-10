export { decodeSnapshot as decodePaintSnapshot } from './editor/documentPaint'
export type {
  PaintSnapshot,
  SavedDocumentPaint,
  DocumentPaintCapture,
} from './editor/documentPaint'
export type { MountedPaintSnapshot } from './virtualization/documentPaintRows'
import type { PaintSnapshot } from './editor/documentPaint'
import { mountDocumentPaint } from './virtualization/documentPaintRows'

export function mountPaintSnapshot(
  element: HTMLElement,
  paint: PaintSnapshot,
  options: { readonly width?: number } = {},
) {
  return paint.format === 6 ? mountDocumentPaint(element, paint, options) : null
}
