import type { TextSnapshot } from '../documentTextSnapshot'
import type { TextEditBatch } from '../textEditBatch'
import { IndentationFoldIndex, sameIndentationSnapshot } from './indentationFoldIndex'
import {
  editorPerformanceDiagnosticsEnabled,
  recordEditorPerformanceDiagnostic,
  traceEditorPerformanceTask,
} from './performanceDiagnostics'
import type { EditorSecondaryWorkScheduler } from './secondaryWorkScheduler'
import type { EditorSyntaxController } from './syntaxController'
import { nowMs } from './timing'

type FallbackFoldContext = {
  readonly snapshot: TextSnapshot
  readonly languageId: string | null
  readonly tabSize: number
  readonly documentId: string | null
  readonly documentVersion: number
  readonly selection: EditorSyntaxController['fallbackFoldSelection']
  readonly grammarProjectionSuppression: boolean
  readonly active: boolean
}

type FallbackFoldTrigger = 'attach' | 'edit' | 'prepared' | 'explicit-command'
type FallbackFoldJob = {
  readonly index: IndentationFoldIndex
  readonly context: FallbackFoldContext
  readonly trigger: FallbackFoldTrigger
  durationMs: number
}

type FallbackFoldControllerOptions = {
  readonly scheduler: EditorSecondaryWorkScheduler
  context(): FallbackFoldContext
  publish(index: IndentationFoldIndex | null): void
  changed(): void
  loggingEnabled(): boolean
  log(detail: Readonly<Record<string, unknown>>): void
}

const WORK_KEY = 'editor.fallbackFolds'
const SLICE = { maxRows: 1024, maxCodeUnits: 32768 }

export class EditorFallbackFoldController {
  private current: IndentationFoldIndex | null = null
  private job: FallbackFoldJob | null = null
  private trigger: FallbackFoldTrigger = 'attach'

  constructor(private readonly options: FallbackFoldControllerOptions) {}

  get index(): IndentationFoldIndex | null {
    return this.current
  }

  reset(): void {
    this.options.scheduler.cancel(WORK_KEY)
    this.cancelJob()
    this.current = null
    this.trigger = 'attach'
  }

  adopt(index: IndentationFoldIndex | null): void {
    this.reset()
    const context = this.options.context()
    if (!index || !selected(context) || !compatible(index, context)) return
    if (!index.ready) {
      this.job = { index, context, trigger: 'prepared', durationMs: 0 }
      this.schedule()
      return
    }
    this.current = index
    this.options.publish(index)
    this.report({ index, context, trigger: 'prepared', durationMs: 0 }, 'reused')
  }

  update(batch: TextEditBatch): void {
    const context = this.options.context()
    const previous = this.current
    this.cancelJob()
    this.current = null
    this.trigger = 'edit'
    if (!selected(context) || !previous) {
      this.options.publish(null)
      return
    }
    const index = new IndentationFoldIndex({
      snapshot: context.snapshot,
      languageId: context.languageId,
      tabSize: context.tabSize,
      previous,
      batch,
    })
    this.job = { index, context, trigger: 'edit', durationMs: 0 }
    if (!this.runSlice()) this.options.publish(null)
  }

  schedule(): void {
    const context = this.options.context()
    if (!selected(context)) {
      this.suppress(context)
      return
    }
    if (this.current && !compatible(this.current, context)) this.current = null
    this.options.publish(this.current)
    if (this.current) {
      this.options.scheduler.cancel(WORK_KEY)
      return
    }
    this.scheduleSlice(150, 400)
  }

  flush(): void {
    this.options.scheduler.cancel(WORK_KEY)
    const context = this.options.context()
    if (!selected(context)) {
      this.suppress(context)
      return
    }
    if (this.current && compatible(this.current, context)) {
      this.options.publish(this.current)
      return
    }
    this.ensureJob(context, 'explicit-command')
    const job = this.job
    if (!job) return
    const started = nowMs()
    job.index.complete()
    job.durationMs += nowMs() - started
    this.finish(job, 'explicit-command')
  }

  private scheduleSlice(delayMs: number, maxDelayMs?: number): void {
    const context = this.options.context()
    this.options.scheduler.schedule({
      key: WORK_KEY,
      delayMs,
      maxDelayMs,
      version: context.documentVersion,
      isCurrent: () => sameIndentationSnapshot(context.snapshot, this.options.context().snapshot),
      run: traceEditorPerformanceTask('editor.secondary.folds', () => this.runScheduledSlice()),
    })
  }

  private runScheduledSlice(): void {
    const context = this.options.context()
    if (!selected(context)) {
      this.suppress(context)
      return
    }
    if (this.current && compatible(this.current, context)) return
    this.ensureJob(context, this.trigger)
    if (!this.runSlice()) this.scheduleSlice(0)
  }

  private runSlice(): boolean {
    const job = this.job
    if (!job) return true
    const started = nowMs()
    const ready = job.index.step(SLICE)
    job.durationMs += nowMs() - started
    if (ready) this.finish(job)
    return ready
  }

  private ensureJob(context: FallbackFoldContext, trigger: FallbackFoldTrigger): void {
    if (this.job && compatible(this.job.index, context)) return
    this.cancelJob()
    this.job = {
      index: new IndentationFoldIndex({
        snapshot: context.snapshot,
        languageId: context.languageId,
        tabSize: context.tabSize,
      }),
      context,
      trigger,
      durationMs: 0,
    }
  }

  private finish(job: FallbackFoldJob, trigger = job.trigger): void {
    const context = this.options.context()
    if (this.job !== job || !selected(context) || !compatible(job.index, context)) {
      this.cancelJob()
      return
    }
    this.current = job.index
    this.job = null
    this.report(job, undefined, trigger)
    this.options.publish(job.index)
    this.options.changed()
  }

  private suppress(context: FallbackFoldContext): void {
    this.reset()
    this.options.publish(null)
    recordEditorPerformanceDiagnostic('editor.fallbackFolds.selection', () => ({
      ...context.selection,
      grammarProjectionSuppression: context.grammarProjectionSuppression,
      outcome: 'skipped',
    }))
  }

  private cancelJob(): void {
    if (this.job) {
      this.report(this.job, 'cancelled')
      this.job.index.cancel()
    }
    this.job = null
  }

  private report(
    job: FallbackFoldJob,
    outcome?: 'cancelled' | 'reused',
    trigger = job.trigger,
  ): void {
    const loggingEnabled = this.options.loggingEnabled()
    if (!loggingEnabled && !editorPerformanceDiagnosticsEnabled()) return

    const work = job.index.diagnostics
    const detail = {
      ...job.context.selection,
      ...work,
      counterScope: 'index-generation',
      generationDurationMs: work.durationMs,
      documentId: job.context.documentId,
      documentVersion: job.context.documentVersion,
      languageId: job.context.languageId,
      tabSize: job.context.tabSize,
      grammarProjectionSuppression: job.context.grammarProjectionSuppression,
      trigger,
      outcome: outcome ?? (work.outcome === 'reused' ? 'reused' : 'completed'),
      durationMs: job.durationMs,
      durationScope: 'controller-index-work',
      materializations: 0,
    }
    recordEditorPerformanceDiagnostic('editor.fallbackFoldRanges', detail)
    if (loggingEnabled) this.options.log(detail)
  }
}

function selected(context: FallbackFoldContext): boolean {
  return (
    context.active && context.selection.reason !== null && !context.grammarProjectionSuppression
  )
}

function compatible(index: IndentationFoldIndex, context: FallbackFoldContext): boolean {
  return (
    sameIndentationSnapshot(index.snapshot, context.snapshot) &&
    index.languageId === context.languageId &&
    index.tabSize === context.tabSize
  )
}
