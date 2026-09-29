import { withDocumentSessionChangeTimings, type DocumentSessionChange } from '../documentSession'
import type { EditorViewContributionUpdateKind } from '../plugins'
import type { TextSnapshot } from '../documentTextSnapshot'
import { viewContributionKindForChange, type SessionChangeOptions } from './editorUtils'

type EditorOperationChange = {
  readonly change: DocumentSessionChange
  readonly totalName: string
  readonly totalStart: number
  readonly options: SessionChangeOptions
}

export type EditorOperationFlush = {
  readonly changes: readonly EditorOperationChange[]
  readonly latest: EditorOperationChange
  readonly contributionKind: EditorViewContributionUpdateKind
  readonly revealOffset: number | null
  readonly revealAffinity: SessionChangeOptions['revealAffinity']
  readonly revealBlock: SessionChangeOptions['revealBlock']
  readonly syncDomSelection: boolean
}

/**
 * What one mutating pass over the editor still owes the view when it finishes.
 *
 * Only the net result of a pass is ever on screen. The states a multi-change
 * pass walks through on the way — a command that edits and then moves the
 * caret, a plugin applying a refactor — would each force their own reflow and
 * show nobody anything, so the view work waits here until the pass is done.
 */
export class EditorOperation {
  private readonly changes: EditorOperationChange[] = []
  private readonly changeIndexes = new Map<TextSnapshot, number>()

  record(
    change: DocumentSessionChange,
    totalName: string,
    totalStart: number,
    options: SessionChangeOptions,
  ): void {
    if (change.kind !== 'selection' && change.kind !== 'synchronize' && change.kind !== 'none') {
      this.changeIndexes.set(change.textSnapshot, this.changes.length)
    }
    this.changes.push({ change, totalName, totalStart, options })
  }

  amend(
    change: DocumentSessionChange,
    totalName: string,
    totalStart: number,
    options: SessionChangeOptions,
  ): boolean {
    const index = this.changeIndexes.get(change.textSnapshot)
    if (index === undefined) return false
    const pending = this.changes[index]
    if (!pending) return false

    const timings = [
      ...change.timings,
      ...pending.change.timings.filter((timing) => !change.timings.includes(timing)),
    ]
    this.changes[index] = {
      change: withDocumentSessionChangeTimings(pending.change, timings),
      totalName,
      totalStart,
      options,
    }
    return true
  }

  flush(): EditorOperationFlush | null {
    const latest = this.changes.at(-1)
    if (!latest) return null

    let contributionKind: EditorViewContributionUpdateKind = 'selection'
    let revealOffset: number | null = null
    let revealAffinity: SessionChangeOptions['revealAffinity']
    let revealBlock: SessionChangeOptions['revealBlock']
    let syncDomSelection = false
    for (const { change, options } of this.changes) {
      if (options.revealOffset !== undefined) {
        revealOffset = options.revealOffset
        revealAffinity = options.revealAffinity
        revealBlock = options.revealBlock
      }
      if (options.syncDomSelection !== false) syncDomSelection = true
      if (viewContributionKindForChange(change) === 'content') contributionKind = 'content'
    }
    return {
      changes: this.changes,
      latest,
      contributionKind,
      revealOffset,
      revealAffinity,
      revealBlock,
      syncDomSelection,
    }
  }
}
