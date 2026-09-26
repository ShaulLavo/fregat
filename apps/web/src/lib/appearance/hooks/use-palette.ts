import { use } from 'react'

import { PaletteContext } from '@/lib/appearance/providers/palette-context'
import { requireContext } from '@/lib/require-context'

export function usePalette() {
  const context = use(PaletteContext)
  requireContext(context, 'usePalette must be used within AppearanceProvider')
  return context
}
