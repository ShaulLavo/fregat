import { use } from 'react'

import { PaletteContext } from '@/lib/appearance/providers/palette-context'
import { clientErrors } from '@/lib/structured-errors'

export function usePalette() {
  const context = use(PaletteContext)
  if (context) return context

  throw clientErrors.CONTEXT_MISSING({
    message: 'usePalette must be used within AppearanceProvider',
  })
}
