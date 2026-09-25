import { use } from 'react'

import { CommandContext } from '@/keymap/providers/command-context'
import { requireContext } from '@/lib/require-context'

export function useCommand() {
  const context = use(CommandContext)
  requireContext(context, 'useCommand must be used within CommandProvider')
  return context
}
