import { toast } from 'sonner'
import { create } from 'zustand'
import type { ProjectId, ScopedSessionRef } from '@workspace/contracts'
import {
  forgetSessionLifecycleUndo,
  offerSessionLifecycleUndo,
  sessionLifecycleRestoreCommand,
  sessionLifecycleRestoreSteps,
  sessionLifecycleVerb,
  type SessionLifecycleUndoEntry,
  type SessionLifecycleUndoKind,
  type SessionLifecycleUndoSlot,
} from '@workspace/client-core/chat/rail/lifecycle-undo'
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

/** Where an archived session was open, so its Undo can open it there again. */
type SessionReopen = {
  readonly surface: 'main' | 'sidebar'
  readonly projectId: ProjectId
}

export type SessionUndoEntry = SessionLifecycleUndoEntry & {
  readonly reopen: SessionReopen | null
}

export type SessionUndoSlot = SessionLifecycleUndoSlot<SessionUndoEntry>

const UNDO_WINDOW_MS = 5_000
const UNDO_TOAST_ID = 'session-lifecycle-undo'

export const useSessionUndoStore = create<{ readonly slot: SessionUndoSlot | null }>()(() => ({
  slot: null,
}))

let expiry: ReturnType<typeof setTimeout> | undefined
let presentation: Pick<SessionUndoNotice, 'detail' | 'shortcut'> | null = null

function publish(slot: SessionUndoSlot | null) {
  useSessionUndoStore.setState({ slot })
  if (slot) {
    showNotice(slot)
    return
  }
  clearTimeout(expiry)
  presentation = null
  toast.dismiss(UNDO_TOAST_ID)
}

function showNotice(slot: SessionUndoSlot) {
  if (!presentation) return
  const { detail, shortcut } = presentation
  toast(`${slot.entries.length} ${sessionLifecycleVerb(slot.kind)}${detail}`, {
    id: UNDO_TOAST_ID,
    // The slot's own timer ends the notice, so hovering cannot outlive the Undo.
    duration: Number.POSITIVE_INFINITY,
    ...(shortcut ? { description: `${shortcut} to undo` } : {}),
    action: { label: 'Undo', onClick: () => void undoLatestSessionAction() },
  })
}

export function sessionUndoAvailable() {
  return useSessionUndoStore.getState().slot !== null
}

export type SessionUndoNotice = {
  readonly kind: SessionLifecycleUndoKind
  readonly entries: readonly SessionUndoEntry[]
  /** Skipped and failed counts from the batch, appended to the notice. */
  readonly detail: string
  readonly shortcut: string | null
}

/** Records the undoable rows and shows one notice for the whole slot for five seconds. */
export function offerSessionUndo({ kind, entries, ...notice }: SessionUndoNotice) {
  const slot = offerSessionLifecycleUndo(useSessionUndoStore.getState().slot, kind, entries)
  if (!slot || !entries.length) return
  presentation = notice
  publish(slot)
  clearTimeout(expiry)
  expiry = setTimeout(() => publish(null), UNDO_WINDOW_MS)
}

/** A later change to these sessions supersedes their Undo. */
export function forgetSessionUndo(refs: readonly ScopedSessionRef[]) {
  const current = useSessionUndoStore.getState().slot
  const slot = forgetSessionLifecycleUndo(current, refs)
  if (slot !== current) publish(slot)
}

export function resetSessionUndo() {
  publish(null)
}

/**
 * Runs the latest Undo once. The slot is taken before anything is awaited, so a
 * second click or shortcut finds nothing to restore.
 */
export async function undoLatestSessionAction() {
  const slot = useSessionUndoStore.getState().slot
  if (!slot) return false
  publish(null)
  const result = await runMutation(primaryQueryClient(), sessionUndoMutationOptions(), slot)
  return result.failed === 0
}

function sessionUndoMutationOptions() {
  return {
    mutationKey: chatModeMutationKeys.lifecycleUndo(),
    scope: { id: CHAT_SESSION_SCOPE },
    mutationFn: restoreSessions,
    onSuccess: ({ failed, error }: Awaited<ReturnType<typeof restoreSessions>>) => {
      if (!failed) return
      notifyChatCommandError(error, `Undo failed for ${failed} session${failed === 1 ? '' : 's'}`)
    },
  }
}

async function restoreSessions(slot: SessionUndoSlot) {
  const now = Date.now()
  let failed = 0
  let error: unknown = null
  for (const entry of slot.entries) {
    const outcome = await restoreSession(slot.kind, entry, now)
    if (outcome.ok) continue
    failed++
    error = outcome.error
  }
  return { failed, error }
}

async function restoreSession(
  kind: SessionLifecycleUndoKind,
  entry: SessionUndoEntry,
  now: number,
) {
  for (const step of sessionLifecycleRestoreSteps(kind, entry.before, now)) {
    const outcome = await dispatchChatCommand({
      action: `chat.session.undo.${kind}`,
      command: sessionLifecycleRestoreCommand(entry.ref.sessionId, step),
      dispatchCommand: (command) => dispatchCommandForEnvironment(entry.ref.environmentId, command),
    })
    if (!outcome.ok) return outcome
    if (step.type === 'unsnooze') updateSessionRead(entry.ref, 'wake')
  }
  if (entry.reopen) await reopenSession(entry.ref, entry.reopen)
  return { ok: true } as const
}

async function reopenSession(ref: ScopedSessionRef, reopen: SessionReopen) {
  try {
    const result = await getNavigation().openChat({
      environmentId: ref.environmentId,
      sessionId: ref.sessionId,
      projectId: reopen.projectId,
      surface: reopen.surface,
    })
    if (result.status !== 'unavailable') return
    toastError('Session restored, but navigation failed', { description: result.reason })
  } catch (error) {
    toastError('Session restored, but navigation failed', {
      description: errorMessage(error, 'The session could not be opened.'),
    })
  }
}
