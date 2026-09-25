import type { LexicalEditor } from 'lexical'
import { useEffect, useEffectEvent, type RefObject } from 'react'

import { appendOnce } from '@/features/chat/utils/append-once'
import {
  insertChatInputText,
  readChatInputText,
  setChatInputEditorText,
} from '@/features/chat/utils/input-editor-actions'
import { useChatInputDraftStore, type ChatInputDraftTarget } from '../state/chat-input-draft-store'
import { useComposerInboxStore, type ComposerInboxEntry } from '../state/composer-inbox-store'

/**
 * Moves work waiting in the inbox onto this composer — chips onto the draft,
 * text into the editor at the caret.
 *
 * The draft is the durable home: it survives a session switch and a reload, so
 * the inbox only holds anything for the gap between "the user asked" and "a
 * composer exists". Draining is keyed on `pending` alone — a session switch
 * changes `draftTarget` but must not re-deliver work the previous session owns.
 */
export function useComposerInbox(
  draftTarget: ChatInputDraftTarget,
  editorRef: RefObject<LexicalEditor | null>,
  /** The editor mounts a render after this component, and text needs a caret. */
  editorReady: boolean,
) {
  const pending = useComposerInboxStore((store) => store.pending)

  // `draftTarget` and the editor ref are read, not depended on: re-running on a session switch
  // would take from an already-empty inbox at best, and re-home someone else's capture at worst.
  const drain = useEffectEvent((ready: boolean) => {
    // Chips need only the draft; text needs somewhere to splice. Taking just
    // what can be honoured leaves the rest queued for the render that can.
    const entries = useComposerInboxStore
      .getState()
      .take((entry) => entry.kind === 'terminal-context' || ready)
    if (entries.length === 0) return

    applyComposerInboxEntries(entries, draftTarget, editorRef.current)
  })

  useEffect(() => {
    if (pending.length === 0) return

    drain(editorReady)
  }, [editorReady, pending])
}

function applyComposerInboxEntries(
  entries: readonly ComposerInboxEntry[],
  draftTarget: ChatInputDraftTarget,
  editor: LexicalEditor | null,
) {
  const drafts = useChatInputDraftStore.getState()
  const contexts = entries.flatMap((entry) =>
    entry.kind === 'terminal-context' ? [entry.context] : [],
  )
  if (contexts.length > 0) drafts.addTerminalContexts(draftTarget, contexts)

  if (!editor) return
  insertTextEntries(entries, editor)
  appendTextEntries(entries, editor)
  // The editor is the source of truth for what was spliced, so the draft is
  // written from it rather than from what we asked for.
  if (entries.some((entry) => entry.kind !== 'terminal-context')) {
    drafts.setPrompt(draftTarget, readChatInputText(editor))
  }
}

function insertTextEntries(entries: readonly ComposerInboxEntry[], editor: LexicalEditor) {
  const text = entries.flatMap((entry) => (entry.kind === 'text' ? [entry.text] : [])).join('\n\n')
  if (text) insertChatInputText(editor, `${text} `, { focus: true })
}

function appendTextEntries(entries: readonly ComposerInboxEntry[], editor: LexicalEditor) {
  const appends = entries.flatMap((entry) => (entry.kind === 'append' ? [entry.text] : []))
  if (appends.length === 0) return

  const next = appends.reduce(appendOnce, readChatInputText(editor))
  setChatInputEditorText(editor, next)
}
