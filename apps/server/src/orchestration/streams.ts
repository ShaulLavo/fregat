import { referencingSessionIds, worktreesAffectedByEvent } from './worktree-projection'
import {
  ORCHESTRATION_RESUME_MAX_GAP,
  type OrchestrationShellStreamFrame,
  type OrchestrationSessionStreamFrame,
} from '@workspace/contracts'
import {
  orchestrationShellStreamItemSchema,
  type OrchestrationEvent,
  type OrchestrationShellStreamItem,
  type OrchestrationSessionStreamItem,
} from '@workspace/contracts'
import type { OrchestrationSnapshotQuery } from './snapshot-query'
import * as v from 'valibot'
import type { PlatformDatabase } from '../db/client'
import { orchestrationEventBatchSummary, recordChatPipelineInfo } from './orchestration-logging'
import { appendBounded } from './read-model'
import { createShellRowReader, type OrchestrationShellRowReader } from './shell-row-reader'

export type OrchestrationStreamOptions = {
  afterSequence?: number
  signal?: AbortSignal
}

export type OrchestrationStreamsOptions = {
  coalesceWindowMs?: number
  database?: PlatformDatabase
  hub?: OrchestrationStreamHub
}

type EventSubscriber = {
  close: () => void
  publish: (events: OrchestrationEvent[]) => void
}

/**
 * A server-side consumer of committed domain events. Reactors are named so a
 * failure can be attributed on the dispatching operation's wide event.
 */
export type OrchestrationDomainEventReactor = {
  readonly name: string
  readonly handleEvents: (events: OrchestrationEvent[]) => void
}

export type OrchestrationReactorFailure = {
  readonly code?: string
  readonly message: string
  readonly reactor: string
}

export type OrchestrationDomainPublishResult = {
  readonly failures: readonly OrchestrationReactorFailure[]
  readonly reactorCount: number
}

export type OrchestrationResumeSkipReason =
  | 'cursor-ahead'
  | 'gap-too-large'
  | 'history-evicted'
  | 'no-cursor'

export type OrchestrationResumePlan =
  | { readonly events: OrchestrationEvent[]; readonly gap: number; readonly kind: 'replay' }
  | {
      readonly gap: number
      readonly kind: 'snapshot'
      readonly reason: OrchestrationResumeSkipReason
    }

/**
 * Live tail the hub keeps so a reconnecting subscriber can be resumed by replay
 * instead of re-downloading the workspace. Sized well above
 * `ORCHESTRATION_RESUME_MAX_GAP` so the gap cap — not eviction — is what decides
 * whether a resume is served.
 */
const RETAINED_EVENT_LIMIT = 4_000

/**
 * Shell deltas are coalesced over this window. It bounds the extra latency
 * before a new session appears in the sidebar (imperceptible) while collapsing a
 * streaming turn's delta storm into one read per changed aggregate.
 */
const SHELL_COALESCE_WINDOW_MS = 25
const SHELL_COALESCE_MAX_EVENTS = 512

const DETAIL_EVENT_TYPES = new Set<OrchestrationEvent['type']>([
  'session.message-sent',
  'session.turn-start-requested',
  'session.turn-interrupt-requested',
  'session.runtime-stop-requested',
  'session.activity-appended',
  'session.proposed-plan-upserted',
  'session.proposed-plan-implemented',
  'session.turn-diff-completed',
  'session.checkpoint-revert-requested',
  'session.reverted',
  'session.runtime-set',
  'session.provider-start-claimed',
  'session.provider-start-adopted',
  'session.provider-start-settled',
  'session.runtime-recovered',
  'session.deletion-updated',
])

export class OrchestrationStreamHub {
  private readonly retained: OrchestrationEvent[] = []
  private readonly subscribers = new Set<EventSubscriber>()
  private headSequence = 0

  publish(events: OrchestrationEvent[]) {
    if (events.length === 0) return

    this.retain(events)
    recordChatPipelineInfo('chat.pipeline.stream_hub.publish', {
      headSequence: this.headSequence,
      retainedCount: this.retained.length,
      subscriberCount: this.subscribers.size,
      ...orchestrationEventBatchSummary(events),
    })
    for (const subscriber of this.subscribers) {
      subscriber.publish(events)
    }
  }

  /**
   * Teaches the hub about a sequence it did not publish — the sequence a
   * snapshot was taken at. Without it a process that has published nothing yet
   * treats every resume cursor as "ahead of the server" and answers a reconnect
   * that needs nothing with a full snapshot.
   */
  observeSequence(sequence: number) {
    if (sequence <= this.headSequence) return

    this.headSequence = sequence
  }

  /**
   * Decides how a subscriber holding `afterSequence` is brought up to date.
   * Replay is only offered for a cursor the hub can serve completely: past the
   * gap cap, or past what the retained tail covers, a snapshot is both cheaper
   * and the only correct answer, because a truncated replay would silently drop
   * events the client never learns it is missing.
   */
  resumePlan(afterSequence: number, includeBoundary = false): OrchestrationResumePlan {
    const gap = this.headSequence - afterSequence
    if (afterSequence <= 0) return { gap, kind: 'snapshot', reason: 'no-cursor' }
    if (gap < 0) return { gap, kind: 'snapshot', reason: 'cursor-ahead' }
    if (gap > ORCHESTRATION_RESUME_MAX_GAP)
      return { gap, kind: 'snapshot', reason: 'gap-too-large' }

    const events = this.retainedAfter(afterSequence - Number(includeBoundary))
    if (!events) return { gap, kind: 'snapshot', reason: 'history-evicted' }

    return { events, gap, kind: 'replay' }
  }

  subscribe(signal?: AbortSignal): AsyncGenerator<OrchestrationEvent[]> {
    const queue: OrchestrationEvent[][] = []
    const waiters: Array<(value: IteratorResult<OrchestrationEvent[]>) => void> = []
    let closed = false

    const subscriber: EventSubscriber = {
      close: () => {
        closed = true
        this.subscribers.delete(subscriber)
        recordChatPipelineInfo('chat.pipeline.stream_hub.unsubscribe', {
          subscriberCount: this.subscribers.size,
        })
        while (waiters.length > 0) {
          waiters.shift()?.({ done: true, value: undefined })
        }
      },
      publish: (events) => {
        if (closed) return

        const waiter = waiters.shift()
        if (waiter) {
          waiter({ done: false, value: events })
          return
        }

        queue.push(events)
      },
    }

    this.subscribers.add(subscriber)
    recordChatPipelineInfo('chat.pipeline.stream_hub.subscribe', {
      subscriberCount: this.subscribers.size,
    })
    signal?.addEventListener('abort', subscriber.close, { once: true })

    return eventBatchGenerator(subscriber, queue, waiters, signal)
  }

  private retain(events: OrchestrationEvent[]) {
    for (const event of events) {
      if (event.type === 'session.history-imported') {
        // Keep full transcripts in SQL; reconnects across a replacement use snapshots.
        this.retained.length = 0
        this.observeSequence(event.sequence)
        continue
      }
      appendBounded(this.retained, event, RETAINED_EVENT_LIMIT)
      this.observeSequence(event.sequence)
    }
  }

  private retainedAfter(afterSequence: number): OrchestrationEvent[] | null {
    if (afterSequence >= this.headSequence) return []

    const oldest = this.retained[0]
    // The tail can only answer for cursors at or after the event before its
    // first retained event; anything older has holes we cannot see.
    if (!oldest || afterSequence < oldest.sequence - 1) return null

    return this.retained.filter((event) => event.sequence > afterSequence)
  }
}

/**
 * Fan-out for committed domain events to server-side reactors (provider command
 * reactor, checkpoint reactor, session deletion reactor, ...).
 *
 * Reactors run *after* the write transaction has committed, so a reactor may
 * never unwind an event that is already durable: each one is isolated, and a
 * throw is returned as data for the caller to attach to its wide event rather
 * than propagated. Subscription is dynamic so new reactors attach without the
 * engine growing another hard-wired slot.
 */
export class OrchestrationDomainEventBus {
  private readonly reactors = new Set<OrchestrationDomainEventReactor>()

  subscribe(reactor: OrchestrationDomainEventReactor) {
    this.reactors.add(reactor)

    return () => {
      this.reactors.delete(reactor)
    }
  }

  publish(events: OrchestrationEvent[]): OrchestrationDomainPublishResult {
    const reactorCount = this.reactors.size
    if (events.length === 0) return { failures: [], reactorCount }

    const failures: OrchestrationReactorFailure[] = []
    for (const reactor of this.reactors) {
      const failure = runReactor(reactor, events)
      if (!failure) continue

      failures.push(failure)
    }

    return { failures, reactorCount }
  }
}

export class OrchestrationStreams {
  private readonly database: PlatformDatabase | undefined
  private readonly coalesceWindowMs: number
  private readonly hub: OrchestrationStreamHub
  private readonly rowReader: OrchestrationShellRowReader
  /**
   * Reported on every shell-stream event because the two readers differ by
   * orders of magnitude — point reads versus a full workspace query per window —
   * and the choice is made by whether a caller happened to pass a database. A
   * construction site that forgets one degrades silently otherwise.
   */
  private readonly rowReaderKind: 'projection-row' | 'snapshot-fallback'
  private readonly snapshots: OrchestrationSnapshotQuery

  constructor(snapshots: OrchestrationSnapshotQuery, options: OrchestrationStreamsOptions = {}) {
    this.database = options.database
    this.coalesceWindowMs = options.coalesceWindowMs ?? SHELL_COALESCE_WINDOW_MS
    this.hub = options.hub ?? new OrchestrationStreamHub()
    this.rowReader = createShellRowReader(snapshots, options.database)
    this.rowReaderKind = options.database ? 'projection-row' : 'snapshot-fallback'
    this.snapshots = snapshots
  }

  publish(events: OrchestrationEvent[]) {
    recordChatPipelineInfo('chat.pipeline.streams.publish', {
      ...orchestrationEventBatchSummary(events),
    })
    this.hub.publish(events)
  }

  async *shell(
    options: OrchestrationStreamOptions = {},
  ): AsyncGenerator<OrchestrationShellStreamFrame> {
    const eventBatches = this.hub.subscribe(options.signal)
    const start = this.startShell(options.afterSequence ?? 0)
    let sequence = start.sequence

    yield* start.items
    yield { kind: 'synchronized', sequence }

    const windows = coalesceEventBatches(
      eventBatches,
      this.coalesceWindowMs,
      SHELL_COALESCE_MAX_EVENTS,
    )
    for await (const events of windows) {
      const result = this.shellItemsAfter(events, sequence)
      sequence = result.sequence
      recordChatPipelineInfo('chat.pipeline.shell_stream.batch', {
        coalescedEventCount: result.coalescedFrom,
        emittedItemCount: result.items.length,
        rowReaderKind: this.rowReaderKind,
        sequence,
        ...orchestrationEventBatchSummary(events),
      })
      yield* result.items
    }
  }

  async *sessionDetail(
    sessionId: string,
    options: OrchestrationStreamOptions = {},
  ): AsyncGenerator<OrchestrationSessionStreamFrame> {
    const eventBatches = this.hub.subscribe(options.signal)
    const start = this.startSessionDetail(sessionId, options.afterSequence ?? 0)
    let sequence = start.sequence

    yield* start.items
    yield { kind: 'synchronized', sequence }

    for await (const events of eventBatches) {
      const result = this.sessionItemsAfter(events, sessionId, sequence)
      sequence = result.sequence
      recordChatPipelineInfo('chat.pipeline.session_stream.batch', {
        emittedItemCount: result.items.length,
        sequence,
        sessionId,
        ...orchestrationEventBatchSummary(events),
      })
      yield* result.items
    }
  }

  private startShell(afterSequence: number) {
    // One event can produce several frames; reconnect may have received only the first.
    const plan = this.hub.resumePlan(afterSequence, true)
    if (plan.kind === 'replay') {
      const result = this.shellItemsAfter(plan.events, afterSequence - 1)
      recordChatPipelineInfo('chat.pipeline.shell_stream.start', {
        afterSequence,
        emittedItemCount: result.items.length,
        mode: 'replay',
        replayEventCount: plan.events.length,
        resumeGap: plan.gap,
        rowReaderKind: this.rowReaderKind,
        sequence: result.sequence,
      })

      return { items: result.items, sequence: result.sequence }
    }

    const snapshot = this.snapshots.shellSnapshot()
    this.hub.observeSequence(snapshot.snapshotSequence)
    recordChatPipelineInfo('chat.pipeline.shell_stream.start', {
      afterSequence,
      mode: 'snapshot',
      projectCount: snapshot.projects.length,
      resumeGap: plan.gap,
      resumeSkipReason: plan.reason,
      rowReaderKind: this.rowReaderKind,
      snapshotSequence: snapshot.snapshotSequence,
      sessionCount: snapshot.sessions.length,
    })

    return {
      items: [{ kind: 'snapshot', snapshot } satisfies OrchestrationShellStreamItem],
      sequence: Math.max(afterSequence, snapshot.snapshotSequence),
    }
  }

  private sessionItemsAfter(events: OrchestrationEvent[], sessionId: string, sequence: number) {
    const replaced = events.some(
      (event) =>
        event.sequence > sequence &&
        event.type === 'session.history-imported' &&
        event.payload.sessionId === sessionId,
    )
    if (!replaced) return detailItemsAfter(events, sessionId, sequence)
    // An import can replace thousands of messages; send the normal bounded window.
    const snapshot = this.snapshots.sessionDetailSnapshot(sessionId)
    return {
      items: [{ kind: 'snapshot', snapshot } satisfies OrchestrationSessionStreamItem],
      sequence: snapshot.snapshotSequence,
    }
  }

  private startSessionDetail(sessionId: string, afterSequence: number) {
    const plan = this.hub.resumePlan(afterSequence)
    if (plan.kind === 'replay') {
      const result = this.sessionItemsAfter(plan.events, sessionId, afterSequence)
      recordChatPipelineInfo('chat.pipeline.session_stream.start', {
        afterSequence,
        emittedItemCount: result.items.length,
        mode: 'replay',
        replayEventCount: plan.events.length,
        resumeGap: plan.gap,
        sequence: result.sequence,
        sessionId,
      })

      return { items: result.items, sequence: result.sequence }
    }

    const snapshot = this.snapshots.sessionDetailSnapshot(sessionId)
    this.hub.observeSequence(snapshot.snapshotSequence)
    recordChatPipelineInfo('chat.pipeline.session_stream.start', {
      activityCount: snapshot.session.activities.length,
      afterSequence,
      latestTurnState: snapshot.session.latestTurn?.state ?? null,
      messageCount: snapshot.session.messages.length,
      mode: 'snapshot',
      resumeGap: plan.gap,
      resumeSkipReason: plan.reason,
      sessionStatus: snapshot.session.runtime?.status ?? null,
      snapshotSequence: snapshot.snapshotSequence,
      sessionId,
    })

    return {
      items: [{ kind: 'snapshot', snapshot } satisfies OrchestrationSessionStreamItem],
      sequence: Math.max(afterSequence, snapshot.snapshotSequence),
    }
  }

  /**
   * One read per *changed aggregate*, not per event: within a window the last
   * event for an aggregate is the only one that matters, because the read
   * returns that aggregate's current shell either way. A `none` is emitted as a
   * removal rather than dropped — that is what keeps coalescing correct when a
   * burst collapses a deletion into a later event for the same aggregate.
   */
  private shellItemsAfter(events: OrchestrationEvent[], sequence: number) {
    const fresh = events.filter((event) => event.sequence > sequence)
    const survivors = latestEventPerAggregate(fresh)
    if (survivors.length > 0) this.rowReader.beginWindow()

    const items: OrchestrationShellStreamItem[] = []
    for (const event of survivors) {
      const item = this.shellItemForEvent(event)
      if (!item) continue

      items.push(item)
    }

    this.appendRelatedShellItems(fresh, items)
    items.sort((left, right) => shellSequence(left) - shellSequence(right))
    return { coalescedFrom: fresh.length, items, sequence: maxSequence(fresh, sequence) }
  }

  private appendRelatedShellItems(
    events: OrchestrationEvent[],
    items: OrchestrationShellStreamItem[],
  ) {
    if (!this.database) return
    const worktrees = new Map<string, number>()
    const sessions = new Map<string, number>()
    for (const event of events) {
      for (const id of worktreesAffectedByEvent(this.database, event))
        worktrees.set(id, Math.max(worktrees.get(id) ?? 0, event.sequence))
      if (event.aggregateKind !== 'worktree') continue
      for (const id of referencingSessionIds(this.database, event.aggregateId))
        sessions.set(id, Math.max(sessions.get(id) ?? 0, event.sequence))
    }
    for (const [worktreeId, sequence] of worktrees) {
      if (
        items.some(
          (item) =>
            (item.kind === 'worktree-upserted' && item.worktree.id === worktreeId) ||
            (item.kind === 'worktree-removed' && item.worktreeId === worktreeId),
        )
      )
        continue
      const worktree = this.rowReader.worktreeShell(worktreeId)
      if (worktree) {
        items.push({ kind: 'worktree-upserted', worktree, sequence })
        continue
      }
      items.push(
        v.parse(orchestrationShellStreamItemSchema, {
          kind: 'worktree-removed',
          worktreeId,
          sequence,
        }),
      )
    }
    for (const [sessionId, sequence] of sessions) {
      if (items.some((item) => item.kind === 'session-upserted' && item.session.id === sessionId))
        continue
      const session = this.rowReader.sessionShell(sessionId)
      if (session) items.push({ kind: 'session-upserted', session, sequence })
    }
  }

  private shellItemForEvent(event: OrchestrationEvent): OrchestrationShellStreamItem | null {
    if (event.aggregateKind === 'project') return this.projectItem(event)
    if (event.aggregateKind === 'worktree') return this.worktreeItem(event)
    if (event.aggregateKind === 'session') return this.sessionItem(event)

    return null
  }

  private projectItem(event: OrchestrationEvent): OrchestrationShellStreamItem {
    const project = this.rowReader.projectShell(event.aggregateId)
    if (project) return { kind: 'project-upserted', project, sequence: event.sequence }

    return v.parse(orchestrationShellStreamItemSchema, {
      kind: 'project-removed',
      projectId: event.aggregateId,
      sequence: event.sequence,
    })
  }

  private worktreeItem(event: OrchestrationEvent): OrchestrationShellStreamItem {
    const worktree = this.rowReader.worktreeShell(event.aggregateId)
    if (worktree) return { kind: 'worktree-upserted', worktree, sequence: event.sequence }
    return v.parse(orchestrationShellStreamItemSchema, {
      kind: 'worktree-removed',
      worktreeId: event.aggregateId,
      sequence: event.sequence,
    })
  }

  private sessionItem(event: OrchestrationEvent): OrchestrationShellStreamItem {
    const session = this.rowReader.sessionShell(event.aggregateId)
    if (session) return { kind: 'session-upserted', sequence: event.sequence, session }

    return v.parse(orchestrationShellStreamItemSchema, {
      kind: 'session-removed',
      sequence: event.sequence,
      sessionId: event.aggregateId,
    })
  }
}

function runReactor(
  reactor: OrchestrationDomainEventReactor,
  events: OrchestrationEvent[],
): OrchestrationReactorFailure | null {
  try {
    reactor.handleEvents(events)

    return null
  } catch (error) {
    return {
      ...reactorErrorCode(error),
      message: reactorErrorMessage(error),
      reactor: reactor.name,
    }
  }
}

function reactorErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message

  return String(error)
}

function reactorErrorCode(error: unknown) {
  const code = (error as { code?: unknown } | null)?.code
  if (typeof code !== 'string') return {}

  return { code }
}

function latestEventPerAggregate(events: readonly OrchestrationEvent[]) {
  const latest = new Map<string, OrchestrationEvent>()

  for (const event of events) {
    latest.set(`${event.aggregateKind}:${event.aggregateId}`, event)
  }

  return [...latest.values()].toSorted((left, right) => left.sequence - right.sequence)
}

function shellSequence(item: OrchestrationShellStreamItem) {
  return item.kind === 'snapshot' ? item.snapshot.snapshotSequence : item.sequence
}

function maxSequence(events: readonly OrchestrationEvent[], sequence: number) {
  let highest = sequence

  for (const event of events) {
    if (event.sequence <= highest) continue

    highest = event.sequence
  }

  return highest
}

function detailItemsAfter(events: OrchestrationEvent[], sessionId: string, sequence: number) {
  const items: OrchestrationSessionStreamItem[] = []
  let nextSequence = sequence

  for (const event of events) {
    if (event.sequence <= nextSequence) continue

    nextSequence = event.sequence
    if (!isDetailEventForSession(event, sessionId)) continue

    items.push({ event, kind: 'event' })
  }

  return { items, sequence: nextSequence }
}

const COALESCE_WINDOW_ELAPSED = Symbol('coalesce-window-elapsed')

/**
 * Groups published batches into windows: at most `windowMs` after the first
 * event of a window, or as soon as `maxEvents` have accumulated. The pending
 * `next()` promise is carried across iterations rather than re-issued, because
 * calling `next()` again on a generator that is already suspended in one would
 * interleave two reads of the same subscription.
 */
async function* coalesceEventBatches(
  batches: AsyncGenerator<OrchestrationEvent[]>,
  windowMs: number,
  maxEvents: number,
): AsyncGenerator<OrchestrationEvent[]> {
  const pending: OrchestrationEvent[] = []
  let inflight: Promise<IteratorResult<OrchestrationEvent[]>> | null = null
  let closesAt = 0

  try {
    while (true) {
      inflight ??= batches.next()
      const result = await raceCoalesceWindow(inflight, pending.length === 0 ? null : closesAt)
      if (result === COALESCE_WINDOW_ELAPSED) {
        yield pending.splice(0)
        continue
      }

      inflight = null
      if (result.done) break

      if (pending.length === 0) closesAt = Date.now() + windowMs
      pending.push(...result.value)
      if (pending.length < maxEvents) continue

      yield pending.splice(0)
    }

    if (pending.length > 0) yield pending.splice(0)
  } finally {
    void batches.return(undefined)
  }
}

async function raceCoalesceWindow(
  inflight: Promise<IteratorResult<OrchestrationEvent[]>>,
  closesAt: number | null,
) {
  if (closesAt === null) return await inflight

  const deadline = coalesceDeadline(Math.max(0, closesAt - Date.now()))
  try {
    return await Promise.race([inflight, deadline.promise])
  } finally {
    deadline.cancel()
  }
}

function coalesceDeadline(delayMs: number) {
  let timer: ReturnType<typeof setTimeout> | undefined
  const promise = new Promise<typeof COALESCE_WINDOW_ELAPSED>((resolve) => {
    timer = setTimeout(() => resolve(COALESCE_WINDOW_ELAPSED), delayMs)
  })

  return { cancel: () => clearTimeout(timer), promise }
}

async function* eventBatchGenerator(
  subscriber: EventSubscriber,
  queue: OrchestrationEvent[][],
  waiters: Array<(value: IteratorResult<OrchestrationEvent[]>) => void>,
  signal?: AbortSignal,
): AsyncGenerator<OrchestrationEvent[]> {
  try {
    while (!signal?.aborted) {
      const next = queue.shift()
      if (next) {
        yield next
        continue
      }

      const result = await new Promise<IteratorResult<OrchestrationEvent[]>>((resolve) => {
        waiters.push(resolve)
      })
      if (result.done) return

      yield result.value
    }
  } finally {
    subscriber.close()
  }
}

function isDetailEventForSession(event: OrchestrationEvent, sessionId: string) {
  if (event.aggregateKind !== 'session') return false
  if (event.aggregateId !== sessionId) return false

  return DETAIL_EVENT_TYPES.has(event.type)
}
