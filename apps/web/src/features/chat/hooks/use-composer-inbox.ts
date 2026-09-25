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
import { composerAccepts, type ComposerTarget } from '@/lib/composer-attach/utils/target'

/**
 * Moves work waiting in the inbox onto this composer — chips onto the draft,
 * text into the editor at the caret.
 *
 * The draft is the durable home: it survives a session switch and a reload, so
 * the inbox only holds anything for the gap between "the user asked" and "a
 * composer exists". It takes only entries captured in this composer's workspace,
 * and looks again when that workspace changes.
 */
export function useComposerInbox(
  draftTarget: ChatInputDraftTarget,
  editorRef: RefObject<LexicalEditor | null>,
  /** The editor mounts a render after this component, and text needs a caret. */
  editorReady: boolean,
  /** Other roots that name this composer, such as the workspace a linked worktree came from. */
  aliasRoots: readonly string[] = [],
) {
  const pending = useComposerInboxStore((store) => store.pending)

  const { environmentId, rootPath } = draftTarget
  // A joined key: callers build the alias list inline, and the effect re-runs only on content.
  const aliasKey = aliasRoots.join('\0')
  // The draft key and editor ref are read, not depended on: a session switch inside one
  // workspace has nothing new to take.
  const drain = useEffectEvent((ready: boolean, target: ComposerTarget) => {
    // Chips need only the draft; text needs somewhere to splice. Taking just
    // what can be honoured leaves the rest queued for the render that can.
    const entries = useComposerInboxStore
      .getState()
      .take(
        (entry) =>
          composerAccepts(target, entry.destination) &&
          (entry.kind === 'terminal-context' || ready),
      )
    if (entries.length === 0) return

    applyComposerInboxEntries(entries, draftTarget, editorRef.current)
  })

  useEffect(() => {
    if (pending.length === 0) return

    const rootPaths = [rootPath, ...(aliasKey ? aliasKey.split('\0') : [])]
    drain(editorReady, { environmentId, rootPaths })
  }, [aliasKey, editorReady, environmentId, pending, rootPath])
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
