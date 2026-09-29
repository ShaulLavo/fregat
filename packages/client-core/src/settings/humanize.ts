import {
  descriptorFor,
  settingParentId,
  type SettingId,
  type SettingsDiagnostic,
  type SettingsValues,
} from '@workspace/contracts'

// Registry titles describe the choice, which can invert the stored value for hidden models.
export function settingRowTitle(id: SettingId): string {
  return descriptorFor(id).title ?? humanizeSettingId(id)
}

/** Why a `dependsOn` row does nothing right now, or null while its parent is on. */
export function settingDependencyNote(id: SettingId, values: SettingsValues): string | null {
  const parent = settingParentId(id)
  if (parent === undefined || values[parent] !== false) return null

  return `Applies while ${settingRowTitle(parent)} is on`
}

export function settingOptionTitle(id: SettingId, value: string): string {
  const titles: Readonly<Record<string, string>> | undefined = descriptorFor(id).optionTitles
  return titles?.[value] ?? value
}

// Keep qualifiers after the namespace: Wallpaper enabled distinguishes generic enabled leaves.
export function humanizeSettingId(id: string): string {
  const segments = id.split('.')
  const meaningful = segments.length > 1 ? segments.slice(1) : segments
  const spaced = meaningful
    .map((segment) => segment.replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase())
    .join(' ')

  return spaced.charAt(0).toUpperCase() + spaced.slice(1)
}

const DIAGNOSTIC_LABELS: Record<SettingsDiagnostic['kind'], string> = {
  'invalid-value': 'invalid value',
  'scope-not-allowed': 'not allowed in this scope',
  'unknown-key': 'unknown setting',
  migrated: 'moved to a new setting',
  'removed-key': 'no longer a setting',
  'set-by-theme': 'set by the theme',
}

export function settingsDiagnosticLabel(kind: SettingsDiagnostic['kind']) {
  return DIAGNOSTIC_LABELS[kind]
}
