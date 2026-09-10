import { useEffect, useState, useSyncExternalStore, type ReactNode } from 'react'
import { useHostActions } from '@/host/hooks/use-host-actions'
import { HostActionsContext } from '@/host/providers/actions-context'
import { createTextEditor } from '@/editor/state/editor'
import { TextEditor } from '@/editor/components/editor'
import type { Theme } from '@/theme/utils/theme'

export function EditorProvider({ children, theme }: { children: ReactNode; theme: Theme }) {
  const host = useHostActions()
  const [editor] = useState(createTextEditor)
  const request = useSyncExternalStore(editor.subscribe, editor.getSnapshot)
  useEffect(() => () => editor.dispose(), [editor])
  return (
    <HostActionsContext value={{ ...host, editText: host.editText ?? editor.editText }}>
      {children}
      {request && <TextEditor request={request} theme={theme} onComplete={editor.complete} />}
    </HostActionsContext>
  )
}
