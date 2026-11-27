import { selectChatSessionById } from '@workspace/client-core/chat/selectors'
import { sessionIdSchema } from '@workspace/contracts'
import { useEffect, useRef } from 'react'
import * as v from 'valibot'

import { useChatInputEditor } from '@/features/chat/providers/composer-editor-context'
import { useChatInputDraftStore } from '@/features/chat/state/chat-input-draft-store'
import {
  selectChatProjectionSlice,
  useChatProjectionStore,
} from '@/features/chat/state/chat-projection-store'
import {
  readChatInputTextSnapshot,
  setChatInputText,
} from '@/features/chat/utils/input-editor-actions'
import {
  promptHistoryEntries,
  stepPromptHistory,
  type PromptHistoryEntry,
} from '@/features/chat/utils/prompt-history'
import { useEnvironmentId } from '@/lib/environments/hooks/use-environment-id'

export function ChatInputHistoryPlugin({
  draftKey,
  rootPath,
  disabled,
}: {
  draftKey: string
  rootPath: string
  disabled: boolean
}) {
  const editor = useChatInputEditor()
  const environmentId = useEnvironmentId()
  const position = useRef<PromptHistoryEntry | null>(null)

  useEffect(() => {
    position.current = null
    if (!editor) return
    const inputElement = editor.getInputElement()

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return
      if (
        disabled ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        event.shiftKey ||
        event.isComposing ||
        editor.isComposing()
      )
        return
      const direction = event.key === 'ArrowUp' ? 'backward' : 'forward'
      const target = { environmentId, rootPath, draftKey }
      const draft = useChatInputDraftStore.getState().getDraft(target)
      if (draft.attachments.length || draft.terminalContexts.length) return
      const selection = editor.getSelectionOffsets()
      if (selection.anchor !== selection.focus) return
      const { text, cursor } = readChatInputTextSnapshot(editor)
      if (direction === 'backward' && text.slice(0, cursor).includes('\n')) return
      if (direction === 'forward' && text.slice(cursor).includes('\n')) return
      const parsed = v.safeParse(sessionIdSchema, draftKey)
      if (!parsed.success) return
      const session = selectChatSessionById(
        selectChatProjectionSlice(useChatProjectionStore.getState(), environmentId),
        parsed.output,
      )
      if (!session || session.pendingApprovalCount || session.pendingUserInputCount) return
      const next = stepPromptHistory({
        direction,
        current: text,
        entries: promptHistoryEntries(session.messages),
        position: position.current,
      })
      if (next === undefined) return
      position.current = next
      setChatInputText(editor, next?.prompt ?? '')
      useChatInputDraftStore.getState().setPrompt(target, next?.prompt ?? '')
      event.preventDefault()
      event.stopPropagation()
    }

    inputElement.addEventListener('keydown', onKeyDown, true)
    return () => inputElement.removeEventListener('keydown', onKeyDown, true)
  }, [disabled, draftKey, editor, environmentId, rootPath])

  return null
}
