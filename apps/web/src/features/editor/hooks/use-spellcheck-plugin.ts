import { useMemo } from 'react'
import type { EditorPlugin } from '@singapore-editor/core/extensions'
import { createSpellcheckPlugin } from '@singapore-editor/spellcheck'

import { useEditorRuntime } from '@/features/editor/hooks/use-runtime'
import { useSettingValue } from '@/hooks/use-setting-value'

/** Null while `editor.spellcheck` is off; every editor shares the runtime's one dictionary worker. */
export function useSpellcheckPlugin(): EditorPlugin | null {
  const scope = useSettingValue('editor.spellcheck')
  const { spellcheck } = useEditorRuntime()
  // Manual memo: plugin identity is its registration lifetime in useEditor.
  return useMemo(
    () => (scope === 'off' ? null : createSpellcheckPlugin({ service: spellcheck, scope })),
    [scope, spellcheck],
  )
}
