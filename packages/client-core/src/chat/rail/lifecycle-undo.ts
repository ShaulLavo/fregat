import * as v from 'valibot'
import {
  commandIdSchema,
  scopedSessionKey,
  type ClientOrchestrationCommand,
  type CommandId,
  type OrchestrationDispatchResult,
  type ScopedSessionRef,
  type SessionLifecycleState,
} from '@workspace/contracts'
import {
  emptyUndoStack,
  pushUndo,
  takeHistory,
  finishHistory,
  type HistoryDirection,
  type UndoStack,
} from '../../history/undo-stack'
import type { SessionLifecycleChange } from '../commands'

export type SessionLifecycleUndoKind = 'archive' | 'settle' | 'snooze' | 'unpin'
export type SessionLifecycleUndoEntry = {
  readonly ref: ScopedSessionRef
  readonly before: SessionLifecycleState
  readonly restoreCommandId: CommandId
  readonly expectedRevision: number
  readonly restoreRevision: number
}
export type SessionLifecycleUndoBatch<Entry extends SessionLifecycleUndoEntry> = {
  readonly id: number
  readonly kind: SessionLifecycleUndoKind
  readonly entries: readonly Entry[]
}

/** A batch can restore only after later actions on the same sessions have been restored. */
export function canStepSessionLifecycleBatch<Entry extends SessionLifecycleUndoEntry>(
  batches: readonly SessionLifecycleUndoBatch<Entry>[],
  id: number,
) {
  const index = batches.findIndex((batch) => batch.id === id)
  const batch = batches[index]
  if (!batch) return false
  const keys = new Set(batch.entries.map((entry) => scopedSessionKey(entry.ref)))
  return !batches
    .slice(index + 1)
    .some((later) => later.entries.some((entry) => keys.has(scopedSessionKey(entry.ref))))
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
export function sessionLifecycleVerb(type: SessionLifecycleChange['type'] | 'archive') {
  return LIFECYCLE_VERBS[type]
}

export function sessionLifecycleUndoEntry(
  ref: ScopedSessionRef,
  result: OrchestrationDispatchResult,
): SessionLifecycleUndoEntry | null {
  if (!result.lifecycle || result.lifecycle.sessionId !== ref.sessionId) return null
  return {
    ref,
    before: result.lifecycle.before,
    restoreCommandId: result.lifecycle.commandId,
    expectedRevision: result.sequence,
    restoreRevision: result.lifecycle.beforeRevision,
  }
}

export function sessionLifecycleRestoreCommand(
  entry: SessionLifecycleUndoEntry,
): ClientOrchestrationCommand {
  return {
    type: 'session.lifecycle.restore',
    commandId: v.parse(commandIdSchema, crypto.randomUUID()),
    sessionId: entry.ref.sessionId,
    expectedRevision: entry.expectedRevision,
    restoreCommandId: entry.restoreCommandId,
  }
}

export function createSessionLifecycleHistory<Entry extends SessionLifecycleUndoEntry>() {
  type Batch = SessionLifecycleUndoBatch<Entry>
  let stack = emptyUndoStack<Batch>()
  let branch = 0
  let lastId = 0
  const listeners = new Set<() => void>()
  function publish(next: UndoStack<Batch>) {
    stack = next
    for (const listener of listeners) listener()
  }
  function forget(refs: readonly ScopedSessionRef[]) {
    const keys = new Set(refs.map(scopedSessionKey))
    const retain = (batches: readonly Batch[]) =>
      batches
        .map((batch) => {
          const entries = batch.entries.filter((entry) => !keys.has(scopedSessionKey(entry.ref)))
          return entries.length === batch.entries.length ? batch : { ...batch, entries }
        })
        .filter((batch) => batch.entries.length > 0)
    publish({ undo: retain(stack.undo), redo: retain(stack.redo) })
  }
  function rebase(entry: Entry, revision: number) {
    const update = (batch: Batch): Batch => ({
      ...batch,
      entries: batch.entries.map((older) =>
        scopedSessionKey(older.ref) === scopedSessionKey(entry.ref) &&
        older.expectedRevision === entry.restoreRevision
          ? { ...older, expectedRevision: revision }
          : older,
      ),
    })
    publish({ undo: stack.undo.map(update), redo: stack.redo.map(update) })
  }
  return {
    getSnapshot: () => stack,
    subscribe(listener: () => void) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    clear: () => {
      branch++
      publish(emptyUndoStack<Batch>())
    },
    /** Returns the batch id, which `step` and `expire` take to address this batch. */
    record(kind: SessionLifecycleUndoKind, entries: readonly Entry[]) {
      if (!entries.length) return null
      branch++
      const id = ++lastId
      publish(pushUndo(stack, { id, kind, entries }))
      return id
    },
    forget,
    /** Drops one batch from either direction; hosts call this when its notice goes away. */
    expire(id: number) {
      const keep = (batch: Batch) => batch.id !== id
      if (!stack.undo.concat(stack.redo).some((batch) => !keep(batch))) return
      publish({ undo: stack.undo.filter(keep), redo: stack.redo.filter(keep) })
    },
    // Hosts serialize steps with lifecycle mutations; each successful row supplies its inverse receipt.
    // `id` steps that batch (its notice's own button); without it, the newest batch.
    async step(
      direction: HistoryDirection,
      restore: (entry: Entry) => Promise<Entry | null>,
      id?: number,
    ) {
      if (id !== undefined && !canStepSessionLifecycleBatch(stack[direction], id))
        return { applied: [], failed: 0, taken: null, inverse: null }
      const startedOnBranch = branch
      const taken = takeHistory(stack, direction, (batch) => id === undefined || batch.id === id)
      if (!taken.entry) return { applied: [], failed: 0, taken: null, inverse: null }
      publish(taken.stack)
      const applied: Entry[] = []
      let failed = 0
      for (const entry of taken.entry.entries.toReversed()) {
        const inverse = await restore(entry)
        if (!inverse) {
          forget([entry.ref])
          failed++
          continue
        }
        rebase(entry, inverse.expectedRevision)
        applied.push(inverse)
      }
      if (!applied.length || branch !== startedOnBranch)
        return { applied, failed, taken: taken.entry, inverse: null }
      const inverse: Batch = { id: ++lastId, kind: taken.entry.kind, entries: applied }
      publish(finishHistory(stack, direction, inverse))
      return { applied, failed, taken: taken.entry, inverse }
    },
  }
}
