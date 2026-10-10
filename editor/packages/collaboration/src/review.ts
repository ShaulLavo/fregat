import {
  ConfirmedWindow,
  TextbufferEngine,
  type TextbufferSnapshot,
  type ConcurrentEdit,
} from '@singapore-editor/collab'
import {
  charIdAt,
  locateCharId,
  diffPieceTableSnapshots,
  readPieceTableTextRange,
  type PieceTableSnapshot,
  type PieceTableEdit,
} from '@singapore-editor/textbuffer'
import {
  MergeReviewDetector,
  type MergeReviewMark,
  type MergeReviewSyntax,
  type MergeReviewUnit,
} from './merge-review'
import type { CollaborationDocument } from './document'
import type { Checkpoint } from './protocol'

export type MergeReviewVersions = {
  readonly base: string
  readonly authors: readonly { readonly author: string; readonly text: string }[]
}
export type MergeReviewAction = { readonly label: string; readonly run: () => void | Promise<void> }
export type MergeReviewOptions = {
  readonly syntax: MergeReviewSyntax & { readonly release?: () => Promise<void> }
  readonly onMergeReview?: (
    unit: MergeReviewUnit,
    versions: MergeReviewVersions,
  ) => readonly MergeReviewAction[]
  readonly onError?: (error: unknown) => void
}

function scheduleTask(run: () => void): () => void {
  const channel = new MessageChannel()
  channel.port1.onmessage = () => {
    channel.port1.close()
    channel.port2.close()
    run()
  }
  channel.port2.postMessage(null)
  return () => {
    channel.port1.close()
    channel.port2.close()
  }
}

/** Confirmed review state and local dismissals, independent of an editor's pending text. */
export class MergeReview {
  private window = new ConfirmedWindow()
  private tip: Checkpoint
  private snapshot: TextbufferSnapshot
  private revision = 0
  private publishedRevision = -1
  private allMarks: readonly MergeReviewMark[] = []
  private readonly dismissed = new Map<string, MergeReviewMark['edits']>()
  private readonly listeners = new Set<() => void>()
  private readonly detector: MergeReviewDetector
  private readonly unsubscribe: () => void
  private queued: (() => void) | undefined
  private running: Promise<void> | undefined
  private requested = false
  private disposed = false
  private readonly waiters = new Set<() => void>()

  constructor(
    private readonly document: CollaborationDocument,
    readonly peer: string,
    readonly options: MergeReviewOptions,
    private readonly apply: (edit: PieceTableEdit) => void,
    private readonly schedule = scheduleTask,
  ) {
    this.detector = new MergeReviewDetector(options.syntax)
    this.tip = document.genesis
    this.snapshot = document.confirmedSnapshot()
    this.unsubscribe = document.subscribeConfirmed((reset, remote) => this.confirmed(reset, remote))
    this.confirmed(false, true)
  }

  get marks(): readonly MergeReviewMark[] {
    return this.allMarks.filter((mark) => !this.dismissed.has(this.dismissalKey(mark)))
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private confirmed(reset: boolean, remote: boolean): void {
    if (this.disposed) return
    if (reset) {
      this.requested = false
      this.window = new ConfirmedWindow()
      this.tip = this.document.genesis
    }
    const records = this.document.exportHistory(this.tip) ?? []
    if (!records.length && !reset) return
    const accepted = records.filter((record) => record.outcome.kind === 'accepted')
    this.tip = this.document.checkpoint()
    if (!accepted.length && !reset) return
    this.window.append(accepted.map((record) => record.edit))
    const retained = new Set(this.window.edits.map((edit) => JSON.stringify(edit.envelope.id)))
    for (const [key, edits] of this.dismissed)
      if (edits.some((id) => !retained.has(JSON.stringify(id)))) this.dismissed.delete(key)
    this.snapshot = this.document.confirmedSnapshot()
    this.revision++
    this.allMarks = []
    this.changed()
    if (remote && accepted.some((record) => record.id.actor !== this.peer)) this.requested = true
    // Remote delivery can precede our concurrent acknowledgement, even in a multi-author history.
    if (this.document.participant.state().pending.length) return
    if (new Set(this.window.edits.map((edit) => edit.envelope.id.actor)).size < 2) {
      this.requested = false
      return
    }
    if (!this.requested) return
    if (this.queued || this.running) return
    this.queue()
  }

  private queue(): void {
    this.queued = this.schedule(() => {
      this.queued = undefined
      if (!this.requested || this.disposed) return this.settled()
      if (this.document.participant.state().pending.length) return this.settled()
      this.requested = false
      const revision = this.revision
      const snapshot = this.snapshot
      this.running = this.detector
        .detect(this.window, snapshot)
        .then((result) => {
          if (this.disposed || revision !== this.revision) return
          this.publishedRevision = revision
          this.allMarks =
            result.status === 'complete' ? this.unsuperseded(result.marks, snapshot) : []
          this.changed()
        })
        .catch((error: unknown) => {
          if (!this.disposed) this.options.onError?.(error)
        })
        .finally(async () => {
          try {
            await this.options.syntax.release?.()
          } catch (error: unknown) {
            if (!this.disposed) this.options.onError?.(error)
          } finally {
            this.running = undefined
            if (!this.disposed && this.requested) this.queue()
            this.settled()
          }
        })
    })
  }

  private unsuperseded(
    marks: readonly MergeReviewMark[],
    snapshot: TextbufferSnapshot,
  ): readonly MergeReviewMark[] {
    if (!marks.length) return marks
    const engine = new TextbufferEngine()
    engine.restore(snapshot)
    return marks.flatMap((mark) => {
      // A causal follow-up in this unit replaces the old competing alternatives on every peer.
      const pairs = mark.pairs.filter(
        (pair) =>
          !this.window
            .editsAfter(pair)
            .some(
              (edit) =>
                engine.effectActive(edit.envelope.id) &&
                touchesUnit(snapshot.buffer, edit, mark.unit),
            ),
      )
      if (!pairs.length) return []
      const ids = new Map(pairs.flat().map((id) => [JSON.stringify(id), id]))
      return [
        {
          ...mark,
          pairs,
          edits: [...ids.values()],
          authors: [...new Set([...ids.values()].map((id) => id.actor))].sort(),
        },
      ]
    })
  }

  async idle(): Promise<void> {
    if (!this.queued && !this.running) return
    await new Promise<void>((resolve) => this.waiters.add(resolve))
  }

  private settled(): void {
    if (this.queued || this.running) return
    for (const resolve of this.waiters) resolve()
    this.waiters.clear()
  }

  dismiss(mark: MergeReviewMark): void {
    if (!this.current(mark)) return
    this.dismissed.set(this.dismissalKey(mark), mark.edits)
    this.changed()
  }

  private dismissalKey(mark: MergeReviewMark): string {
    return JSON.stringify([mark.unitId, mark.edits])
  }

  private current(mark: MergeReviewMark): boolean {
    return (
      !this.disposed &&
      this.publishedRevision === this.revision &&
      this.allMarks.includes(mark) &&
      !this.dismissed.has(this.dismissalKey(mark)) &&
      this.document.participant.state().pending.length === 0
    )
  }

  versions(mark: MergeReviewMark): MergeReviewVersions | null {
    if (!this.current(mark)) return null
    const engine = new TextbufferEngine()
    engine.restore(this.snapshot)
    const text = (keep?: string) => {
      const projected = engine.projectEffects(
        mark.edits.filter((id) => id.actor !== keep).map((op) => ({ op, active: false })),
      ).buffer
      const range = projectUnit(this.snapshot.buffer, projected, mark.unit)
      return readPieceTableTextRange(projected, range.startIndex, range.endIndex)
    }
    return { base: text(), authors: mark.authors.map((author) => ({ author, text: text(author) })) }
  }

  private resolution(mark: MergeReviewMark, author: string): PieceTableEdit | null {
    if (!this.current(mark) || !mark.authors.includes(author)) return null
    const engine = new TextbufferEngine()
    engine.restore(this.snapshot)
    const removed = mark.edits.filter((id) => id.actor !== author)
    const edits = this.window.edits.filter((edit) =>
      removed.some((id) => id.actor === edit.envelope.id.actor && id.seq === edit.envelope.id.seq),
    )
    if (edits.length !== removed.length) return null
    // A hidden span at an edge might belong to the adjacent unit. Keep it for manual review.
    const inside = (spans: (typeof edits)[number]['inserted']) =>
      spans.every((span) => {
        for (
          let counter = span.start.counter;
          counter < span.start.counter + span.count;
          counter++
        ) {
          const location = locateCharId(this.snapshot.buffer, { bunch: span.start.bunch, counter })
          if (!location) return false
          if (location.offset < mark.unit.startIndex || location.offset > mark.unit.endIndex)
            return false
          if (location.liveness === 'live' && location.offset === mark.unit.endIndex) return false
          if (
            location.liveness !== 'live' &&
            (location.offset === mark.unit.startIndex || location.offset === mark.unit.endIndex)
          )
            return false
        }
        return true
      })
    if (edits.some((edit) => !inside(edit.inserted) || !inside(edit.deleted))) return null
    const projected = engine.projectEffects(removed.map((op) => ({ op, active: false }))).buffer
    const edit = diffPieceTableSnapshots(this.snapshot.buffer, projected)
    return edit && edit.from >= mark.unit.startIndex && edit.to <= mark.unit.endIndex ? edit : null
  }

  canResolve(mark: MergeReviewMark, author: string): boolean {
    return this.resolution(mark, author) !== null
  }

  resolve(mark: MergeReviewMark, author: string): boolean {
    const edit = this.resolution(mark, author)
    if (!edit) return false
    this.dismiss(mark)
    this.apply(edit)
    return true
  }

  jumpOffset(mark: MergeReviewMark): number | null {
    if (!this.current(mark)) return null
    const edits = this.window.edits.filter((edit) =>
      mark.edits.some(
        (id) => id.actor === edit.envelope.id.actor && id.seq === edit.envelope.id.seq,
      ),
    )
    for (const edit of edits) {
      for (const span of edit.inserted.concat(edit.deleted)) {
        const snapshot = this.document.engine.snapshot().buffer
        const first = locateCharId(snapshot, span.start)
        const last = locateCharId(snapshot, {
          bunch: span.start.bunch,
          counter: span.start.counter + span.count - 1,
        })
        const outside = [first, last].find(
          (location) =>
            location &&
            (location.offset < mark.unit.startIndex || location.offset >= mark.unit.endIndex),
        )
        if (outside) return outside.offset
      }
    }
    return this.range(mark).startIndex
  }

  range(mark: MergeReviewMark): MergeReviewUnit {
    return {
      ...mark.unit,
      ...projectUnit(this.snapshot.buffer, this.document.engine.snapshot().buffer, mark.unit),
    }
  }

  private changed(): void {
    for (const listener of this.listeners) listener()
  }

  dispose(): void {
    this.disposed = true
    this.queued?.()
    this.queued = undefined
    this.unsubscribe()
    this.listeners.clear()
    this.allMarks = []
    this.dismissed.clear()
    this.settled()
  }
}

function projectUnit(
  current: PieceTableSnapshot,
  projected: PieceTableSnapshot,
  unit: MergeReviewUnit,
) {
  const left = unit.startIndex ? charIdAt(current, unit.startIndex - 1) : null
  const right = unit.endIndex < current.length ? charIdAt(current, unit.endIndex) : null
  const start = left ? locateCharId(projected, left) : null
  const end = right ? locateCharId(projected, right) : null
  const startIndex = start ? start.offset + Number(start.liveness === 'live') : 0
  return { startIndex, endIndex: Math.max(startIndex, end?.offset ?? projected.length) }
}

function touchesUnit(
  snapshot: PieceTableSnapshot,
  edit: ConcurrentEdit,
  unit: MergeReviewUnit,
): boolean {
  for (const span of edit.inserted.concat(edit.deleted)) {
    const first = locateCharId(snapshot, span.start)
    const last = locateCharId(snapshot, {
      bunch: span.start.bunch,
      counter: span.start.counter + span.count - 1,
    })
    if (!first || !last) continue
    if (
      Math.min(first.offset, last.offset) < unit.endIndex &&
      Math.max(first.offset, last.offset) >= unit.startIndex
    )
      return true
  }
  return false
}
