import type { ProjectionSession } from '@workspace/client-core/chat/types'
import { effectiveSnoozed } from '@workspace/client-core/chat/rail/snooze'
import type { SessionLifecycleOverride } from '@workspace/client-core/chat/rail/model'
import type { SessionDropEntry, SessionDropPatch } from '@/features/chat-mode/utils/rail-drop'

export function dropEntryAcknowledged(
  entry: SessionDropEntry,
  session: ProjectionSession | undefined,
) {
  if (!session || session.archivedAt || session.worktreeId !== entry.worktreeId) return false
  return Object.entries(entry.preview).every(([field, value]) =>
    matchesField(field, session[field as keyof SessionLifecycleOverride], value),
  )
}
export function dropEntryConflicts(
  patch: SessionDropPatch,
  entry: SessionDropEntry,
  session: ProjectionSession | undefined,
) {
  if (!session || session.archivedAt || session.worktreeId !== entry.worktreeId) return true
  if (
    Object.entries(entry.preview).some(([field, value]) => {
      const actual = session[field as keyof SessionLifecycleOverride]
      return (
        !matchesField(field, actual, value) &&
        !matchesField(field, actual, entry.original[field as keyof SessionLifecycleOverride])
      )
    })
  )
    return true
  const shelf = canonicalShelf(session)
  const allowed = [entry.source, entry.key === patch.movedKey ? patch.destination : entry.source]
  if (
    entry.key === patch.movedKey &&
    patch.commands.some(
      ({ command }) =>
        command.type === 'session.unpin' ||
        command.type === 'session.unsnooze' ||
        command.type === 'session.unsettle',
    )
  )
    allowed.push('active')
  return !allowed.includes(shelf)
}
export function canonicalShelf(session: ProjectionSession) {
  if (effectiveSnoozed(session, Date.now())) return 'snoozed'
  if (session.settledOverride === 'settled') return 'settled'
  return session.pinnedAt ? 'pinned' : 'active'
}
function matchesField(field: string, actual: unknown, expected: unknown) {
  if (field.endsWith('At') && expected != null) return actual != null
  return (actual ?? null) === (expected ?? null)
}
