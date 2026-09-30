import { getPieceTreeSnapshot, type TextSnapshot } from '../documentTextSnapshot'
import type { FoldRange } from '../syntax/session'
import type { TextEditBatch } from '../textEditBatch'
import { indentationFoldingRules, type EditorFoldingRules } from './languageConfiguration'
import {
  FOLD_FACT_BLOCK_SIZE,
  FoldFactReader,
  createFoldFactBlock,
  foldLineReference,
  sameFoldFacts,
  sliceFoldFactBlock,
  type FoldFactBlock,
  type FoldLineFact,
  type FoldLineOwner,
  type FoldLineReference,
} from './indentationFoldFacts'
import {
  FoldBlockTreeBuilder,
  locateFoldBlock,
  maximumFoldLine,
  sameAcceptedStack,
  sameIndentationStack,
  stackNode,
  unanalyzedBlock,
  updateFoldBlockTree,
  type AcceptedStack,
  type FoldBlockTree,
  type IndentationBlock,
  type IndentationRegion,
  type IndentationStack,
} from './indentationFoldStructure'

export type IndentationFoldIndexOptions = {
  readonly snapshot: TextSnapshot
  readonly languageId: string | null
  readonly tabSize: number
  readonly previous?: IndentationFoldIndex
  readonly batch?: TextEditBatch
}
export type IndentationFoldWork = {
  readonly snapshotIdentity: number
  readonly configurationIdentity: string
  readonly maxSliceMs: number
  readonly metadataSteps: number
  readonly maxMetadataStepsPerSlice: number
  readonly stackSteps: number
  readonly maxStackStepsPerSlice: number
  readonly retainedBytesEstimated: true
  readonly rowsRead: number
  readonly codeUnitsRead: number
  readonly factBlocksRebuilt: number
  readonly factBlocksReused: number
  readonly propagationRows: number
  readonly foldCount: number
  readonly materializations: 0
  readonly retainedBytes: number
  readonly durationMs: number
  readonly outcome: 'pending' | 'completed' | 'reused' | 'cancelled'
  readonly coldReason: 'initial' | 'configuration' | 'edit-chain-gap' | null
}
type ReadTask = {
  readonly beforeStart: number
  beforeEnd: number
  readonly afterStart: number
  afterEnd: number
  row: number
  started: boolean
  installedRows: number
  replacements: Iterator<FoldLineFact> | null
  readonly blocks: IndentationBlock[]
  pending: FoldLineFact[]
}
type OwnerLocation = { readonly index: number; readonly first: number; readonly end: number }
type FoldMetadataWork =
  | {
      readonly kind: 'tree'
      readonly builder: FoldBlockTreeBuilder
      readonly resume: 'task' | 'bottom'
    }
  | {
      readonly kind: 'directory'
      index: number
      readonly directory: Map<FoldLineOwner, OwnerLocation[]>
    }
type LinePosition = { readonly row: number; readonly end: number }
const snapshotIdentities = new WeakMap<object, number>()
const ruleIdentities = new WeakMap<object, number>()
let identitySequence = 0
function identityOf(value: object, identities: WeakMap<object, number>): number {
  const existing = identities.get(value)
  if (existing !== undefined) return existing
  const identity = ++identitySequence
  identities.set(value, identity)
  return identity
}

const EOF_OWNER: FoldLineOwner = { id: 0 }
const EOF_LINE: FoldLineReference = { owner: EOF_OWNER, slot: 0 }
const EMPTY_STACK = stackNode(-1, EOF_LINE, EOF_LINE, null)

export function sameIndentationSnapshot(left: TextSnapshot, right: TextSnapshot): boolean {
  if (left === right) return true
  const leftTree = getPieceTreeSnapshot(left)
  return leftTree !== null && leftTree === getPieceTreeSnapshot(right)
}

/** Immutable once ready; a generation publishes only after both semantic checkpoint passes finish. */
export class IndentationFoldIndex {
  readonly snapshot: TextSnapshot
  readonly languageId: string | null
  readonly tabSize: number
  readonly rules: EditorFoldingRules
  private blocks: IndentationBlock[] = []
  private tree: FoldBlockTree | null = null
  private directory = new Map<FoldLineOwner, readonly OwnerLocation[]>()
  private reader: FoldFactReader | null = null
  private tasks: ReadTask[] = []
  private taskIndex = 0
  private phase: 'facts' | 'bottom' | 'accept' | 'ready' | 'cancelled' = 'facts'
  private bottomIndex = -1
  private dirtyFirst = Infinity
  private dirtyLast = -1
  private candidateFirst = Infinity
  private candidateLast = -1
  private bottom: IndentationStack = EMPTY_STACK
  private acceptIndex = 0
  private accepted: AcceptedStack | null = null
  private topologyChanged = false
  private directoryChanged = false
  private reused = false
  private allCache: readonly FoldRange[] | null = null
  private rowsRead = 0
  private codeUnitsRead = 0
  private rebuilt = 0
  private propagation = 0
  private elapsed = 0
  private maxSliceMs = 0
  private processedBlocks = 0
  private metadata: FoldMetadataWork | null = null
  private metadataSteps = 0
  private maxMetadataStepsPerSlice = 0
  private semanticWork: Generator<void, void> | null = null
  private stackSteps = 0
  private maxStackStepsPerSlice = 0
  private coldReason: IndentationFoldWork['coldReason'] = null

  constructor(options: IndentationFoldIndexOptions) {
    this.snapshot = options.snapshot
    this.languageId = options.languageId
    this.tabSize = options.tabSize
    this.rules = indentationFoldingRules(options.languageId)
    const previous = options.previous
    if (!previous?.ready) {
      this.cold('initial')
      return
    }
    if (!this.compatible(previous)) {
      this.cold('configuration')
      return
    }
    if (sameIndentationSnapshot(previous.snapshot, this.snapshot)) {
      this.adopt(previous)
      this.phase = 'ready'
      this.reused = true
      return
    }
    const batch = options.batch
    if (
      !batch ||
      !sameIndentationSnapshot(previous.snapshot, batch.before) ||
      !sameIndentationSnapshot(this.snapshot, batch.after)
    ) {
      this.cold('edit-chain-gap')
      return
    }
    this.adopt(previous)
    this.tasks = readTasks(batch)
    if (this.tasks.length === 0) {
      this.phase = 'ready'
      this.reused = true
    }
  }

  get ready(): boolean {
    return this.phase === 'ready'
  }
  get count(): number {
    return this.ready ? (this.tree?.count ?? 0) : 0
  }
  get diagnostics(): IndentationFoldWork {
    const outcome = this.phase === 'cancelled' ? 'cancelled' : this.outcome()
    return {
      snapshotIdentity: identityOf(
        getPieceTreeSnapshot(this.snapshot) ?? this.snapshot,
        snapshotIdentities,
      ),
      configurationIdentity: `${identityOf(this.rules, ruleIdentities)}:${this.languageId ?? ''}:${this.tabSize}`,
      maxSliceMs: this.maxSliceMs,
      metadataSteps: this.metadataSteps,
      maxMetadataStepsPerSlice: this.maxMetadataStepsPerSlice,
      stackSteps: this.stackSteps,
      maxStackStepsPerSlice: this.maxStackStepsPerSlice,
      retainedBytesEstimated: true,
      rowsRead: this.rowsRead,
      codeUnitsRead: this.codeUnitsRead,
      factBlocksRebuilt: this.rebuilt,
      factBlocksReused: Math.max(0, this.blocks.length - this.rebuilt),
      propagationRows: this.propagation,
      foldCount: this.count,
      materializations: 0,
      retainedBytes: this.snapshot.lineCount * 40 + this.blocks.length * 256 + this.count * 80,
      durationMs: this.elapsed,
      outcome,
      coldReason: this.coldReason,
    }
  }

  step(
    budget: {
      readonly maxRows?: number
      readonly maxCodeUnits?: number
      readonly maxBlocks?: number
      readonly maxStackSteps?: number
    } = {},
  ): boolean {
    if (this.ready || this.phase === 'cancelled') return this.ready
    const started = performance.now()
    const metadataStart = this.metadataSteps
    const stackStart = this.stackSteps
    const stackEnd = stackStart + Math.max(1, budget.maxStackSteps ?? budget.maxRows ?? 1024)
    const metadataEnd = metadataStart + Math.max(1, budget.maxBlocks ?? budget.maxRows ?? 1024)
    const rowEnd = this.rowsRead + this.propagation + (budget.maxRows ?? 1024)
    const unitEnd = this.codeUnitsRead + (budget.maxCodeUnits ?? 32768)
    const blockEnd =
      this.processedBlocks + Math.max(1, Math.ceil((budget.maxRows ?? 1024) / FOLD_FACT_BLOCK_SIZE))
    while (
      !this.ready &&
      this.rowsRead + this.propagation < rowEnd &&
      this.codeUnitsRead < unitEnd &&
      this.processedBlocks < blockEnd &&
      this.metadataSteps < metadataEnd &&
      this.stackSteps < stackEnd
    ) {
      this.advance(unitEnd - this.codeUnitsRead)
    }
    const duration = performance.now() - started
    this.elapsed += duration
    this.maxSliceMs = Math.max(this.maxSliceMs, duration)
    this.maxMetadataStepsPerSlice = Math.max(
      this.maxMetadataStepsPerSlice,
      this.metadataSteps - metadataStart,
    )
    this.maxStackStepsPerSlice = Math.max(this.maxStackStepsPerSlice, this.stackSteps - stackStart)
    return this.ready
  }

  complete(): this {
    while (!this.ready && this.phase !== 'cancelled')
      this.step({ maxRows: 65536, maxCodeUnits: 1_048_576 })
    return this
  }

  cancel(): void {
    if (this.ready) return
    this.phase = 'cancelled'
    this.metadata = null
    this.semanticWork = null
    this.reader = null
    this.tasks = []
    this.blocks = []
    this.tree = null
    this.directory = new Map()
  }

  ranges(startRow: number, endRow: number): readonly FoldRange[] {
    if (!this.ready || !this.tree) return []
    const ranges: FoldRange[] = []
    this.collect(this.tree, 0, startRow, endRow, ranges)
    return ranges
  }

  headers(startRow: number, endRow: number): readonly FoldRange[] {
    if (!this.ready || !this.tree || startRow > endRow) return []
    const first = locateFoldBlock(this.tree, Math.max(0, startRow), 'row')
    const last = locateFoldBlock(this.tree, Math.min(this.snapshot.lineCount - 1, endRow), 'row')
    const result: FoldRange[] = []
    for (let index = first.index; index <= last.index; index += 1)
      this.collectHeaders(this.blocks[index]!, startRow, endRow, result)
    return result
  }

  private collectHeaders(
    block: IndentationBlock,
    start: number,
    end: number,
    result: FoldRange[],
  ): void {
    for (const fold of block.accepted) {
      const row = this.position(fold.start).row
      if (row < start || row > end) continue
      result.push(this.range(fold))
    }
  }

  ancestors(row: number): readonly FoldRange[] {
    return this.ranges(row, row)
  }

  all(): readonly FoldRange[] {
    this.complete()
    if (this.allCache) return this.allCache
    const result: FoldRange[] = []
    this.forEach((fold) => result.push(fold))
    this.allCache = result
    return result
  }

  forEach(visit: (fold: FoldRange) => void): void {
    this.complete()
    if (!this.ready) return
    for (const block of this.blocks) {
      for (const fold of block.accepted) visit(this.range(fold))
    }
  }

  private outcome(): IndentationFoldWork['outcome'] {
    if (!this.ready) return 'pending'
    return this.reused ? 'reused' : 'completed'
  }

  private compatible(previous: IndentationFoldIndex): boolean {
    return (
      this.languageId === previous.languageId &&
      this.tabSize === previous.tabSize &&
      this.rules === previous.rules
    )
  }

  private cold(reason: IndentationFoldWork['coldReason']): void {
    this.coldReason = reason
    this.topologyChanged = true
    this.tasks = [
      {
        beforeStart: 0,
        beforeEnd: 0,
        afterStart: 0,
        afterEnd: this.snapshot.lineCount,
        row: 0,
        started: false,
        installedRows: 0,
        replacements: null,
        blocks: [],
        pending: [],
      },
    ]
  }

  private adopt(previous: IndentationFoldIndex): void {
    this.blocks = previous.blocks.slice()
    this.tree = previous.tree
    this.directory = previous.directory
  }

  private advance(codeUnits: number): void {
    if (this.semanticWork) return this.advanceSemanticWork()
    if (this.metadata) return this.advanceMetadata(this.metadata)
    if (this.phase === 'facts') return this.read(codeUnits)
    if (this.phase === 'bottom') this.semanticWork = this.analyzeBottom()
    if (this.phase === 'accept') this.semanticWork = this.acceptBlock()
    this.advanceSemanticWork()
  }

  private advanceSemanticWork(): void {
    const work = this.semanticWork
    if (!work) return
    if (!work.next().done) {
      this.stackSteps += 1
      return
    }
    this.semanticWork = null
    this.processedBlocks += 1
  }

  private read(codeUnits: number): void {
    const task = this.tasks[this.taskIndex]
    if (!task) {
      this.finishFacts()
      return
    }
    if (task.row === task.afterEnd) {
      if (this.installTask(task)) this.taskIndex += 1
      return
    }
    this.reader ??= new FoldFactReader(this.snapshot, this.rules, this.tabSize)
    if (!task.started) {
      this.reader.seek(this.snapshot.lineStart(task.afterStart))
      task.started = true
    }
    const before = this.reader.codeUnitsRead
    const fact = this.reader.next(codeUnits)
    this.codeUnitsRead += this.reader.codeUnitsRead - before
    if (!fact) return
    this.rowsRead += 1
    task.pending.push(fact)
    task.row += 1
    if (task.pending.length === FOLD_FACT_BLOCK_SIZE || task.row === task.afterEnd) {
      task.blocks.push(unanalyzedBlock(createFoldFactBlock(task.pending)))
      task.pending = []
    }
    if (task.row !== task.afterEnd) return
    if (this.installTask(task)) this.taskIndex += 1
  }

  private installTask(task: ReadTask): boolean {
    const oldCount = task.beforeEnd - task.beforeStart
    const newCount = task.afterEnd - task.afterStart
    if (oldCount === newCount && this.tree) {
      return this.replaceSameRows(task)
    }
    const prefix = this.sliceBlocks(0, task.afterStart)
    const total = this.tree?.rows ?? 0
    const suffix = this.sliceBlocks(task.afterStart + oldCount, total)
    this.blocks = prefix.concat(task.blocks, suffix)
    this.rebuilt += task.blocks.length
    this.topologyChanged = true
    this.directoryChanged = true
    this.metadata = {
      kind: 'tree',
      builder: new FoldBlockTreeBuilder(this.blocks, () => -1),
      resume: 'task',
    }
    return false
  }

  private replaceSameRows(task: ReadTask): boolean {
    task.replacements ??= taskFacts(task)
    const targetRow = task.afterStart + task.installedRows
    const location = locateFoldBlock(this.tree!, targetRow, 'row')
    const count = Math.min(
      task.afterEnd - targetRow,
      location.block.facts.facts.length - (targetRow - location.row),
    )
    this.replaceFacts(location.index, targetRow - location.row, count, task.replacements)
    task.installedRows += count
    this.processedBlocks += 1
    return task.afterStart + task.installedRows === task.afterEnd
  }

  private replaceFacts(
    blockIndex: number,
    start: number,
    count: number,
    replacements: Iterator<FoldLineFact>,
  ): void {
    const old = this.blocks[blockIndex]!
    const facts = old.facts.facts.slice()
    let semanticChange = false
    for (let index = start; index < start + count; index += 1) {
      const fact = replacements.next().value!
      semanticChange ||= !sameFoldFacts(facts[index]!, fact)
      facts[index] = fact
    }
    const nextFacts = createFoldFactBlock(facts, old.facts.owner, old.facts.startSlot)
    const next = { ...old, facts: nextFacts, analyzed: old.analyzed && !semanticChange }
    this.blocks[blockIndex] = next
    this.tree = updateFoldBlockTree(this.tree!, blockIndex, next, (left, right) =>
      this.compareLines(left, right),
    )
    this.topologyChanged ||= semanticChange
    if (semanticChange) this.noteDirty(blockIndex)
    this.rebuilt += 1
  }

  private sliceBlocks(start: number, end: number): IndentationBlock[] {
    if (start === end || !this.tree) return []
    const first = locateFoldBlock(this.tree, start, 'row')
    const last = locateFoldBlock(this.tree, end - 1, 'row')
    const result = this.blocks.slice(first.index, last.index + 1)
    result[0] = sliceAnalysis(
      result[0]!,
      start - first.row,
      Math.min(end - first.row, first.block.facts.facts.length),
    )
    if (first.index !== last.index)
      result[result.length - 1] = sliceAnalysis(result.at(-1)!, 0, end - last.row)
    return result
  }

  private finishFacts(): void {
    this.reader = null
    this.tasks = []
    if (!this.topologyChanged) {
      this.phase = 'ready'
      this.reused = true
      return
    }
    if (this.directoryChanged || this.directory.size === 0) {
      this.metadata = { kind: 'directory', index: 0, directory: new Map() }
      return
    }
    this.beginBottom()
  }

  private beginBottom(): void {
    this.bottomIndex = this.dirtyLast
    this.bottom = this.blocks[this.dirtyLast + 1]?.above ?? EMPTY_STACK
    this.phase = 'bottom'
  }

  private advanceMetadata(work: FoldMetadataWork): void {
    this.metadataSteps += 1
    if (work.kind === 'directory') return this.advanceDirectory(work)
    if (!work.builder.step()) return
    this.tree = work.builder.result
    this.metadata = null
    if (work.resume === 'task') {
      this.taskIndex += 1
      return
    }
    this.beginBottom()
  }

  private advanceDirectory(work: Extract<FoldMetadataWork, { kind: 'directory' }>): void {
    const block = this.blocks[work.index]
    if (!block) {
      this.directory = work.directory
      this.metadata = {
        kind: 'tree',
        builder: new FoldBlockTreeBuilder(this.blocks, (left, right) =>
          this.compareLines(left, right),
        ),
        resume: 'bottom',
      }
      return
    }
    const locations = work.directory.get(block.facts.owner) ?? []
    locations.push({
      index: work.index,
      first: block.facts.startSlot,
      end: block.facts.startSlot + block.facts.facts.length,
    })
    work.directory.set(block.facts.owner, locations)
    if (!block.analyzed) this.noteDirty(work.index)
    work.index += 1
  }

  private noteDirty(index: number): void {
    this.dirtyFirst = Math.min(this.dirtyFirst, index)
    this.dirtyLast = Math.max(this.dirtyLast, index)
  }

  private compareLines(left: FoldLineReference, right: FoldLineReference): number {
    return this.position(left).row - this.position(right).row
  }

  private beginAcceptance(): void {
    if (this.candidateLast < 0) {
      this.phase = 'ready'
      return
    }
    this.acceptIndex = this.candidateFirst
    this.accepted = this.blocks[this.candidateFirst - 1]?.outgoing ?? null
    this.phase = 'accept'
  }

  private *analyzeBottom(): Generator<void, void> {
    if (this.bottomIndex < 0) {
      this.beginAcceptance()
      return
    }
    const index = this.bottomIndex--
    const block = this.blocks[index]!
    if (block.analyzed && (yield* sameIndentationStack(this.bottom, block.below))) {
      this.bottom = block.above!
      if (index <= this.dirtyFirst) this.beginAcceptance()
      return
    }
    const incoming = this.bottom
    const candidates: IndentationRegion[] = []
    for (let row = block.facts.facts.length - 1; row >= 0; row -= 1) {
      const work = this.consumeLine(block.facts, row, candidates)
      if (work) yield* work
    }
    this.propagation += block.facts.facts.length
    const converged = yield* sameIndentationStack(this.bottom, block.above)
    if (converged) this.bottom = block.above!
    this.candidateFirst = Math.min(this.candidateFirst, index)
    this.candidateLast = Math.max(this.candidateLast, index)
    this.blocks[index] = {
      ...block,
      below: incoming,
      above: this.bottom,
      candidates: candidates.reverse(),
      analyzed: false,
    }
    if (converged && index <= this.dirtyFirst) this.beginAcceptance()
  }

  private consumeLine(
    block: FoldFactBlock,
    index: number,
    folds: IndentationRegion[],
  ): Generator<void, void> | undefined {
    const fact = block.facts[index]!
    const line = foldLineReference(block, index)
    if (fact.indent === -1) {
      if (this.rules.offSide)
        this.bottom = stackNode(this.bottom.indent, line, this.bottom.line, this.bottom.parent)
      return
    }
    if (fact.marker === 'end') {
      this.bottom = stackNode(-2, line, line, this.bottom)
      return
    }
    const marker = this.bottom.indent === -2 ? this.bottom : this.bottom.marker
    if (fact.marker === 'start' && marker) {
      folds.push({ start: line, end: marker.line, endBefore: false, type: 'region' })
      this.bottom = stackNode(fact.indent, line, line, marker.parent)
      return
    }
    if (this.bottom.indent > fact.indent) return this.consumeDedent(fact.indent, line, folds)
    this.finishIndent(fact.indent, line)
  }

  private *consumeDedent(
    indent: number,
    line: FoldLineReference,
    folds: IndentationRegion[],
  ): Generator<void, void> {
    while (this.bottom.indent > indent && this.bottom.parent) {
      this.bottom = this.bottom.parent
      yield
    }
    const end = this.bottom.endAbove
    if (this.position(end).row - 1 > this.position(line).row)
      folds.push({ start: line, end, endBefore: true, type: 'indent' })
    this.finishIndent(indent, line)
  }

  private finishIndent(indent: number, line: FoldLineReference): void {
    if (this.bottom.indent === indent) {
      this.bottom = stackNode(indent, line, this.bottom.line, this.bottom.parent)
      return
    }
    this.bottom = stackNode(indent, line, line, this.bottom)
  }

  private *acceptBlock(): Generator<void, void> {
    if (this.acceptIndex === this.blocks.length) {
      this.phase = 'ready'
      return
    }
    const index = this.acceptIndex++
    const block = this.blocks[index]!
    if (block.analyzed && (yield* sameAcceptedStack(this.accepted, block.incoming))) {
      this.accepted = block.outgoing
      if (index >= this.candidateLast) this.phase = 'ready'
      return
    }
    const incoming = this.accepted
    const accepted: IndentationRegion[] = []
    for (const fold of block.candidates) {
      const work = this.acceptFold(fold, accepted)
      if (work) yield* work
    }
    this.propagation += block.facts.facts.length
    const converged = yield* sameAcceptedStack(this.accepted, block.outgoing)
    if (converged) this.accepted = block.outgoing
    this.publishBlock(index, {
      ...block,
      incoming,
      outgoing: this.accepted,
      accepted,
      analyzed: true,
    })
    if (converged && index >= this.candidateLast) this.phase = 'ready'
  }

  private acceptFold(
    fold: IndentationRegion,
    accepted: IndentationRegion[],
  ): Generator<void, void> | undefined {
    const start = this.position(fold.start).row
    const end = this.endRow(fold)
    if (end <= start) return
    if (this.accepted && this.endRow(this.accepted.fold) <= start)
      return this.expireAncestors(fold, accepted, start, end)
    this.finishAcceptedFold(fold, accepted, end)
  }

  private *expireAncestors(
    fold: IndentationRegion,
    accepted: IndentationRegion[],
    start: number,
    end: number,
  ): Generator<void, void> {
    while (this.accepted && this.endRow(this.accepted.fold) <= start) {
      this.accepted = this.accepted.parent
      yield
    }
    this.finishAcceptedFold(fold, accepted, end)
  }

  private finishAcceptedFold(
    fold: IndentationRegion,
    accepted: IndentationRegion[],
    end: number,
  ): void {
    if (this.accepted && end > this.endRow(this.accepted.fold)) return
    accepted.push(fold)
    this.accepted = { fold, parent: this.accepted }
  }

  private publishBlock(index: number, block: IndentationBlock): void {
    const maxEnd = block.accepted.reduce<FoldLineReference | null>(
      (max, fold) =>
        maximumFoldLine(max, fold.end, (left, right) => this.compareLines(left, right)),
      null,
    )
    const next = { ...block, maxEnd }
    this.blocks[index] = next
    this.tree = updateFoldBlockTree(this.tree!, index, next, (left, right) =>
      this.compareLines(left, right),
    )
  }

  private position(reference: FoldLineReference): LinePosition {
    if (reference.owner === EOF_OWNER)
      return { row: this.snapshot.lineCount, end: this.snapshot.length }
    const location = this.directory
      .get(reference.owner)
      ?.find((item) => reference.slot >= item.first && reference.slot < item.end)
    if (!location || !this.tree) return { row: -1, end: -1 }
    const found = locateFoldBlock(this.tree, location.index, 'index')
    const local = reference.slot - found.block.facts.startSlot
    const row = found.row + local
    return {
      row,
      end:
        found.offset +
        found.block.facts.offsets[local + 1]! -
        Number(row < this.snapshot.lineCount - 1),
    }
  }

  private endRow(fold: IndentationRegion): number {
    return this.position(fold.end).row - Number(fold.endBefore)
  }

  private range(fold: IndentationRegion): FoldRange {
    const start = this.position(fold.start)
    const endRow = this.endRow(fold)
    const block = locateFoldBlock(this.tree!, endRow, 'row')
    const end =
      block.offset +
      block.block.facts.offsets[endRow - block.row + 1]! -
      Number(endRow < this.snapshot.lineCount - 1)
    return {
      startIndex: start.end,
      endIndex: end,
      startLine: start.row,
      endLine: endRow,
      type: fold.type,
      ...(this.languageId ? { languageId: this.languageId } : {}),
    }
  }

  private collect(
    tree: FoldBlockTree,
    row: number,
    start: number,
    end: number,
    result: FoldRange[],
  ): void {
    if (row > end || !tree.maxEnd || this.position(tree.maxEnd).row < start) return
    if (tree.kind === 'branch') {
      this.collect(tree.left, row, start, end, result)
      this.collect(tree.right, row + tree.left.rows, start, end, result)
      return
    }
    for (const fold of tree.block.accepted) {
      const range = this.range(fold)
      if (range.startLine <= end && range.endLine >= start) result.push(range)
    }
  }
}

function sliceAnalysis(block: IndentationBlock, start: number, end: number): IndentationBlock {
  const facts = sliceFoldFactBlock(block.facts, start, end)
  return facts === block.facts ? block : unanalyzedBlock(facts)
}

function readTasks(batch: TextEditBatch): ReadTask[] {
  const tasks: ReadTask[] = []
  for (const change of batch.changes) {
    const previous = tasks.at(-1)
    if (previous && change.startRow <= previous.beforeEnd) {
      previous.beforeEnd = Math.max(previous.beforeEnd, change.endRow + 1)
      previous.afterEnd = Math.max(previous.afterEnd, change.afterEndRow + 1)
      continue
    }
    tasks.push({
      beforeStart: change.startRow,
      beforeEnd: change.endRow + 1,
      afterStart: change.afterStartRow,
      afterEnd: change.afterEndRow + 1,
      row: change.afterStartRow,
      started: false,
      installedRows: 0,
      replacements: null,
      blocks: [],
      pending: [],
    })
  }
  return tasks
}

function* taskFacts(task: ReadTask): Generator<FoldLineFact> {
  for (const block of task.blocks) yield* block.facts.facts
}
