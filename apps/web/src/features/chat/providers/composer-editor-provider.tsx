import { useCallback, useMemo, useState, type ReactNode } from 'react'

import type { ChatInputEditorHandle } from '@/features/chat/utils/input-editor-actions'
import {
  ChatInputEditorContext,
  type ChatInputEditorContextValue,
} from '@/features/chat/providers/composer-editor-context'

export function ChatInputEditorProvider({ children }: { readonly children: ReactNode }) {
  const [editor, setEditor] = useState<ChatInputEditorHandle | null>(null)
  const registerEditor = useCallback((next: ChatInputEditorHandle | null) => {
    setEditor(next)
  }, [])
  const value = useMemo<ChatInputEditorContextValue>(
    () => ({ editor, registerEditor }),
    [editor, registerEditor],
  )

  return <ChatInputEditorContext value={value}>{children}</ChatInputEditorContext>
}
