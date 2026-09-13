import type { ReactEditorController } from '@singapor/react'
import { useEditorSelector } from '@singapor/react'

import type { EditorCursor } from '@/features/workbench/utils/breadcrumbs'

function cursorsEqual(current: EditorCursor | null, next: EditorCursor | null) {
  if (current === next) return true
  if (!current || !next) return false

  return current.row === next.row && current.column === next.column
}

export function useEditorCursor(controller: ReactEditorController): EditorCursor | null {
  return useEditorSelector(
    controller,
    (snapshot) => {
      const cursor = snapshot.state?.cursor
      if (!cursor) return null

      return { column: cursor.column, row: cursor.row }
    },
    cursorsEqual,
  )
}
