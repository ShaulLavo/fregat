import { descriptorFor, type SettingId, type SettingsDiagnostic } from '@workspace/contracts'

// Registry titles describe the choice, which can invert the stored value for hidden models.
export function settingRowTitle(id: SettingId): string {
  return descriptorFor(id).title ?? humanizeSettingId(id)
}

export function settingOptionTitle(id: SettingId, value: string): string {
  if (id === 'keybindings.preset') return value === 'vscode' ? 'VS Code' : 'Platform'
  if (id === 'editor.markdownView') return markdownViewTitle(value)
  if (id !== 'workbench.colorTheme') return value

  return value.charAt(0).toUpperCase() + value.slice(1)
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
}

export function settingsDiagnosticLabel(kind: SettingsDiagnostic['kind']) {
  return DIAGNOSTIC_LABELS[kind]
}

function markdownViewTitle(value: string) {
  if (value === 'split') return 'Source and rendered'
  if (value === 'source') return 'Source'
  return 'Live preview'
}
