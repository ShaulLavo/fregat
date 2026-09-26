import type { Editor } from '@singapore-editor/core/editor'
import { serializeComposerMention } from '@workspace/contracts'

import {
  chatInputRangeReplacement,
  type ChatInputRangeReplacement,
} from '@/features/chat/utils/input-logic'

/** The prompt, and the caret when there is one collapsed caret (the end otherwise). */
export function readChatInputTextSnapshot(editor: Editor) {
  const text = editor.materializeFullText()
  const selections = editor.getSelections()
  const only = selections.length === 1 ? selections[0] : undefined
  if (!only || only.startOffset !== only.endOffset) return { cursor: text.length, text }

  return { cursor: only.headOffset, text }
}

export function readChatInputText(editor: Editor) {
  return editor.materializeFullText()
}

/** Mirrors stored text into the editor without an undo entry; a no-op when they agree. */
export function syncChatInputText(editor: Editor, text: string) {
  if (editor.materializeFullText() === text) return

  editor.syncText(text)
}

/** Replaces the whole prompt as one undo step, caret at the end, and focuses the composer. */
export function setChatInputEditorText(editor: Editor, text: string) {
  const length = editor.materializeFullText().length
  editor.edit({ from: 0, to: length, text }, { selection: { anchor: text.length } })
  editor.focus()
}

/**
 * Inserts prompt text over the primary selection, as one undo step with the caret after it. A
 * composer that was never focused has no caret worth keeping, so the text lands at the end.
 */
export function insertChatInputText(
  editor: Editor,
  text: string,
  { focus = false }: { focus?: boolean } = {},
) {
  if (text.length === 0) return false

  const range = insertionRange(editor)
  editor.edit(
    { from: range.start, to: range.end, text },
    { selection: { anchor: range.start + text.length } },
  )
  if (focus) editor.focus()

  return true
}

/** Inserts one mention, plus the blank that separates it from what follows. */
export function insertChatInputMention(
  editor: Editor,
  path: string,
  options?: { focus?: boolean },
) {
  return insertChatInputText(editor, `${serializeComposerMention(path)} `, options)
}

/** Empties the prompt without an undo entry: a sent message is not an edit to take back. */
export function clearChatInputEditor(editor: Editor) {
  syncChatInputText(editor, '')
}

/**
 * Splices a menu commit into the prompt as one undo step, caret right after the inserted text.
 * Returns `null` when the range is stale — see `chatInputRangeReplacement`.
 */
export function replaceChatInputEditorRange(
  editor: Editor,
  {
    expectedText,
    rangeEnd,
    rangeStart,
    replacement,
  }: {
    expectedText?: string
    rangeEnd: number
    rangeStart: number
    replacement: string
  },
): ChatInputRangeReplacement | null {
  const result = chatInputRangeReplacement({
    expectedText,
    rangeEnd,
    rangeStart,
    replacement,
    text: editor.materializeFullText(),
  })
  if (!result) return null

  editor.edit(
    { from: result.rangeStart, to: result.rangeEnd, text: replacement },
    { selection: { anchor: result.cursor } },
  )

  return result
}

export async function foldChatInputPaste(
  editor: Editor,
  text: string,
  name: string,
  admit: (files: readonly File[]) => Promise<boolean>,
) {
  const accepted = await admit([new File([text], name, { type: 'text/plain' })]).catch(() => false)
  if (!accepted) insertChatInputText(editor, text)
}

function insertionRange(editor: Editor) {
  const primary = editor.getSelections()[0]
  if (primary && editor.getInputElement().contains(document.activeElement)) {
    return { end: primary.endOffset, start: primary.startOffset }
  }

  const length = editor.materializeFullText().length
  return { end: length, start: length }
}
