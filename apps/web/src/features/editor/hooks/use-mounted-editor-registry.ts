import { use } from 'react'

import { MountedEditorContext } from '@/features/editor/providers/mounted-editor-context'
import { clientErrors } from '@/lib/structured-errors'

export function useMountedEditorRegistry() {
  const registry = use(MountedEditorContext)
  if (registry) return registry

  throw clientErrors.CONTEXT_MISSING({
    message: 'useMountedEditorRegistry must be used within a MountedEditorProvider',
  })
}
