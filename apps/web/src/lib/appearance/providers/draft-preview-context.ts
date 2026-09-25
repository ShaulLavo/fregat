import type { ColorMode, Palette, ThemeBundle } from '@workspace/contracts'
import { createContext } from 'react'

export type DraftPreview = {
  readonly bundle: ThemeBundle
  readonly mode: ColorMode | null
  readonly palette: Palette | null
}

export const DraftPreviewContext = createContext<((preview: DraftPreview | null) => void) | null>(
  null,
)
