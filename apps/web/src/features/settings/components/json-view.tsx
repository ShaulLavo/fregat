import { useJsonPaint } from '@/features/settings/hooks/use-json-paint'
import { Editor } from '@/features/editor/components/editor'
import type { EditorRenderDocument } from '@/features/editor/utils/render-document'
import type { SettingsDiagnostic, SettingsLayerFile } from '@workspace/contracts'

import { DefaultsBanner } from '@/features/settings/components/defaults-banner'
import { JsonLoading } from '@/features/settings/components/json-loading'
import { RawConflictBanner } from '@/features/settings/components/raw-conflict-banner'
import { useSettingsDiagnosticsPlugin } from '@/features/settings/hooks/use-settings-diagnostics-plugin'
import type { SettingsScope } from '@/features/settings/state/scope-store'
import { documentKey, settingsJsonDocument } from '@/lib/documents/utils/identity'
import type { TabId, WorkspaceRoot } from '@/lib/documents/utils/types'
import { SETTINGS_LANGUAGE_SERVER_TARGET } from '@/features/settings/utils/language-server'

/**
 * The settings document as text, in the same editor everything else opens in.
 *
 * The document is handed down rather than selected here: the tab body already
 * joins the buffer, the view session and the path into one render document, and
 * a second derivation would have to build a fresh object inside a store selector.
 */
export function SettingsJsonView({
  active,
  diagnostics,

  file,
  liveDocument,
  rootPath,
  scope,
  tabId,
}: {
  active: boolean
  diagnostics: readonly SettingsDiagnostic[]

  file: SettingsLayerFile | null
  liveDocument: EditorRenderDocument | null
  rootPath: WorkspaceRoot
  scope: SettingsScope
  tabId: TabId
}) {
  const diagnosticsPlugins = useSettingsDiagnosticsPlugin({ diagnostics, file, target: scope })
  const paint = useJsonPaint(scope, file, active)
  const document =
    liveDocument?.key === documentKey(settingsJsonDocument(scope)) ? liveDocument : null
  // The buffer is seeded and bound in effects, so the first render after opening
  // the view — or after a scope switch — still has the previous document or none.
  if (!document && !paint.snapshot) {
    return <JsonLoading />
  }

  return (
    <div className='flex h-full min-h-0 flex-col'>
      {scope === 'default' ? (
        <DefaultsBanner />
      ) : (
        <RawConflictBanner documentKey={documentKey(settingsJsonDocument(scope))} />
      )}
      <div className='min-h-0 flex-1'>
        <Editor
          active={active}
          additionalPlugins={diagnosticsPlugins}
          document={document}
          target={settingsJsonDocument(scope)}
          paintKey={paint.paintKey}
          snapshot={paint.snapshot}
          onCaptureSourceChange={paint.onCaptureSourceChange}
          languageServerTarget={SETTINGS_LANGUAGE_SERVER_TARGET}
          rootPath={rootPath}
          tabId={tabId}
        />
      </div>
    </div>
  )
}
