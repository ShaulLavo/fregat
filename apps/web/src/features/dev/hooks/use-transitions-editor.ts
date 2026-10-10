import { useCallback, useEffect, useState } from 'react'
import { Editor } from '@singapore-editor/core/editor'
import { createMorphPlugin } from '@singapore-editor/decode'
import { createHighlightingPlugin } from '@singapore-editor/highlighting'
import { highlightingService } from '@/lib/highlighting/state/service'
import { TRANSITION_STEPS } from '@/features/dev/utils/transition-samples'
import '@singapore-editor/core/style.css'

export type TransitionsMotion = {
  readonly durationMs: number
  readonly bounce: number
}

/** A highlighted editor on the first sample step, with the morph plugin under the given motion. */
export function useTransitionsEditor(motion: TransitionsMotion) {
  const [editor, setEditor] = useState<Editor | null>(null)

  // Ref callback: React calls it once per mounted container, and its cleanup disposes the editor.
  const containerRef = useCallback((container: HTMLDivElement | null) => {
    if (!container) return
    const created = new Editor(container, {
      plugins: [createHighlightingPlugin({ service: highlightingService() })],
    })
    created.openDocument({
      documentId: 'transitions.ts',
      languageId: 'typescript',
      text: TRANSITION_STEPS[0] ?? '',
    })
    setEditor(created)
    return () => {
      setEditor(null)
      created.dispose()
    }
  }, [])

  useEffect(() => {
    if (!editor) return
    const registration = editor.addPlugin(
      createMorphPlugin({ durationMs: motion.durationMs, bounce: motion.bounce }),
    )
    return () => registration.dispose()
  }, [editor, motion.durationMs, motion.bounce])

  return { editor, containerRef }
}
