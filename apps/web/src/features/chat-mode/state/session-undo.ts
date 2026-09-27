import { toast } from 'sonner'
import { createElement } from 'react'
import type { ScopedSessionRef } from '@workspace/contracts'
import {
  canStepSessionLifecycleBatch,
  sessionLifecycleUndoEntry,
  sessionLifecycleRestoreCommand,
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
import {
  sessionUndoHistory as history,
  type SessionUndoEntry,
} from '@/features/chat-mode/state/session-undo-history'
import { SessionUndoNoticeAction } from '@/features/chat-mode/components/session-undo-notice-action'
import { SessionUndoNoticeTitle } from '@/features/chat-mode/components/session-undo-notice-title'

const NOTICE_DURATION_MS = 5_000
// A step closes its notice at once but runs behind queued lifecycle mutations; the close must not expire it.
const claimed = new Set<number>()
const undoShortcuts = new Map<number, string | null>()

history.subscribe(() => {
  const retained = new Set(batchIds())
  for (const id of undoShortcuts.keys()) {
    if (!retained.has(id) && !claimed.has(id)) closeNotice(id)
  }
})

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
  showNotice(id, 'undo', { kind, detail, count: entries.length })
}
export function forgetSessionUndo(refs: readonly ScopedSessionRef[]) {
  history.forget(refs)
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
function showNotice(
  id: number,
  direction: HistoryDirection,
  title: {
    readonly kind: SessionLifecycleUndoKind
    readonly detail: string
    readonly count: number
  },
) {
  const shortcut = direction === 'undo' ? undoShortcuts.get(id) : null
  // The title reads the batch, so a row forgotten later lowers its count in place.
  toast(
    createElement(SessionUndoNoticeTitle, { batchId: id, undone: direction === 'redo', ...title }),
    {
      id: noticeId(id),
      duration: NOTICE_DURATION_MS,
      ...(shortcut ? { description: `${shortcut} to undo` } : {}),
      action: createElement(SessionUndoNoticeAction, {
        batchId: id,
        direction,
        onClick: () => void stepSessionHistory(direction, id),
      }),
      onAutoClose: () => expireBatch(id),
      onDismiss: () => expireBatch(id),
    },
  )
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
  if (id !== undefined && !canStepSessionLifecycleBatch(history.getSnapshot()[direction], id))
    return false
  const batch = history
    .getSnapshot()
    [direction].findLast(
      (candidate) => !claimed.has(candidate.id) && (id === undefined || candidate.id === id),
    )
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
  const retained = history.getSnapshot()[direction].find((batch) => batch.id === id)
  if (retained) {
    showNotice(id, direction, { kind: retained.kind, detail: '', count: retained.entries.length })
    return false
  }
  undoShortcuts.delete(id)
  if (result.inverse) {
    const { inverse } = result
    undoShortcuts.set(inverse.id, shortcut)
    showNotice(inverse.id, direction === 'undo' ? 'redo' : 'undo', {
      kind: inverse.kind,
      detail: batchDetail({ failed: result.failed }),
      count: inverse.entries.length,
    })
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
