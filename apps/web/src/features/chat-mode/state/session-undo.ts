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

export type SessionUndoEntry = SessionLifecycleUndoEntry & {
  readonly reopen: { readonly surface: 'main' | 'sidebar'; readonly projectId: ProjectId } | null
}
const history = createSessionLifecycleHistory<SessionUndoEntry>()
const UNDO_TOAST_ID = 'session-lifecycle-undo'
export const useSessionUndoStore = create(() => history.getSnapshot())
history.subscribe(() => useSessionUndoStore.setState(history.getSnapshot()))

export function sessionUndoAvailable() {
  return history.getSnapshot().undo.length > 0
}
export function sessionRedoAvailable() {
  return history.getSnapshot().redo.length > 0
}

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
  if (!entries.length) return
  history.record(kind, entries)
  toast(`${entries.length} ${sessionLifecycleVerb(kind)}${detail}`, {
    id: UNDO_TOAST_ID,
    duration: 5_000,
    ...(shortcut ? { description: `${shortcut} to undo` } : {}),
    action: { label: 'Undo', onClick: () => void undoLatestSessionAction() },
  })
}
export function forgetSessionUndo(refs: readonly ScopedSessionRef[]) {
  const previous = history.getSnapshot().undo.at(-1)
  history.forget(refs)
  if (previous !== history.getSnapshot().undo.at(-1)) toast.dismiss(UNDO_TOAST_ID)
}
export function resetSessionUndo() {
  history.clear()
  toast.dismiss(UNDO_TOAST_ID)
}
export function undoLatestSessionAction() {
  return stepSessionHistory('undo')
}
export function redoLatestSessionAction() {
  return stepSessionHistory('redo')
}

async function stepSessionHistory(direction: HistoryDirection) {
  if (!history.getSnapshot()[direction].length) return false
  return runMutation(
    primaryQueryClient(),
    {
      mutationKey: chatModeMutationKeys.lifecycleUndo(),
      scope: { id: CHAT_SESSION_SCOPE },
      mutationFn: async () => {
        toast.dismiss(UNDO_TOAST_ID)
        const result = await history.step(direction, restoreSession)
        return result.applied.length > 0 && result.failed === 0
      },
    },
    undefined,
  )
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
