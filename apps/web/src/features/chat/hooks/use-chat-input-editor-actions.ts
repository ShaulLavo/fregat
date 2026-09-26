import { use } from 'react'

import { ChatInputEditorContext } from '@/features/chat/providers/chat-input-editor-context'
import { requireContext } from '@/lib/require-context'

export function useChatInputEditorActions() {
  const actions = use(ChatInputEditorContext)
  requireContext(actions, 'useChatInputEditorActions must be used within a chat composer')
  return actions
}
