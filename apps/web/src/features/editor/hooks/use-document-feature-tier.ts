import type { EditorTextBuffer } from '@singapore-editor/core/document'
import { useCallback, useSyncExternalStore } from 'react'
import { useSettingValue } from '@/hooks/use-setting-value'
import { documentFeatureTier } from '@/features/editor/utils/large-file-policy'

export function useDocumentFeatureTier(buffer: EditorTextBuffer | null) {
  const analysisLimit = useSettingValue('editor.largeFile.analysisLimitMiCodeUnits')
  const minimapLimit = useSettingValue('editor.largeFile.minimapLimitMiCodeUnits')
  // The external-store callbacks retain identity between buffer publications.
  const subscribe = useCallback(
    (notify: () => void) => buffer?.subscribe(notify) ?? (() => {}),
    [buffer],
  )
  const getSnapshot = useCallback(
    () => documentFeatureTier(buffer?.getSnapshot().length ?? 0, analysisLimit, minimapLimit),
    [buffer, analysisLimit, minimapLimit],
  )
  const tier = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
  return {
    analysisLimitMiCodeUnits: analysisLimit,
    analysisAllowed: (tier & 1) !== 0,
    minimapAllowed: (tier & 2) !== 0,
  }
}
