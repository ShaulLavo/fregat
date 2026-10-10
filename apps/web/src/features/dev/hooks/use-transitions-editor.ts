import { useCallback, useEffect, useState } from 'react'
import { Editor } from '@singapore-editor/core/editor'
import { createDecodePlugin, createMorphPlugin, type DecodeMode } from '@singapore-editor/decode'
import { createHighlightingPlugin } from '@singapore-editor/highlighting'
import { highlightingService } from '@/lib/highlighting/state/service'
import { TRANSITION_STEPS } from '@/features/dev/utils/transition-samples'
import '@singapore-editor/core/style.css'

export type TransitionsMotion = {
  readonly durationMs: number
  readonly bounce: number
  /** The file-open reveal, replayed by reopening the text as a new document when `replay` grows. */
  readonly reveal: DecodeMode
  readonly replay: number
  readonly speed: number
}

/** A highlighted editor on the first sample step, with the morph and reveal plugins under `motion`. */
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

  useEffect(() => {
    if (!editor) return
    const registration = editor.addPlugin(
      createDecodePlugin({ mode: motion.reveal, speed: motion.speed }),
    )
    return () => registration.dispose()
  }, [editor, motion.reveal, motion.speed])

  // Declared after the reveal plugin's effect, so a new mode is registered before the reopen.
  useEffect(() => {
    if (!editor || motion.replay === 0) return
    editor.openDocument({
      documentId: `transitions-${motion.replay}.ts`,
      languageId: 'typescript',
      text: editor.materializeFullText(),
    })
  }, [editor, motion.replay])

  return { editor, containerRef }
}
