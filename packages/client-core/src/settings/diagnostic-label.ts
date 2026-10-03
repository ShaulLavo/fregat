import type { SettingsDiagnostic } from '@workspace/contracts'

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
