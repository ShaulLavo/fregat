import type { EditorPlugin } from '@singapore-editor/core'
import type {
  SettingsDiagnostic,
  SettingsLayerFile,
  SettingsViewTarget,
} from '@workspace/contracts'
import { useLayoutEffect, useState } from 'react'

import { createSettingsDiagnosticsPlugin } from '@/features/settings/state/diagnostics-plugin'
import { createSettingsDiagnosticsSource } from '@/features/settings/state/diagnostics-source'

export function useSettingsDiagnosticsPlugin({
  diagnostics,
  file,
  target,
}: {
  readonly diagnostics: readonly SettingsDiagnostic[]
  readonly file: SettingsLayerFile | null
  readonly target: SettingsViewTarget
}): readonly EditorPlugin[] {
  // The editor owns plugin identity; the source is the settings-owned mutable edge.
  const [source] = useState(() => createSettingsDiagnosticsSource({ diagnostics, file, target }))
  const [plugins] = useState<readonly EditorPlugin[]>(() => [
    createSettingsDiagnosticsPlugin(source),
  ])

  useLayoutEffect(() => {
    source.setSnapshot({ diagnostics, file, target })
  }, [diagnostics, file, source, target])

  return plugins
}
