import { use } from 'react'

import { FileTreeActionsContext } from '@/features/workspace/providers/actions-context'
import { requireContext } from '@/lib/require-context'

export function useFileTreeActions() {
  const actions = use(FileTreeActionsContext)
  requireContext(actions, 'useFileTreeActions must be used within FileTreeActionsContext')
  return actions
}
