import { createContext, use } from 'react'

import type { ChatInputEditorHandle } from '@/features/chat/utils/input-editor-actions'

export type ChatInputEditorContextValue = {
  readonly editor: ChatInputEditorHandle | null
  readonly registerEditor: (editor: ChatInputEditorHandle | null) => void
}

export const ChatInputEditorContext = createContext<ChatInputEditorContextValue | null>(null)

export function useChatInputEditor(): ChatInputEditorHandle | null {
  return use(ChatInputEditorContext)?.editor ?? null
}

export function useRegisterChatInputEditor(): (editor: ChatInputEditorHandle | null) => void {
  const value = use(ChatInputEditorContext)
  return value ? value.registerEditor : () => undefined
}
