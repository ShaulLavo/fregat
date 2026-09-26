import type { Editor } from '@singapore-editor/core/editor'
import { sessionIdSchema } from '@workspace/contracts'
import { selectChatSessionById } from '@workspace/client-core/chat/selectors'
import { useEffect, useEffectEvent, useRef, type RefObject } from 'react'
import * as v from 'valibot'

import { useSettingValue } from '@/hooks/use-setting-value'
import {
  useChatInputDraftStore,
  type ChatInputDraftTarget,
} from '@/features/chat/state/chat-input-draft-store'
import {
  selectChatProjectionSlice,
  useChatProjectionStore,
} from '@/features/chat/state/chat-projection-store'
import { composerEnterIntent } from '@/features/chat/utils/enter-intent'
import {
  insertChatInputText,
  readChatInputTextSnapshot,
  setChatInputEditorText,
} from '@/features/chat/utils/input-editor-actions'
import { isPasteAsTextShortcut } from '@/features/chat/utils/pasted-text'
import {
  promptHistoryEntries,
  stepPromptHistory,
  type PromptHistoryEntry,
} from '@/features/chat/utils/prompt-history'

export type ChatInputKeyActions = {
  readonly commandMenuOpen: boolean
  readonly disabled: boolean
  readonly draftTarget: ChatInputDraftTarget
  readonly onCommandMenuCommit: () => boolean
  readonly onCommandMenuMove: (offset: number) => boolean
  readonly onSubmitRequest: (alternate?: boolean) => Promise<boolean>
}

/**
 * The composer's own keys, taken in the capture phase on the host so they run before the editor's:
 * send, the command menu, prompt history, and the paste-as-text chord. Keys an IME is composing
 * with are its own. Returns whether the paste-as-text chord just asked for the next paste inline,
 * clearing the request.
 */
export function useChatInputKeys(
  hostRef: RefObject<HTMLElement | null>,
  editor: Editor | null,
  actions: ChatInputKeyActions,
) {
  const sendShortcut = useSettingValue('chat.sendShortcut')
  const historyPosition = useRef<PromptHistoryEntry | null>(null)
  const inlinePasteUntil = useRef(0)
  const commitMenu = () => actions.commandMenuOpen && actions.onCommandMenuCommit()
  const recallPrompt = (
    current: Editor,
    event: KeyboardEvent,
    direction: 'backward' | 'forward',
  ) => {
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return false
    const next = nextHistoryPrompt(current, actions.draftTarget, direction, historyPosition.current)
    if (next === undefined) return false

    historyPosition.current = next
    setChatInputEditorText(current, next?.prompt ?? '')
    useChatInputDraftStore.getState().setPrompt(actions.draftTarget, next?.prompt ?? '')
    return true
  }

  const moveOrRecall = (current: Editor, event: KeyboardEvent, offset: 1 | -1) => {
    if (actions.commandMenuOpen) return actions.onCommandMenuMove(offset)

    return recallPrompt(current, event, offset < 0 ? 'backward' : 'forward')
  }
  const handleEnter = (current: Editor, event: KeyboardEvent) => {
    if (!event.shiftKey && commitMenu()) return true

    const intent = composerEnterIntent({
      modifierKey: event.metaKey || event.ctrlKey,
      prompt: current.materializeFullText(),
      sendShortcut,
      shiftKey: event.shiftKey,
    })
    if (intent === 'newline') return insertChatInputText(current, '\n')

    void actions.onSubmitRequest(intent === 'alternate')
    return true
  }
  const claimsKey = (current: Editor, event: KeyboardEvent) => {
    if (actions.disabled) return false
    if (event.key === 'Enter') return handleEnter(current, event)
    if (event.key === 'Tab') return !event.shiftKey && commitMenu()
    if (event.key === 'ArrowDown') return moveOrRecall(current, event, 1)
    if (event.key === 'ArrowUp') return moveOrRecall(current, event, -1)
    return false
  }
  const handleKeyDown = useEffectEvent((current: Editor, event: KeyboardEvent) => {
    if (event.isComposing || event.keyCode === 229) return
    if (isPasteAsTextShortcut(event)) inlinePasteUntil.current = Date.now() + 1_000
    if (!claimsKey(current, event)) return

    event.preventDefault()
    event.stopPropagation()
  })
  useEffect(() => {
    const host = hostRef.current
    if (!host || !editor) return

    historyPosition.current = null
    const listener = (event: KeyboardEvent) => handleKeyDown(editor, event)
    host.addEventListener('keydown', listener, true)
    return () => host.removeEventListener('keydown', listener, true)
  }, [editor, hostRef])

  return () => {
    const inline = Date.now() <= inlinePasteUntil.current
    inlinePasteUntil.current = 0
    return inline
  }
}

/** Up and Down walk sent prompts only from the prompt's first or last line, with nothing staged. */
function nextHistoryPrompt(
  editor: Editor,
  target: ChatInputDraftTarget,
  direction: 'backward' | 'forward',
  position: PromptHistoryEntry | null,
) {
  const draft = useChatInputDraftStore.getState().getDraft(target)
  if (draft.attachments.length > 0 || draft.terminalContexts.length > 0) return undefined
  const selection = editor.getSelections()
  if (selection.length !== 1 || selection[0]?.startOffset !== selection[0]?.endOffset)
    return undefined

  const { cursor, text } = readChatInputTextSnapshot(editor)
  if (direction === 'backward' && text.slice(0, cursor).includes('\n')) return undefined
  if (direction === 'forward' && text.slice(cursor).includes('\n')) return undefined

  const parsed = v.safeParse(sessionIdSchema, target.draftKey)
  if (!parsed.success) return undefined
  const session = selectChatSessionById(
    selectChatProjectionSlice(useChatProjectionStore.getState(), target.environmentId),
    parsed.output,
  )
  if (!session || session.pendingApprovalCount || session.pendingUserInputCount) return undefined

  return stepPromptHistory({
    direction,
    current: text,
    entries: promptHistoryEntries(session.messages),
    position,
  })
}
