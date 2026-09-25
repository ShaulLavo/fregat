import { createContext } from 'react'

export type FontSettingId = 'workbench.fontFamily' | 'editor.fontFamily'

export type FontPreviewContextValue = {
  /** Shows the whole app in `ref` until cleared; nothing is written. */
  readonly previewFont: (key: FontSettingId, ref: string) => void
  readonly clearFontPreview: () => void
}

export const FontPreviewContext = createContext<FontPreviewContextValue | undefined>(undefined)
