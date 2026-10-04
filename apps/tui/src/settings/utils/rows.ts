import { settingRowIds } from '@workspace/contracts/settings/presentation'
import { presentSetting } from '@workspace/contracts/settings/documentation'
import { settingRowTitle } from '@workspace/client-core/settings/humanize'
import {
  type SettingId,
  type SettingsSnapshot,
  type SettingsDiagnostic,
  type SettingsLayerSnapshot,
} from '@workspace/contracts'

export type SettingsDisplaySnapshot = Pick<SettingsSnapshot, 'values'> & {
  readonly layers: readonly SettingsLayerSnapshot[]
  readonly diagnostics: readonly SettingsDiagnostic[]
}

export function settingOptions(ids: readonly SettingId[]) {
  return ids.map((id) => ({ name: settingRowTitle(id), description: id }))
}

export function settingDetails(id: SettingId, snapshot: Pick<SettingsSnapshot, 'values'>) {
  return settingRowIds(id).map((key) => ({
    id: key,
    description: presentSetting(key).description,
    scope: presentSetting(key).scope,
    value: JSON.stringify(snapshot.values[key], null, 2),
  }))
}
