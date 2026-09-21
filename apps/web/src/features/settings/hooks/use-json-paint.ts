import { useSettingsReloadOwner } from '@/features/settings/hooks/use-reload-owner'
import { useLayoutEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useEditorColorTheme } from '@/lib/editor-theme/hooks/use-editor-color-theme'
import { documentKey, settingsJsonDocument } from '@/lib/documents/utils/identity'
import { addLifecycleFlush } from '@/lib/lifecycle-flush'
import type { SettingsLayerFile } from '@workspace/contracts'
import type { SettingsScope } from '@/features/settings/state/scope-store'
import {
  captureSettingsPaint,
  settingsPaint,
  createPaintCapture,
} from '@/features/settings/state/reload'

export function useJsonPaint(
  scope: SettingsScope,
  file: SettingsLayerFile | null,
  active: boolean,
) {
  const owner = useQueryClient()
  const { appliedThemeId, committedThemeId, selectedThemeId } = useEditorColorTheme()
  const paintKey = documentKey(settingsJsonDocument(scope))
  const [capture] = useState(createPaintCapture)
  const generation = useSettingsReloadOwner(owner)?.generation
  useLayoutEffect(() => {
    const flush = () => {
      if (
        !active ||
        !file ||
        appliedThemeId !== committedThemeId ||
        selectedThemeId !== committedThemeId
      )
        return
      const snapshot = capture.read()
      if (!snapshot?.buffer || snapshot.documentKey !== paintKey || snapshot.buffer.isDirty())
        return
      captureSettingsPaint(
        owner,
        {
          scope,
          revision: file.revision,
          theme: committedThemeId,
          paint: snapshot.paint,
        },
        generation,
      )
    }
    const remove = addLifecycleFlush(flush)
    return () => {
      flush()
      remove()
    }
  }, [
    owner,
    generation,
    scope,
    file,
    active,
    paintKey,
    capture,
    appliedThemeId,
    committedThemeId,
    selectedThemeId,
  ])
  return {
    paintKey,
    snapshot:
      appliedThemeId === committedThemeId && selectedThemeId === committedThemeId
        ? settingsPaint(owner, scope, committedThemeId, file?.revision)
        : null,
    onCaptureSourceChange: capture.setSource,
  }
}
