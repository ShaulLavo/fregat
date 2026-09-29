import type { DisplayTextRowSource } from './displayTransforms'
import type { SuspiciousCharacterKind } from './unicodeHighlight'

export type EditorPointHit = {
  readonly bufferRow: number
  readonly displayRow: number
  readonly source: DisplayTextRowSource
  readonly region: 'text' | 'gutter' | 'trailing'
  readonly offset: number | null
}

export type EditorMarkerHit = {
  readonly kind: 'space' | 'tab' | SuspiciousCharacterKind
  readonly offset: number
}
