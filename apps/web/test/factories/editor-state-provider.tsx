import { useSyncExternalStore, type ReactNode } from 'react'

import { EditorStateProvider } from '@/features/editor/providers/state-provider'
import { useApplicationRuntime } from '@/hooks/use-application-runtime'

export function TestEditorStateProvider({ children }: { readonly children: ReactNode }) {
  const application = useApplicationRuntime()
  const environment = useSyncExternalStore(application.subscribe, application.getSnapshot)
  return <EditorStateProvider runtime={environment.editor}>{children}</EditorStateProvider>
}
