import { foldChatInputPaste } from '@/features/chat/utils/input-editor-actions'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { COMMAND_PRIORITY_HIGH, KEY_DOWN_COMMAND, PASTE_COMMAND } from 'lexical'
import { useEffect, useRef } from 'react'

import {
  isPasteAsTextShortcut,
  nextPastedTextFileName,
  pastedTextFolds,
} from '@/features/chat/utils/pasted-text'

/**
 * Folds a large text paste into a `pasted-text.txt` attachment. A Lexical command, not
 * `onPaste`: the editor's own paste listener runs first and would insert the text anyway.
 */
export function ChatInputPasteFoldPlugin({
  onFiles,
}: {
  readonly onFiles: (files: readonly File[]) => Promise<boolean>
}) {
  const [editor] = useLexicalComposerContext()
  // The paste event cannot see its keys, so the inline chord opens a short window for it.
  const pasteInlineUntil = useRef(0)
  const foldedNames = useRef(new Set<string>())

  useEffect(() => {
    const unregisterKeyDown = editor.registerCommand(
      KEY_DOWN_COMMAND,
      (event) => {
        if (isPasteAsTextShortcut(event)) pasteInlineUntil.current = Date.now() + 1_000
        return false
      },
      COMMAND_PRIORITY_HIGH,
    )
    const unregisterPaste = editor.registerCommand(
      PASTE_COMMAND,
      (event) => {
        const text =
          event instanceof ClipboardEvent ? (event.clipboardData?.getData('text/plain') ?? '') : ''
        const inline = Date.now() <= pasteInlineUntil.current
        pasteInlineUntil.current = 0
        if (!pastedTextFolds(text, inline)) return false

        event.preventDefault()
        const name = nextPastedTextFileName(foldedNames.current)
        foldedNames.current.add(name)
        void foldChatInputPaste(editor, text, name, onFiles)
        return true
      },
      COMMAND_PRIORITY_HIGH,
    )

    return () => {
      unregisterKeyDown()
      unregisterPaste()
    }
  }, [editor, onFiles])

  return null
}
