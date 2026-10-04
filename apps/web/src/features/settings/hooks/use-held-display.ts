import { registerDisplayedSelection } from '@/features/settings/state/selection'
import { useLayoutEffect, useMemo } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useHeldUntilReady } from '@/hooks/use-held-until-ready'
import { useSettingsDisplay } from '@/features/settings/hooks/use-settings-display'
import { useSettingsOwner } from '@/lib/settings-owner/hooks/use-settings-owner'
import { useSettingsScope } from '@/features/settings/state/scope-store'
import { useDefaultsFile } from '@/features/settings/hooks/use-defaults-file'
import { useSettingsView } from '@/features/settings/state/view-store'
import { documentKey, settingsJsonDocument } from '@/lib/documents/utils/identity'
import type { EditorRenderDocument } from '@/features/editor/utils/render-document'
import type { TabId } from '@/lib/documents/utils/types'

export function useHeldDisplay(
  tabId: TabId | undefined,
  liveDocument: EditorRenderDocument | null,
) {
  const editorOwner = useQueryClient()
  const settingsOwner = useSettingsOwner()
  const form = useSettingsDisplay(settingsOwner)
  const json = useSettingsDisplay(editorOwner)
  const scope = useSettingsScope()
  const view = useSettingsView()
  const showJson = (view === 'json' || scope === 'default') && tabId !== undefined
  const defaults = useDefaultsFile(showJson && scope === 'default')
  const display = showJson ? json : form
  const owner = showJson ? editorOwner : settingsOwner
  // useHeldUntilReady compares identity when it stores the ready subject during render.
  const next = useMemo(
    () => ({ scope, showJson, liveDocument, owner }),
    [scope, showJson, liveDocument, owner],
  )
  const ready =
    Boolean(display.document.data && display.projection) &&
    (!showJson || liveDocument?.key === documentKey(settingsJsonDocument(scope)))
  // Errors settle too: a failed subject must be reachable rather than held forever.
  const shown = useHeldUntilReady(next, ready || display.document.isError || defaults.isError)
  const shownScope = shown.scope
  const shownJson = shown.showJson
  useLayoutEffect(() => {
    if (!tabId) return
    return registerDisplayedSelection(
      editorOwner,
      tabId,
      shownJson ? { kind: 'json', target: shownScope } : { kind: 'form' },
    )
  }, [editorOwner, tabId, shownJson, shownScope])
  return {
    ...(shown.showJson ? json : form),
    ...shown,
    defaultsError: shown.scope === 'default' ? defaults.error : null,
    pending: shown !== next,
  }
}
