import {
  EditorWorkScheduler,
  type EditorScheduledWorkHandle,
  type EditorWorkPriority,
  type EditorWorkTags,
  type EditorWorkTaskClass,
} from './workScheduler'

export type LatestAsyncRequestOptions<T> = {
  readonly delayMs?: number
  readonly maxDelayMs?: number
  readonly budgetMs?: number
  readonly taskClass?: EditorWorkTaskClass
  readonly priority?: EditorWorkPriority
  readonly tags?: EditorWorkTags
  readonly run: () => Promise<T>
  readonly apply: (result: T, startedAt: number) => void
  readonly fail?: (error: unknown, startedAt: number) => void
}

export type LatestAsyncRequestControllerOptions = {
  readonly key?: string
  readonly taskClass?: EditorWorkTaskClass
  readonly scheduler?: EditorWorkScheduler
}

export class LatestAsyncRequest<T> {
  private readonly key: string
  private readonly taskClass: EditorWorkTaskClass
  private readonly scheduler: EditorWorkScheduler
  private readonly ownsScheduler: boolean
  private handle: EditorScheduledWorkHandle | null = null
  private disposed = false

  constructor(options: LatestAsyncRequestControllerOptions = {}) {
    this.key = options.key ?? 'editor.latestAsyncRequest'
    this.taskClass = options.taskClass ?? 'background-derived'
    this.scheduler = options.scheduler ?? new EditorWorkScheduler()
    this.ownsScheduler = !options.scheduler
  }

  public isActive(): boolean {
    return this.handle?.isActive() ?? false
  }

  public schedule(options: LatestAsyncRequestOptions<T>): void {
    if (this.disposed) return

    // No explicit cancel first: scheduling the same key already replaces the
    // pending work, and cancelling would drop the burst deadline that
    // maxDelayMs relies on.
    this.handle = this.scheduler.schedule({
      key: this.key,
      taskClass: options.taskClass ?? this.taskClass,
      priority: options.priority,
      delayMs: normalizeDelay(options.delayMs),
      maxDelayMs: normalizeDelay(options.maxDelayMs),
      budgetMs: options.budgetMs,
      tags: options.tags,
      run: options.run,
      apply: (result, context) =>
        this.apply(result as T, options, context.token, context.startedAt),
      fail: (error, context) => this.fail(error, options, context.token, context.startedAt),
    })
  }

  public cancel(): void {
    this.handle?.cancel()
    this.handle = null
  }

  public dispose(): void {
    this.disposed = true
    this.cancel()
    if (this.ownsScheduler) this.scheduler.dispose()
  }

  private apply(
    result: T,
    options: LatestAsyncRequestOptions<T>,
    token: number,
    startedAt: number,
  ) {
    this.clearHandle(token)
    options.apply(result, startedAt)
  }

  private fail(
    error: unknown,
    options: LatestAsyncRequestOptions<T>,
    token: number,
    startedAt: number,
  ): void {
    this.clearHandle(token)
    options.fail?.(error, startedAt)
  }

  private clearHandle(token: number): void {
    if (this.handle?.token !== token) return

    this.handle = null
  }
}

const normalizeDelay = (delayMs: number | undefined): number => {
  if (!delayMs || delayMs <= 0) return 0
  return delayMs
}
