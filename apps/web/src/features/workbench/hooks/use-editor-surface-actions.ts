import { use } from 'react'

import { EditorSurfaceActionsContext } from '@/features/workbench/providers/editor-surface-actions-context'
import { requireContext } from '@/lib/require-context'

export function useEditorSurfaceActions() {
  const actions = use(EditorSurfaceActionsContext)
  requireContext(actions, 'useEditorSurfaceActions must be used within EditorSurfaceActionsContext')
  return actions
}
