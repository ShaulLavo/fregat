import { clamp } from '../style-utils'
import type { EditorScrollPosition } from './types'

export const DOCUMENT_START_SCROLL_POSITION = {
  top: 0,
  left: 0,
} satisfies Required<EditorScrollPosition>

export function normalizeScrollOffset(
  value: number | undefined,
  fallback: number,
  maxValue: number,
): number {
  if (value === undefined) return fallback
  if (!Number.isFinite(value)) return fallback

  return clamp(value, 0, Math.max(0, maxValue))
}

export function preservedScrollPosition(
  current: Required<EditorScrollPosition>,
  override: EditorScrollPosition | undefined,
): Required<EditorScrollPosition> {
  return {
    top: override?.top ?? current.top,
    left: override?.left ?? current.left,
  }
}
