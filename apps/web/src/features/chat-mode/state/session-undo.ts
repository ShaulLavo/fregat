import { toast } from 'sonner'
import { create } from 'zustand'
import type { ProjectId, ScopedSessionRef } from '@workspace/contracts'
import {
  createSessionLifecycleHistory,
  sessionLifecycleUndoEntry,
  sessionLifecycleRestoreCommand,
  sessionLifecycleVerb,
  type SessionLifecycleUndoEntry,
  type SessionLifecycleUndoKind,
} from '@workspace/client-core/chat/rail/lifecycle-undo'
import type { HistoryDirection } from '@workspace/client-core/history/undo-stack'
import { dispatchChatCommand } from '@/features/chat/utils/command-dispatch'
import { dispatchCommandForEnvironment } from '@/features/chat/state/active-transports'
import { notifyChatCommandError } from '@/features/chat/notify-command-error'
import { updateSessionRead } from '@/features/chat-mode/state/session-read-actions'
import { CHAT_SESSION_SCOPE, chatModeMutationKeys } from '@/features/chat-mode/utils/mutation-keys'
import { runMutation } from '@/lib/mutations/run'
import { primaryQueryClient } from '@/lib/environments/state/query-clients'
import { toastError } from '@/lib/toast-error'
import { errorMessage } from '@/lib/error-message'
import { getNavigation } from '@/state/navigation-binding'
import { sessionArchive } from '@/features/chat-mode/state/removal'
import { batchDetail } from '@/features/chat-mode/utils/session-undo'

export type SessionUndoEntry = SessionLifecycleUndoEntry & {
  readonly reopen: { readonly surface: 'main' | 'sidebar'; readonly projectId: ProjectId } | null
}
const history = createSessionLifecycleHistory<SessionUndoEntry>()
const NOTICE_DURATION_MS = 5_000
// A step closes its notice at once but runs behind queued lifecycle mutations; the close must not expire it.
const claimed = new Set<number>()
const undoShortcuts = new Map<number, string | null>()
export const useSessionUndoStore = create(() => history.getSnapshot())
history.subscribe(() => useSessionUndoStore.setState(history.getSnapshot()))

export function sessionUndoAvailable() {
  return history.getSnapshot().undo.length > 0
}
export function sessionRedoAvailable() {
  return history.getSnapshot().redo.length > 0
}

/** Records the action and gives it its own notice; the action stays undoable while the notice shows. */
export function offerSessionUndo({
  kind,
  entries,
  detail,
  shortcut,
}: {
  readonly kind: SessionLifecycleUndoKind
  readonly entries: readonly SessionUndoEntry[]
  readonly detail: string
  readonly shortcut: string | null
}) {
  const id = history.record(kind, entries)
  if (id === null) return
  undoShortcuts.set(id, shortcut)
  showNotice(id, 'undo', `${entries.length} ${sessionLifecycleVerb(kind)}${detail}`)
}
export function forgetSessionUndo(refs: readonly ScopedSessionRef[]) {
  const before = batchIds()
  history.forget(refs)
  const after = new Set(batchIds())
  for (const id of before) if (!after.has(id)) closeNotice(id)
}
export function resetSessionUndo() {
  const ids = batchIds()
  history.clear()
  claimed.clear()
  for (const id of ids) closeNotice(id)
}
export function undoLatestSessionAction() {
  return stepSessionHistory('undo')
}
export function redoLatestSessionAction() {
  return stepSessionHistory('redo')
}

function batchIds() {
  const { undo, redo } = history.getSnapshot()
  return [...undo, ...redo].map((batch) => batch.id)
}
function noticeId(id: number) {
  return `session-lifecycle-undo-${id}`
}
function showNotice(id: number, direction: HistoryDirection, title: string) {
  const shortcut = direction === 'undo' ? undoShortcuts.get(id) : null
  toast(title, {
    id: noticeId(id),
    duration: NOTICE_DURATION_MS,
    ...(shortcut ? { description: `${shortcut} to undo` } : {}),
    action: {
      label: direction === 'undo' ? 'Undo' : 'Redo',
      onClick: () => void stepSessionHistory(direction, id),
    },
    onAutoClose: () => expireBatch(id),
    onDismiss: () => expireBatch(id),
  })
}
function closeNotice(id: number) {
  undoShortcuts.delete(id)
  toast.dismiss(noticeId(id))
}
function expireBatch(id: number) {
  if (claimed.has(id)) return
  undoShortcuts.delete(id)
  history.expire(id)
}

async function stepSessionHistory(direction: HistoryDirection, id?: number) {
  const batch = history
    .getSnapshot()
    [direction].findLast((candidate) => id === undefined || candidate.id === id)
  if (!batch) return false
  claimed.add(batch.id)
  toast.dismiss(noticeId(batch.id))
  return runMutation(
    primaryQueryClient(),
    {
      mutationKey: chatModeMutationKeys.lifecycleUndo(),
      scope: { id: CHAT_SESSION_SCOPE },
      mutationFn: () => stepBatch(direction, batch.id),
    },
    undefined,
  )
}

async function stepBatch(direction: HistoryDirection, id: number) {
  const result = await history.step(direction, restoreSession, id).finally(() => claimed.delete(id))
  const shortcut = undoShortcuts.get(id) ?? null
  undoShortcuts.delete(id)
  if (result.inverse) {
    const { inverse } = result
    const detail = batchDetail({ failed: result.failed })
    undoShortcuts.set(inverse.id, shortcut)
    const summary = `${inverse.entries.length} ${sessionLifecycleVerb(inverse.kind)}${detail}`
    showNotice(
      inverse.id,
      direction === 'undo' ? 'redo' : 'undo',
      direction === 'undo' ? `Undid ${summary}` : summary,
    )
  }
  return result.applied.length > 0 && result.failed === 0
}

async function restoreSession(entry: SessionUndoEntry): Promise<SessionUndoEntry | null> {
  const removal = entry.before.archivedAt ? sessionArchive(entry.ref) : null
  const outcome = await dispatchChatCommand({
    action: 'chat.session.lifecycle.restore',
    command: sessionLifecycleRestoreCommand(entry),
    dispatchCommand: (command) => dispatchCommandForEnvironment(entry.ref.environmentId, command),
  })
  if (!outcome.ok) {
    notifyChatCommandError(outcome.error, 'Session restore failed')
    return null
  }
  const inverse = sessionLifecycleUndoEntry(entry.ref, outcome.result)
  if (!inverse) return null
  if (!entry.before.snoozedUntil) updateSessionRead(entry.ref, 'wake')
  await restoreNavigation(entry, removal)
  return { ...inverse, reopen: entry.reopen }
}

async function restoreNavigation(
  entry: SessionUndoEntry,
  removal: ReturnType<typeof sessionArchive>,
) {
  try {
    if (removal) {
      await getNavigation().reconcileSessions(removal)
      return
    }
    if (!entry.reopen || entry.before.archivedAt) return
    const result = await getNavigation().openChat({ ...entry.ref, ...entry.reopen })
    if (result.status !== 'unavailable') return
    toastError('Session restored, but navigation failed', { description: result.reason })
  } catch (error) {
    toastError('Session restored, but navigation failed', {
      description: errorMessage(error, 'The session could not be opened.'),
    })
  }
}
