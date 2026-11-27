import type { Editor } from '@singapore-editor/core/editor'
import { serializeComposerMention } from '@workspace/contracts'

import {
  chatInputLineBoundaryOffset,
  chatInputRangeReplacement,
  type ChatInputLineEdge,
  type ChatInputRangeReplacement,
} from '@/features/chat/utils/input-logic'

export type ChatInputEditorHandle = {
  readonly editor: Editor
  readonly focus: () => void
  readonly getInputElement: () => HTMLElement
  readonly getRootElement: () => HTMLElement | null
  readonly isComposing: () => boolean
  readonly isEditable: () => boolean
  readonly getText: () => string
  readonly getSelectionOffsets: () => { readonly anchor: number; readonly focus: number }
  readonly getSnapshot: () => { readonly cursor: number; readonly text: string }
  readonly setEditable: (editable: boolean) => void
  readonly setSelection: (anchor: number, head?: number) => void
  readonly setText: (
    text: string,
    options?: { readonly focus?: boolean; readonly syncOnly?: boolean },
  ) => void
  readonly editRange: (
    from: number,
    to: number,
    text: string,
    selection?: { readonly anchor: number; readonly head?: number },
  ) => void
}

export function createChatInputEditorHandle(
  editor: Editor,
  options: {
    readonly getRootElement?: () => HTMLElement | null
    readonly isComposing?: () => boolean
  } = {},
): ChatInputEditorHandle {
  const getText = () => editor.materializeFullText()

  const getSelectionOffsets = () => {
    const primary = editor.getSelections()[0]
    if (!primary) {
      const end = getText().length
      return { anchor: end, focus: end }
    }
    return { anchor: primary.anchorOffset, focus: primary.headOffset }
  }

  const getSnapshot = () => {
    const text = getText()
    const primary = editor.getSelections()[0]
    if (!primary || primary.anchorOffset !== primary.headOffset) {
      return { cursor: text.length, text }
    }
    return { cursor: primary.anchorOffset, text }
  }

  const setText: ChatInputEditorHandle['setText'] = (text, setOptions = {}) => {
    if (setOptions.syncOnly) {
      editor.syncText(text)
      if (setOptions.focus) editor.focus()
      return
    }
    const currentLength = getText().length
    editor.edit({ from: 0, to: currentLength, text }, { selection: { anchor: text.length } })
    if (setOptions.focus) editor.focus()
  }

  return {
    editor,
    focus: () => editor.focus(),
    getInputElement: () => editor.getInputElement(),
    getRootElement: () => options.getRootElement?.() ?? editor.getInputElement().parentElement,
    isComposing: () => options.isComposing?.() ?? false,
    isEditable: () => editor.getState().editability === 'editable',
    getText,
    getSelectionOffsets,
    getSnapshot,
    setEditable: (editable) => editor.setEditability(editable ? 'editable' : 'readonly'),
    setSelection: (anchor, head) => editor.setSelection(anchor, head),
    setText,
    editRange: (from, to, text, selection) => {
      editor.edit({ from, to, text }, selection ? { selection } : undefined)
    },
  }
}

export function setChatInputText(
  editor: ChatInputEditorHandle,
  text: string,
  options?: { readonly syncOnly?: boolean },
) {
  editor.setText(text, options)
}

/** Inserts prompt text at the current selection; mentions render automatically as chips. */
export function insertChatInputText(
  editor: ChatInputEditorHandle,
  text: string,
  { focus = false }: { focus?: boolean } = {},
) {
  if (text.length === 0) return false
  const { anchor, focus: head } = editor.getSelectionOffsets()
  const start = Math.min(anchor, head)
  const end = Math.max(anchor, head)
  editor.editRange(start, end, text, { anchor: start + text.length })
  if (focus) editor.focus()
  return true
}

/** Replaces the whole prompt, caret at the end, and focuses the composer. */
export function setChatInputEditorText(editor: ChatInputEditorHandle, text: string) {
  editor.setText(text, { focus: true })
}

/** Inserts one mention, plus the blank that separates it from what follows. */
export function insertChatInputMention(
  editor: ChatInputEditorHandle,
  path: string,
  options?: { focus?: boolean },
) {
  return insertChatInputText(editor, `${serializeComposerMention(path)} `, options)
}

export function clearChatInputEditor(editor: ChatInputEditorHandle) {
  editor.setText('', { syncOnly: true })
}

export function readChatInputText(editor: ChatInputEditorHandle) {
  return editor.getText()
}

export function readChatInputTextSnapshot(editor: ChatInputEditorHandle) {
  return editor.getSnapshot()
}

/**
 * Splices a menu commit into the prompt as a single undoable edit with the caret
 * landing right after the replacement. Returns `null` when the range is stale.
 */
export function replaceChatInputEditorRange(
  editor: ChatInputEditorHandle,
  {
    expectedText,
    rangeEnd,
    rangeStart,
    replacement,
    focus = false,
  }: {
    focus?: boolean
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
    text: editor.getText(),
  })
  if (!result) return null

  editor.editRange(result.rangeStart, result.rangeEnd, replacement, { anchor: result.cursor })
  if (focus) editor.focus()
  return result
}

/** Wraps the selection in `open`/`close` and keeps the wrapped text selected. */
export function surroundChatInputSelection(
  editor: ChatInputEditorHandle,
  open: string,
  close: string,
) {
  const { anchor, focus: head } = editor.getSelectionOffsets()
  if (anchor === head) return false

  const start = Math.min(anchor, head)
  const end = Math.max(anchor, head)
  const selected = editor.getText().slice(start, end)
  if (!selected) return false

  const innerStart = start + open.length
  editor.editRange(start, end, `${open}${selected}${close}`, {
    anchor: innerStart,
    head: innerStart + selected.length,
  })
  return true
}

/** Home/End. Returns false when the caret is already on the boundary. */
export function moveChatInputCaretToLineBoundary(
  editor: ChatInputEditorHandle,
  edge: ChatInputLineEdge,
  extend: boolean,
) {
  const text = editor.getText()
  const { anchor, focus: head } = editor.getSelectionOffsets()
  const nextFocus = chatInputLineBoundaryOffset(text, head, edge)
  const nextAnchor = extend ? anchor : nextFocus
  if (nextAnchor === anchor && nextFocus === head) return false

  editor.setSelection(nextAnchor, nextFocus)
  return true
}

export function readChatInputSelection(editor: ChatInputEditorHandle) {
  const text = editor.getText()
  const { anchor, focus: head } = editor.getSelectionOffsets()
  return {
    text,
    selection: {
      start: Math.min(anchor, head),
      end: Math.max(anchor, head),
    },
  }
}

export async function foldChatInputPaste(
  editor: ChatInputEditorHandle,
  text: string,
  name: string,
  admit: (files: readonly File[]) => Promise<boolean>,
) {
  const accepted = await admit([new File([text], name, { type: 'text/plain' })]).catch(() => false)
  if (!accepted) insertChatInputText(editor, text)
}
