import { useStore } from 'zustand'
import { useEffect, useState, type ReactNode } from 'react'
import { useHostActions } from '@/host/hooks/use-host-actions'
import { HostActionsContext, type EditTextRequest } from '@/host/providers/actions-context'
import { createTextEditor } from '@/editor/state/editor'

export function EditorProvider({
  children,
  renderEditor,
}: {
  children: ReactNode
  renderEditor: (request: EditTextRequest, complete: (text: string | null) => void) => ReactNode
}) {
  const host = useHostActions()
  const [editor] = useState(createTextEditor)
  const request = useStore(editor.store)
  useEffect(() => () => editor.dispose(), [editor])
  return (
    <HostActionsContext value={{ ...host, editText: host.editText ?? editor.editText }}>
      {children}
      {request && renderEditor(request, editor.complete)}
    </HostActionsContext>
  )
}
