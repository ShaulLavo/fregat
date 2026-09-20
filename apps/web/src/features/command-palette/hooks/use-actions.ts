import { use } from 'react'

import { CommandPaletteActionsContext } from '@/features/command-palette/providers/actions-context'
import { clientErrors } from '@/lib/structured-errors'

export function useActions() {
  const actions = use(CommandPaletteActionsContext)
  if (!actions) {
    throw clientErrors.CONTEXT_MISSING({
      message: 'useActions must be used within CommandPaletteActionsContext',
    })
  }

  return actions
}
