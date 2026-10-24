export type EditorWorkTaskClass =
  | 'input-critical'
  | 'visible-render'
  | 'viewport-derived'
  | 'background-derived'
  | 'idle-cache'

export type EditorWorkPriority = 'critical' | 'high' | 'normal' | 'low' | 'idle'

export type EditorWorkTags = {
  readonly snapshotVersion?: number
  readonly version?: number
  readonly viewport?: string | number | null
  readonly configuration?: string | number | null
}

export type EditorWorkEventType =
  | 'scheduled'
  | 'cancelled'
  | 'dropped'
  | 'started'
  | 'completed'
  | 'failed'
  | 'timed-out'

export type EditorWorkEvent = {
  readonly type: EditorWorkEventType
  readonly key: string
  readonly token: number
  readonly taskClass: EditorWorkTaskClass
  readonly priority: EditorWorkPriority
  readonly tags: EditorWorkTags
  readonly reason?: string
  readonly elapsedMs?: number
  readonly error?: unknown
}

export type EditorWorkContext = {
  readonly key: string
  readonly token: number
  readonly taskClass: EditorWorkTaskClass
  readonly priority: EditorWorkPriority
  readonly tags: EditorWorkTags
  readonly signal: AbortSignal
  readonly startedAt: number
  isCurrent(): boolean
}

export type EditorWorkSchedulerOptions = {
  now?(): number
  onEvent?(event: EditorWorkEvent): void
}

export type EditorScheduleWorkOptions<T> = {
  readonly key: string
  readonly taskClass: EditorWorkTaskClass
  readonly priority?: EditorWorkPriority
  readonly tags?: EditorWorkTags
  readonly delayMs?: number
  // Ceiling on how long re-scheduling the same key may keep postponing it.
  // With delayMs alone, work that is rescheduled on every keystroke never runs
  // while the user keeps typing; maxDelayMs makes the deadline something a
  // replacement can only pull in, never push out.
  readonly maxDelayMs?: number
  readonly budgetMs?: number
  readonly defer?: boolean
  readonly replace?: boolean
  isCurrent?(tags: EditorWorkTags, context: EditorWorkContext): boolean
  run(context: EditorWorkContext): T | Promise<T>
  apply?(result: Awaited<T>, context: EditorWorkContext): void
  fail?(error: unknown, context: EditorWorkContext): void
  cancel?(): void
}

export type EditorScheduledWorkHandle = {
  readonly key: string
  readonly token: number
  readonly signal: AbortSignal
  cancel(): void
  isActive(): boolean
}

type ScheduledEditorWork<T = unknown> = {
  readonly key: string
  readonly token: number
  readonly taskClass: EditorWorkTaskClass
  readonly priority: EditorWorkPriority
  readonly tags: EditorWorkTags
  readonly controller: AbortController
  readonly options: EditorScheduleWorkOptions<T>
  readonly createdAt: number
  // When this key's currently-pending run was *first* requested; survives
  // replacement so maxDelayMs measures the whole burst, not the last keystroke.
  readonly firstScheduledAt: number
  timer: ReturnType<typeof globalThis.setTimeout> | null
  budgetTimer: ReturnType<typeof globalThis.setTimeout> | null
  startedAt: number | null
}

const TASK_CLASS_PRIORITIES: Record<EditorWorkTaskClass, EditorWorkPriority> = {
  'input-critical': 'critical',
  'visible-render': 'high',
  'viewport-derived': 'normal',
  'background-derived': 'low',
  'idle-cache': 'idle',
}

const PRIORITY_RANK: Record<EditorWorkPriority, number> = {
  critical: 0,
  high: 1,
  normal: 2,
  low: 3,
  idle: 4,
}

export class EditorWorkScheduler {
  private readonly now: () => number
  private readonly onEvent?: (event: EditorWorkEvent) => void
  private readonly scheduled = new Map<string, ScheduledEditorWork>()
  private queued: ScheduledEditorWork[] = []
  private queueTimer: ReturnType<typeof globalThis.setTimeout> | null = null
  private queueTask: AbortController | null = null
  private nextToken = 0
  private disposed = false

  constructor(options: EditorWorkSchedulerOptions = {}) {
    this.now = options.now ?? nowMs
    this.onEvent = options.onEvent
  }

  schedule<T>(options: EditorScheduleWorkOptions<T>): EditorScheduledWorkHandle {
    if (this.disposed) return inactiveHandle(options.key)
    const existing = this.scheduled.get(options.key)
    if (existing && options.replace === false) return this.handleFor(existing)

    // Read before cancelling: the outgoing work carries the deadline that the
    // replacement must not push out.
    const firstScheduledAt = existing?.firstScheduledAt ?? null
    if (options.replace !== false) this.cancel(options.key, 'replaced')

    const work = this.createWork(options, firstScheduledAt)
    this.scheduled.set(options.key, work)
    this.emit(work, 'scheduled')
    this.scheduleStart(work)
    return this.handleFor(work)
  }

  cancel(key: string, reason = 'cancelled'): void {
    const work = this.scheduled.get(key)
    if (!work) return

    this.cancelWork(work, reason)
  }

  dispose(): void {
    if (this.disposed) return

    this.disposed = true
    const works = [...this.scheduled.values()]
    for (const work of works) this.cancelWork(work, 'disposed')
    this.clearQueueTimer()
    this.queued = []
  }

  private createWork<T>(
    options: EditorScheduleWorkOptions<T>,
    firstScheduledAt: number | null = null,
  ): ScheduledEditorWork<T> {
    const token = this.nextToken + 1
    this.nextToken = token
    const now = this.now()
    return {
      firstScheduledAt: firstScheduledAt ?? now,
      key: options.key,
      token,
      taskClass: options.taskClass,
      priority: options.priority ?? TASK_CLASS_PRIORITIES[options.taskClass],
      tags: options.tags ?? {},
      controller: new AbortController(),
      options,
      createdAt: now,
      timer: null,
      budgetTimer: null,
      startedAt: null,
    }
  }

  private scheduleStart(work: ScheduledEditorWork): void {
    const delayMs = this.effectiveDelayMs(work)
    if (delayMs === 0) {
      this.startZeroDelayWork(work)
      return
    }

    work.timer = globalThis.setTimeout(() => this.start(work), delayMs)
  }

  // The requested delay, clamped by whatever remains of the burst's maximum
  // wait. Once that budget is exhausted the work runs on the next tick even if
  // the key keeps being rescheduled.
  private effectiveDelayMs(work: ScheduledEditorWork): number {
    const delayMs = normalizeDelayMs(work.options.delayMs)
    const maxDelayMs = normalizeDelayMs(work.options.maxDelayMs)
    if (maxDelayMs === 0 || delayMs === 0) return delayMs

    const remaining = work.firstScheduledAt + maxDelayMs - this.now()
    return Math.max(0, Math.min(delayMs, remaining))
  }

  private startZeroDelayWork(work: ScheduledEditorWork): void {
    if (work.options.defer === true) {
      this.enqueueStart(work)
      return
    }

    this.start(work)
  }

  private enqueueStart(work: ScheduledEditorWork): void {
    if (!this.isCurrentWork(work)) return

    work.timer = null
    this.queued.push(work)
    this.scheduleQueueFlush()
  }

  private scheduleQueueFlush(): void {
    if (this.queueTimer !== null || this.queueTask !== null) return

    const scheduler = globalThis.scheduler
    if (scheduler?.postTask) {
      // Timer nesting adds 4 ms to every slice of a large derived job.
      const task = new AbortController()
      this.queueTask = task
      void scheduler
        .postTask(() => this.flushQueuedWork(), {
          priority: 'user-visible',
          signal: task.signal,
        })
        .catch((error: unknown) => {
          if (!task.signal.aborted) globalThis.reportError(error)
        })
      return
    }

    this.queueTimer = globalThis.setTimeout(() => this.flushQueuedWork(), 0)
  }

  private flushQueuedWork(): void {
    this.queueTimer = null
    this.queueTask = null
    const work = this.takeNextQueuedWork()
    if (!work) return

    this.start(work)
    if (this.hasQueuedWork()) this.scheduleQueueFlush()
  }

  private takeNextQueuedWork(): ScheduledEditorWork | null {
    this.queued = this.queued.filter((work) => this.canStartQueuedWork(work))

    let bestIndex = -1
    let bestWork: ScheduledEditorWork | null = null
    for (const [index, work] of this.queued.entries()) {
      if (bestWork && compareQueuedWork(bestWork, work) <= 0) continue

      bestIndex = index
      bestWork = work
    }

    if (bestIndex === -1) return null

    this.queued.splice(bestIndex, 1)
    return bestWork
  }

  private hasQueuedWork(): boolean {
    return this.queued.some((work) => this.canStartQueuedWork(work))
  }

  private canStartQueuedWork(work: ScheduledEditorWork): boolean {
    if (work.startedAt !== null) return false
    if (work.controller.signal.aborted) return false
    return this.isCurrentWork(work)
  }

  private start(work: ScheduledEditorWork): void {
    if (!this.isCurrentWork(work)) return

    work.timer = null
    work.startedAt = this.now()
    const context = this.contextFor(work)
    if (!this.shouldRun(work, context)) {
      this.dropWork(work, 'stale-before-start')
      return
    }

    this.startBudgetTimer(work)
    this.emit(work, 'started')
    this.runWork(work, context)
  }

  private runWork(work: ScheduledEditorWork, context: EditorWorkContext): void {
    try {
      this.resolveRunResult(work, work.options.run(context))
    } catch (error) {
      this.failWork(work, error)
    }
  }

  private resolveRunResult(work: ScheduledEditorWork, result: unknown): void {
    if (!isPromiseLike(result)) {
      this.completeWork(work, result)
      return
    }

    void result.then(
      (value) => this.completeWork(work, value),
      (error) => this.failWork(work, error),
    )
  }

  private completeWork(work: ScheduledEditorWork, result: unknown): void {
    if (!this.isCurrentWork(work)) return

    const context = this.contextFor(work)
    this.clearBudgetTimer(work)
    this.scheduled.delete(work.key)
    if (!this.shouldRun(work, context)) {
      this.emit(work, 'dropped', { reason: 'stale-after-run' })
      return
    }

    this.applyWorkResult(work, result, context)
  }

  private applyWorkResult(
    work: ScheduledEditorWork,
    result: unknown,
    context: EditorWorkContext,
  ): void {
    try {
      work.options.apply?.(result as never, context)
      this.emit(work, 'completed', { elapsedMs: this.elapsedMs(work) })
    } catch (error) {
      work.options.fail?.(error, context)
      this.emit(work, 'failed', { elapsedMs: this.elapsedMs(work), error })
    }
  }

  private failWork(work: ScheduledEditorWork, error: unknown): void {
    if (!this.isCurrentWork(work)) return

    const context = this.contextFor(work)
    this.clearBudgetTimer(work)
    this.scheduled.delete(work.key)
    work.options.fail?.(error, context)
    this.emit(work, 'failed', { elapsedMs: this.elapsedMs(work), error })
  }

  private dropWork(work: ScheduledEditorWork, reason: string): void {
    this.clearTimerIfScheduled(work)
    this.clearBudgetTimer(work)
    this.scheduled.delete(work.key)
    this.emit(work, 'dropped', { reason })
  }

  private cancelWork(work: ScheduledEditorWork, reason: string): void {
    this.clearTimerIfScheduled(work)
    this.clearBudgetTimer(work)
    this.scheduled.delete(work.key)
    work.controller.abort(reason)
    work.options.cancel?.()
    this.emit(work, 'cancelled', { reason })
  }

  private startBudgetTimer(work: ScheduledEditorWork): void {
    const budgetMs = normalizeBudgetMs(work.options.budgetMs)
    if (budgetMs === null) return

    work.budgetTimer = globalThis.setTimeout(() => this.timeoutWork(work), budgetMs)
  }

  private timeoutWork(work: ScheduledEditorWork): void {
    if (!this.isCurrentWork(work)) return

    this.scheduled.delete(work.key)
    work.budgetTimer = null
    work.controller.abort('budget-timeout')
    work.options.cancel?.()
    this.emit(work, 'timed-out', { elapsedMs: this.elapsedMs(work), reason: 'budget-timeout' })
  }

  private clearTimerIfScheduled(work: ScheduledEditorWork): void {
    if (work.timer === null) return

    globalThis.clearTimeout(work.timer)
    work.timer = null
  }

  private clearQueueTimer(): void {
    this.queueTask?.abort()
    this.queueTask = null
    if (this.queueTimer === null) return

    globalThis.clearTimeout(this.queueTimer)
    this.queueTimer = null
  }

  private clearBudgetTimer(work: ScheduledEditorWork): void {
    if (work.budgetTimer === null) return

    globalThis.clearTimeout(work.budgetTimer)
    work.budgetTimer = null
  }

  private shouldRun(work: ScheduledEditorWork, context: EditorWorkContext): boolean {
    if (work.controller.signal.aborted) return false
    return work.options.isCurrent?.(work.tags, context) ?? true
  }

  private isCurrentWork(work: ScheduledEditorWork): boolean {
    if (this.disposed) return false
    return this.scheduled.get(work.key)?.token === work.token
  }

  private handleFor(work: ScheduledEditorWork): EditorScheduledWorkHandle {
    return {
      key: work.key,
      token: work.token,
      signal: work.controller.signal,
      cancel: () => this.cancelHandle(work),
      isActive: () => this.isCurrentWork(work),
    }
  }

  private cancelHandle(work: ScheduledEditorWork): void {
    if (!this.isCurrentWork(work)) return

    this.cancelWork(work, 'handle-cancelled')
  }

  private contextFor(work: ScheduledEditorWork): EditorWorkContext {
    return {
      key: work.key,
      token: work.token,
      taskClass: work.taskClass,
      priority: work.priority,
      tags: work.tags,
      signal: work.controller.signal,
      startedAt: work.startedAt ?? work.createdAt,
      isCurrent: () => this.isCurrentWork(work) && !work.controller.signal.aborted,
    }
  }

  private elapsedMs(work: ScheduledEditorWork): number {
    return this.now() - (work.startedAt ?? work.createdAt)
  }

  private emit(
    work: ScheduledEditorWork,
    type: EditorWorkEventType,
    details: Pick<EditorWorkEvent, 'elapsedMs' | 'error' | 'reason'> = {},
  ): void {
    this.onEvent?.({
      type,
      key: work.key,
      token: work.token,
      taskClass: work.taskClass,
      priority: work.priority,
      tags: work.tags,
      ...details,
    })
  }
}

function inactiveHandle(key: string): EditorScheduledWorkHandle {
  const controller = new AbortController()
  controller.abort('scheduler-disposed')
  return {
    key,
    token: -1,
    signal: controller.signal,
    cancel: () => undefined,
    isActive: () => false,
  }
}

function normalizeDelayMs(delayMs: number | undefined): number {
  if (!delayMs || delayMs <= 0) return 0
  return delayMs
}

function normalizeBudgetMs(budgetMs: number | undefined): number | null {
  if (!budgetMs || budgetMs <= 0) return null
  return budgetMs
}

function compareQueuedWork(left: ScheduledEditorWork, right: ScheduledEditorWork): number {
  const priorityDelta = PRIORITY_RANK[left.priority] - PRIORITY_RANK[right.priority]
  if (priorityDelta !== 0) return priorityDelta
  return left.token - right.token
}

function isPromiseLike(value: unknown): value is Promise<unknown> {
  if (!value) return false
  return typeof (value as Promise<unknown>).then === 'function'
}

function nowMs(): number {
  return globalThis.performance?.now() ?? Date.now()
}
