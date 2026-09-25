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
    record(kind: SessionLifecycleUndoKind, entries: readonly Entry[]) {
      if (!entries.length) return
      branch++
      publish(pushUndo(stack, { kind, entries }))
    },
    forget,
    // Hosts serialize steps with lifecycle mutations; each successful row supplies its inverse receipt.
    async step(direction: HistoryDirection, restore: (entry: Entry) => Promise<Entry | null>) {
      const startedOnBranch = branch
      const taken = takeHistory(stack, direction)
      if (!taken.entry) return { applied: [], failed: 0 }
      publish(taken.stack)
      const applied: Entry[] = []
      let failed = 0
      for (const entry of [...taken.entry.entries].reverse()) {
        const inverse = await restore(entry)
        if (!inverse) {
          forget([entry.ref])
          failed++
          continue
        }
        rebase(entry, inverse.expectedRevision)
        applied.push(inverse)
      }
      if (applied.length && branch === startedOnBranch)
        publish(finishHistory(stack, direction, { kind: taken.entry.kind, entries: applied }))
      return { applied, failed }
    },
  }
}
