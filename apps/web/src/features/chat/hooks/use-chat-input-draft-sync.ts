import type { Editor } from '@singapore-editor/core/editor'
import { useEffect } from 'react'

import {
  useChatInputDraftStore,
  type ChatInputDraftTarget,
} from '@/features/chat/state/chat-input-draft-store'
import { syncChatInputText } from '@/features/chat/utils/input-editor-actions'

/** The draft store owns the prompt; the editor mirrors it without taking undo entries for it. */
export function useChatInputDraftSync(editor: Editor | null, target: ChatInputDraftTarget) {
  useEffect(() => {
    if (!editor) return

    const sync = () =>
      syncChatInputText(editor, useChatInputDraftStore.getState().getDraft(target).prompt)
    sync()
    return useChatInputDraftStore.subscribe(sync)
  }, [editor, target])
}
