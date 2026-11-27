import { useEffect, useRef } from 'react'

import { useChatInputEditor } from '@/features/chat/providers/composer-editor-context'
import { foldChatInputPaste } from '@/features/chat/utils/input-editor-actions'
import { nextPastedTextFileName, pastedTextFolds } from '@/features/chat/utils/pasted-text'
import { useKeymapNode } from '@/keymap/hooks/use-keymap-node'

/**
 * Folds a large text paste into a `pasted-text.txt` attachment. Registered in the capture
 * phase on the editor input so it intercepts large pastes before the editor inserts them.
 */
export function ChatInputPasteFoldPlugin({
  onFiles,
}: {
  readonly onFiles: (files: readonly File[]) => Promise<boolean>
}) {
  const editor = useChatInputEditor()
  // The paste event cannot see its keys, so the inline chord opens a short window for it.
  const pasteInlineUntil = useRef(0)
  const foldedNames = useRef(new Set<string>())

  useKeymapNode({
    area: 'chat',
    context: 'Composer',
    element: () => editor?.getInputElement() ?? null,
    commands: {
      'chat.pasteAsText': () => {
        if (!editor || !editor.isEditable() || editor.isComposing()) return false
        pasteInlineUntil.current = Date.now() + 1_000
        return true
      },
    },
  })

  useEffect(() => {
    if (!editor) return
    const inputElement = editor.getInputElement()
    const onPaste = (event: ClipboardEvent) => {
      const text = event.clipboardData?.getData('text/plain') ?? ''
      const inline = Date.now() <= pasteInlineUntil.current
      pasteInlineUntil.current = 0
      if (!pastedTextFolds(text, inline)) return

      event.preventDefault()
      event.stopImmediatePropagation()
      const name = nextPastedTextFileName(foldedNames.current)
      foldedNames.current.add(name)
      void foldChatInputPaste(editor, text, name, onFiles)
    }

    inputElement.addEventListener('paste', onPaste, true)
    return () => inputElement.removeEventListener('paste', onPaste, true)
  }, [editor, onFiles])

  return null
}
