import { use } from 'react'

import { MountedEditorContext } from '@/features/editor/providers/mounted-editor-context'
import { requireContext } from '@/lib/require-context'

export function useMountedEditorRegistry() {
  const registry = use(MountedEditorContext)
  requireContext(registry, 'useMountedEditorRegistry must be used within a MountedEditorProvider')
  return registry
}
