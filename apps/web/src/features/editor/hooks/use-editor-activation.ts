import { use } from 'react'

import { EditorActivationContext } from '@/features/editor/providers/file-open-activation-context'
import { clientErrors } from '@/lib/structured-errors'

export function useEditorActivation() {
  const activation = use(EditorActivationContext)
  if (activation) return activation

  throw clientErrors.CONTEXT_MISSING({
    message: 'useEditorActivation must be used within EditorStateProvider',
  })
}
