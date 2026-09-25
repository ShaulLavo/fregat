import { settingsDiagnosticLabel } from '@workspace/client-core/settings/humanize'
import type {
  SettingId,
  SettingsDiagnostic,
  SettingsLayerSnapshot,
  SettingsWriteTarget,
} from '@workspace/contracts'
import type { SettingsDisplaySnapshot } from '@/settings/utils/rows'

export type SettingsIssue = {
  readonly key: string
  readonly title: string
  readonly detail: string
  readonly kind: 'syntax' | 'entry'
}

export function settingsIssues(
  snapshot: Pick<SettingsDisplaySnapshot, 'layers' | 'diagnostics'>,
): readonly SettingsIssue[] {
  const malformed = snapshot.layers.filter((layer) => layer.file?.parseErrors.length)
  return [
    ...malformed.map((layer): SettingsIssue => ({
      key: layer.id,
      kind: 'syntax',
      title: `${layer.id} settings.json: syntax error`,
      detail: 'Using the last valid settings or defaults until this file is repaired.',
    })),
    ...snapshot.diagnostics
      .filter((diagnostic) => !malformed.some((layer) => layer.id === diagnostic.layer))
      .map((diagnostic): SettingsIssue => ({
        key: `${diagnostic.layer}:${diagnostic.id}`,
        kind: 'entry',
        title: `${diagnostic.id} · ${diagnostic.layer}: ${settingsDiagnosticLabel(diagnostic.kind)} (not applied)`,
        detail:
          diagnostic.detail ?? 'The effective value comes from another valid layer or the default.',
      })),
  ]
}

export function settingLayerLabel(
  id: SettingId,
  layer: SettingsLayerSnapshot,
  diagnostics: readonly SettingsDiagnostic[],
) {
  if (layer.file?.parseErrors.length) return `Last valid value from ${layer.id}`
  if (diagnostics.some((diagnostic) => diagnostic.id === id && diagnostic.layer === layer.id))
    return `Ignored in ${layer.id}`
  return `Set in ${layer.id}`
}

export function settingsRepairHint({
  target,
  writable,
  editorAvailable,
  paletteShortcut,
  scopeShortcut,
}: {
  readonly target: SettingsWriteTarget
  readonly writable: boolean
  readonly editorAvailable: boolean
  readonly paletteShortcut: string
  readonly scopeShortcut: string
}) {
  if (!writable) return 'Reconnect to repair settings.'
  if (!editorAvailable) return 'Repair settings.json on disk.'
  return `${paletteShortcut} → Edit settings JSON · ${scopeShortcut} scope (${target})`
}
