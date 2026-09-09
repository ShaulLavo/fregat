import type { ReactEditorController } from '@singapor/react'
import { useEffect, useRef } from 'react'

import type { EditorRenderDocument } from '@/features/editor/utils/render-document'
import { rowStartOffset } from '@/features/editor/utils/position'

type UseCommitMessageEditorFocusOptions = {
  controller: ReactEditorController
  document: Pick<EditorRenderDocument, 'buffer' | 'path'> | null
}

export function useCommitMessageEditorFocus({
  controller,
  document,
}: UseCommitMessageEditorFocusOptions) {
  const preparedPathRef = useRef<string | null>(null)

  useEffect(() => {
    const editor = controller.getEditor()
    if (!editor || !document) return
    if (!isGitCommitMessagePath(document.path)) {
      preparedPathRef.current = null
      return
    }
    if (preparedPathRef.current === document.path) return

    preparedPathRef.current = document.path
    const offset = rowStartOffset(document.buffer.getTextSnapshot(), 1)
    editor.setSelection(offset, offset, offset)
    editor.focus()
  }, [controller, document])
}

function isGitCommitMessagePath(path: string) {
  return path.endsWith('/.git/COMMIT_EDITMSG') || path === '.git/COMMIT_EDITMSG'
}
