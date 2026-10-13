import {
  descriptorFor,
  isSettingId,
  layerAllowsScope,
  type SettingsDiagnostic,
} from '@workspace/contracts'
import { presentSetting } from '@workspace/contracts/settings/documentation'
import { settingsDiagnosticLabel } from '@workspace/client-core/settings/diagnostic-label'
import { Button } from '@workspace/ui/components/button'

import { useSettingsActions } from '@/features/settings/hooks/use-settings-actions'
import { useSettingsProjection } from '@/features/settings/hooks/use-settings-projection'
import { selectSettingsScope } from '@/features/settings/state/scope-store'
import { selectSettingsSearch } from '@/features/settings/state/search-store'
import { selectSettingsView } from '@/features/settings/state/view-store'
import { isFontSettingId } from '@/features/settings/utils/font-options'

export function DiagnosticEntry({ diagnostic }: { diagnostic: SettingsDiagnostic }) {
  const { id, kind, layer } = diagnostic
  const { removeSettingOverride } = useSettingsActions()
  const snapshot = useSettingsProjection()
  const target = layer === 'user' || layer === 'workspace' ? layer : null
  const registered = isSettingId(id)
  const editable =
    registered &&
    target !== null &&
    layerAllowsScope(target, descriptorFor(id).scope) &&
    !presentSetting(id).readOnlyReason &&
    !snapshot?.layers.some((entry) => entry.id === 'policy' && Object.hasOwn(entry.raw, id))
  const invalid = kind === 'invalid-value'
  const invalidFont = invalid && isFontSettingId(id)

  const detail = diagnostic.detail ? `: ${diagnostic.detail}` : ''
  const explanation = invalidFont
    ? '. The saved font format is invalid. The app is using a fallback font. Choose a font or reset this entry to use the default.'
    : detail
  const editLabel = invalidFont ? 'Choose font' : 'Edit setting'

  return (
    <li className='flex flex-col gap-(--density-control-gap)' data-settings-diagnostic={id}>
      <p>
        <code>{id}</code> in {layer} settings: {settingsDiagnosticLabel(kind)}
        {explanation}
      </p>
      {target && kind !== 'migrated' && kind !== 'set-by-theme' ? (
        <div className='flex flex-wrap gap-(--density-control-gap)'>
          <Button
            onClick={() => {
              selectSettingsScope(target)
              selectSettingsSearch(editable ? id : '')
              selectSettingsView(editable ? 'form' : 'json')
            }}
            size='sm'
            variant='secondary'
          >
            {editable ? editLabel : 'Edit settings.json'}
          </Button>
          {editable && invalid && registered ? (
            <Button onClick={() => removeSettingOverride(id, target)} size='sm' variant='secondary'>
              Reset to default
            </Button>
          ) : null}
        </div>
      ) : null}
    </li>
  )
}
