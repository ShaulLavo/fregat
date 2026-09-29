import { EditorWorkScheduler } from './workScheduler'

export type EditorSecondaryWorkOptions = {
  readonly key: string
  readonly delayMs?: number
  readonly maxDelayMs?: number
  readonly version?: number
  isCurrent?(version: number): boolean
  run(): void
}

type ScheduledSecondaryWork = {
  readonly token: number
  cancel(): void
}

export class EditorSecondaryWorkScheduler {
  private readonly scheduler = new EditorWorkScheduler()
  private readonly scheduled = new Map<string, ScheduledSecondaryWork>()
  private nextVersion = 0
  private disposed = false

  schedule(options: EditorSecondaryWorkOptions): void {
    if (this.disposed) return

    // Deliberately not cancelling first: the underlying scheduler replaces by
    // key and carries the burst's original deadline across the replacement,
    // which is what maxDelayMs is measured from. Cancelling here would reset it
    // on every keystroke.
    const version = options.version ?? this.nextWorkVersion()
    const handle = this.scheduler.schedule({
      key: options.key,
      taskClass: 'background-derived',
      delayMs: normalizeDelayMs(options.delayMs),
      maxDelayMs: normalizeDelayMs(options.maxDelayMs),
      defer: true,
      tags: { version },
      isCurrent: (tags) => options.isCurrent?.(tags.version ?? version) ?? true,
      run: options.run,
      apply: (_result, context) => this.clearScheduledHandle(options.key, context.token),
      fail: (_error, context) => this.clearScheduledHandle(options.key, context.token),
    })
    this.scheduled.set(options.key, handle)
  }

  cancel(key: string): void {
    const scheduled = this.scheduled.get(key)
    if (!scheduled) return

    this.scheduled.delete(key)
    scheduled.cancel()
  }

  has(key: string): boolean {
    return this.scheduled.has(key)
  }

  dispose(): void {
    if (this.disposed) return

    this.disposed = true
    for (const key of this.scheduled.keys()) this.cancel(key)
    this.scheduler.dispose()
  }

  private clearScheduledHandle(key: string, token: number): void {
    const scheduled = this.scheduled.get(key)
    if (!scheduled || scheduled.token !== token) return

    this.scheduled.delete(key)
  }

  private nextWorkVersion(): number {
    this.nextVersion += 1
    return this.nextVersion
  }
}

function normalizeDelayMs(delayMs: number | undefined): number {
  if (!delayMs || delayMs <= 0) return 0
  return delayMs
}
