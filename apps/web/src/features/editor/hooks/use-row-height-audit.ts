import { useEffect, useRef } from 'react'
import type { ReactEditorController } from '@singapore-editor/react'

import { auditRowHeight } from '@/features/editor/utils/row-height-audit'
import { log } from '@/lib/client-logging'

/**
 * Once per initial text paint, checks that the rows the virtualizer positioned and the rows CSS
 * sized agree. A disagreement is invisible to every other log event and a reload erases it, so
 * this is the one record of what the editor was told when rows stack or drift.
 */
export function useRowHeightAudit(filePath: string) {
  const frame = useRef<number | null>(null)
  useEffect(
    () => () => {
      if (frame.current !== null) cancelAnimationFrame(frame.current)
    },
    [],
  )

  return (controller: ReactEditorController) => {
    if (frame.current !== null) return

    // The paint callback fires mid-render; reading geometry there would force a layout.
    frame.current = requestAnimationFrame(() => {
      frame.current = null
      const input = controller.getEditor()?.getInputElement()
      if (!input) return

      const audit = auditRowHeight(input)
      if (!audit) return

      const action = audit.ok ? 'editor.layout.rows_audited' : 'editor.layout.row_height_mismatch'
      log[audit.ok ? 'debug' : 'warn']({ action, area: 'editor', filePath, ...audit })
    })
  }
}
