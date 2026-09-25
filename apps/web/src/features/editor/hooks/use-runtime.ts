import { use } from 'react'

import { EditorRuntimeContext } from '@/features/editor/providers/runtime-context'
import { requireContext } from '@/lib/require-context'

export function useEditorRuntime() {
  const runtime = use(EditorRuntimeContext)
  requireContext(runtime, 'useEditorRuntime must be used within EditorStateProvider')
  return runtime
}
