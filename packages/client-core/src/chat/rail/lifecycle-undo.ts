import {
  scopedSessionKey,
  type ClientOrchestrationCommand,
  type ScopedSessionRef,
  type SessionId,
} from '@workspace/contracts'
import {
  createSessionActiveReorderCommand,
  createSessionLifecycleCommand,
  createSessionUnarchiveCommand,
  type SessionLifecycleChange,
} from '../commands'

/** The lifecycle actions that offer an Undo. */
export type SessionLifecycleUndoKind = 'archive' | 'settle' | 'snooze' | 'unpin'

type LifecycleSource = {
  readonly archivedAt?: string | null
  readonly settledOverride?: 'settled' | 'active' | null
  readonly snoozedUntil?: string | null
  readonly pinnedAt?: string | null
  readonly pinOrderKey?: string | null
  readonly activeOrderKey?: string | null
}

/** A session's lifecycle fields, read before an undoable action is dispatched. */
export type SessionLifecycleSnapshot = {
  readonly archived: boolean
  readonly settled: boolean
  readonly snoozedUntil: string | null
  readonly pinned: boolean
  readonly pinOrderKey: string | null
  readonly activeOrderKey: string | null
}

export type SessionLifecycleRestoreStep =
  | Extract<SessionLifecycleChange, { readonly type: 'pin' | 'snooze' }>
  | { readonly type: 'unsettle' | 'unsnooze' }
  | { readonly type: 'unarchive' }
  | { readonly type: 'active.reorder'; readonly orderKey: string }

export type SessionLifecycleUndoEntry = {
  readonly ref: ScopedSessionRef
  readonly before: SessionLifecycleSnapshot
}

/** The one latest-undo slot: consecutive actions of one kind share it. */
export type SessionLifecycleUndoSlot<Entry extends SessionLifecycleUndoEntry> = {
  readonly kind: SessionLifecycleUndoKind
  readonly entries: readonly Entry[]
}

const LIFECYCLE_VERBS: Record<SessionLifecycleChange['type'] | 'archive', string> = {
  archive: 'archived',
  settle: 'settled',
  unsettle: 'moved to active',
  snooze: 'snoozed',
  unsnooze: 'unsnoozed',
  pin: 'pinned',
  unpin: 'unpinned',
}

/** The past tense a notice counts sessions with, as in "2 archived". */
export function sessionLifecycleVerb(type: SessionLifecycleChange['type'] | 'archive') {
  return LIFECYCLE_VERBS[type]
}

export function captureSessionLifecycle(session: LifecycleSource): SessionLifecycleSnapshot {
  return {
    archived: Boolean(session.archivedAt),
    settled: session.settledOverride === 'settled',
    snoozedUntil: session.snoozedUntil ?? null,
    pinned: Boolean(session.pinnedAt),
    pinOrderKey: session.pinnedAt ? (session.pinOrderKey ?? null) : null,
    activeOrderKey: session.activeOrderKey ?? null,
  }
}

/**
 * The commands that put `before` back after `kind` succeeded. Settling also
 * clears the pin, the snooze and the active slot server-side, and a pin spends
 * a snooze, so those return in this order.
 */
export function sessionLifecycleRestoreSteps(
  kind: SessionLifecycleUndoKind,
  before: SessionLifecycleSnapshot,
  now: number,
): readonly SessionLifecycleRestoreStep[] {
  switch (kind) {
    case 'archive':
      return before.archived ? [] : [{ type: 'unarchive' }]
    case 'snooze':
      return [restoredSnooze(before, now) ?? { type: 'unsnooze' }]
    case 'unpin':
      return before.pinned ? [restoredPin(before), ...snoozeSteps(before, now)] : []
    case 'settle':
      return settleRestoreSteps(before, now)
  }
}

function settleRestoreSteps(before: SessionLifecycleSnapshot, now: number) {
  if (before.settled) return snoozeSteps(before, now)
  const steps: SessionLifecycleRestoreStep[] = [{ type: 'unsettle' }]
  // The server refuses an active reorder on a pinned row, so the slot returns first.
  if (before.activeOrderKey) steps.push({ type: 'active.reorder', orderKey: before.activeOrderKey })
  if (before.pinned) steps.push(restoredPin(before))
  steps.push(...snoozeSteps(before, now))
  return steps
}

function restoredPin(before: SessionLifecycleSnapshot): SessionLifecycleRestoreStep {
  return before.pinOrderKey ? { type: 'pin', orderKey: before.pinOrderKey } : { type: 'pin' }
}

function restoredSnooze(before: SessionLifecycleSnapshot, now: number) {
  const until = before.snoozedUntil
  if (!until || !(Date.parse(until) > now)) return null
  return { type: 'snooze', snoozedUntil: until } as const
}

function snoozeSteps(before: SessionLifecycleSnapshot, now: number) {
  const snooze = restoredSnooze(before, now)
  return snooze ? [snooze] : []
}

export function sessionLifecycleRestoreCommand(
  sessionId: SessionId,
  step: SessionLifecycleRestoreStep,
): ClientOrchestrationCommand {
  if (step.type === 'unarchive') return createSessionUnarchiveCommand({ sessionId })
  if (step.type === 'active.reorder')
    return createSessionActiveReorderCommand({ sessionId, orderKey: step.orderKey })
  return createSessionLifecycleCommand(sessionId, step)
}

/**
 * A later action of the same kind joins the slot and replaces an older entry for
 * the same session; any other kind takes the slot over.
 */
export function offerSessionLifecycleUndo<Entry extends SessionLifecycleUndoEntry>(
  slot: SessionLifecycleUndoSlot<Entry> | null,
  kind: SessionLifecycleUndoKind,
  entries: readonly Entry[],
): SessionLifecycleUndoSlot<Entry> | null {
  if (!entries.length) return slot
  if (slot?.kind !== kind) return { kind, entries }
  const offered = new Set(entries.map((entry) => scopedSessionKey(entry.ref)))
  return {
    kind,
    entries: [
      ...slot.entries.filter((entry) => !offered.has(scopedSessionKey(entry.ref))),
      ...entries,
    ],
  }
}

/** Another change to a session expires its Undo; an emptied slot is gone. */
export function forgetSessionLifecycleUndo<Entry extends SessionLifecycleUndoEntry>(
  slot: SessionLifecycleUndoSlot<Entry> | null,
  refs: readonly ScopedSessionRef[],
): SessionLifecycleUndoSlot<Entry> | null {
  if (!slot) return null
  const forgotten = new Set(refs.map(scopedSessionKey))
  const entries = slot.entries.filter((entry) => !forgotten.has(scopedSessionKey(entry.ref)))
  if (entries.length === slot.entries.length) return slot
  return entries.length ? { kind: slot.kind, entries } : null
}
