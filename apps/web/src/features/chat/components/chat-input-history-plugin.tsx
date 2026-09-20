import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import {
  $getSelection,
  $isRangeSelection,
  COMMAND_PRIORITY_NORMAL,
  KEY_ARROW_DOWN_COMMAND,
  KEY_ARROW_UP_COMMAND,
} from 'lexical'
import { useEffect, useRef } from 'react'
import { sessionIdSchema } from '@workspace/contracts'
import * as v from 'valibot'
import { useEnvironmentId } from '@/lib/environments/hooks/use-environment-id'
import {
  useChatProjectionStore,
  selectChatProjectionSlice,
} from '@/features/chat/state/chat-projection-store'
import { selectChatSessionById } from '@workspace/client-core/chat/selectors'
import { useChatInputDraftStore } from '@/features/chat/state/chat-input-draft-store'
import {
  $readChatInputTextSnapshot,
  $setChatInputText,
} from '@/features/chat/utils/input-editor-actions'
import {
  promptHistoryEntries,
  stepPromptHistory,
  type PromptHistoryEntry,
} from '@/features/chat/utils/prompt-history'

export function ChatInputHistoryPlugin({
  draftKey,
  rootPath,
  disabled,
}: {
  draftKey: string
  rootPath: string
  disabled: boolean
}) {
  const [editor] = useLexicalComposerContext()
  const environmentId = useEnvironmentId()
  const position = useRef<PromptHistoryEntry | null>(null)

  useEffect(() => {
    position.current = null
    const navigate = (direction: 'backward' | 'forward', event: KeyboardEvent) => {
      if (
        disabled ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        event.shiftKey ||
        event.isComposing
      )
        return false
      const target = { environmentId, rootPath, draftKey }
      const draft = useChatInputDraftStore.getState().getDraft(target)
      if (draft.attachments.length || draft.terminalContexts.length) return false
      const selection = $getSelection()
      if (!$isRangeSelection(selection) || !selection.isCollapsed()) return false
      const { text, cursor } = $readChatInputTextSnapshot()
      if (direction === 'backward' && text.slice(0, cursor).includes('\n')) return false
      if (direction === 'forward' && text.slice(cursor).includes('\n')) return false
      const parsed = v.safeParse(sessionIdSchema, draftKey)
      if (!parsed.success) return false
      const session = selectChatSessionById(
        selectChatProjectionSlice(useChatProjectionStore.getState(), environmentId),
        parsed.output,
      )
      if (!session || session.pendingApprovalCount || session.pendingUserInputCount) return false
      const next = stepPromptHistory({
        direction,
        current: text,
        entries: promptHistoryEntries(session.messages),
        position: position.current,
      })
      if (next === undefined) return false
      position.current = next
      $setChatInputText(next?.prompt ?? '')
      useChatInputDraftStore.getState().setPrompt(target, next?.prompt ?? '')
      event.preventDefault()
      return true
    }
    const up = editor.registerCommand(
      KEY_ARROW_UP_COMMAND,
      (event) => navigate('backward', event),
      COMMAND_PRIORITY_NORMAL,
    )
    const down = editor.registerCommand(
      KEY_ARROW_DOWN_COMMAND,
      (event) => navigate('forward', event),
      COMMAND_PRIORITY_NORMAL,
    )
    return () => {
      up()
      down()
    }
  }, [disabled, draftKey, editor, environmentId, rootPath])

  return null
}
