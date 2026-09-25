import type { SettingsIntentPatch } from '@workspace/client-core/settings/intent-store'

const RECENT_LIMIT = 4

/** The font a settings write set for `key`, if it set one. */
export function writtenFont(variables: unknown, key: string): string | null {
  const request = (variables as { patch?: SettingsIntentPatch } | undefined)?.patch?.request
  const operation = request?.operations.findLast(
    (candidate) => candidate.kind === 'set' && candidate.key === key,
  )
  if (!operation || operation.kind !== 'set' || typeof operation.value !== 'string') return null

  return operation.value
}

/** Newest first, the saved value leading, each font once. */
export function recentFonts(saved: string, written: readonly (string | null)[]): string[] {
  const newestFirst = written.filter((value) => value !== null).toReversed()
  return [...new Set([saved, ...newestFirst])].slice(0, RECENT_LIMIT)
}
