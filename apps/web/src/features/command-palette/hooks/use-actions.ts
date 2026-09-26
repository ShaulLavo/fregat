import { use } from 'react'

import { CommandPaletteActionsContext } from '@/features/command-palette/providers/actions-context'
import { requireContext } from '@/lib/require-context'

export function useActions() {
  const actions = use(CommandPaletteActionsContext)
  requireContext(actions, 'useActions must be used within CommandPaletteActionsContext')
  return actions
}
