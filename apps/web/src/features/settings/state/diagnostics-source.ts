import type {
  SettingsDiagnostic,
  SettingsLayerFile,
  SettingsViewTarget,
} from '@workspace/contracts'

export type SettingsDiagnosticsSnapshot = {
  readonly diagnostics: readonly SettingsDiagnostic[]
  readonly file: SettingsLayerFile | null
  readonly target: SettingsViewTarget
}

export type SettingsDiagnosticsSource = {
  getSnapshot(): SettingsDiagnosticsSnapshot
  setSnapshot(snapshot: SettingsDiagnosticsSnapshot): void
  subscribe(listener: () => void): () => void
}

export function createSettingsDiagnosticsSource(
  initial: SettingsDiagnosticsSnapshot,
): SettingsDiagnosticsSource {
  let snapshot = initial
  const listeners = new Set<() => void>()

  return {
    getSnapshot: () => snapshot,
    setSnapshot: (next) => {
      if (
        snapshot.diagnostics === next.diagnostics &&
        snapshot.file === next.file &&
        snapshot.target === next.target
      ) {
        return
      }

      snapshot = next
      for (const listener of listeners) listener()
    },
    subscribe: (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
}
