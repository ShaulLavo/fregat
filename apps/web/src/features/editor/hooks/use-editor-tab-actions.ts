import { use } from 'react'

import { EditorTabActionsContext } from '@/features/editor/providers/tab-actions-context'
import { requireContext } from '@/lib/require-context'

export function useEditorTabActions() {
  const actions = use(EditorTabActionsContext)
  requireContext(actions, 'useEditorTabActions must be used within EditorTabActionsProvider')
  return actions
}
