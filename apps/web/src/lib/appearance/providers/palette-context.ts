import type { Palette, PaletteId } from '@workspace/contracts'
import type { ResolvedPalette } from '@workspace/client-core/themes/palette'
import type { SettingsSubmission } from '@workspace/client-core/settings/intent-store'
import { createContext } from 'react'

export type PaletteContextValue = {
  /** The confirmed selection's id, even while it is still being looked up. */
  readonly paletteId: PaletteId
  /** Every palette that can be selected: bundled first, then the user library. */
  readonly catalog: readonly Palette[]
  /** The palette on screen, preview included, resolved for the current mode. */
  readonly resolved: ResolvedPalette
  readonly previewPalette: (palette: Palette) => void
  readonly clearPalettePreview: () => void
  readonly selectPalette: (id: PaletteId, initiator?: string) => SettingsSubmission
}

export const PaletteContext = createContext<PaletteContextValue | undefined>(undefined)
