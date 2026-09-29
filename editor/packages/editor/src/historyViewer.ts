import type {
  DocumentSessionChange,
  EditorHistoryGraph,
  EditorHistoryGraphNode,
  EditorTextBuffer,
  EditorViewSession,
} from './documentSession'
import type { HistoryNodeId } from './history'
import type { PieceTableSnapshot } from '@singapore-editor/textbuffer'

export type HistoryComparisonSide = {
  readonly id: HistoryNodeId
  readonly revision: number
  readonly snapshot: PieceTableSnapshot
}

export type HistoryComparison<TResult> = {
  readonly left: HistoryComparisonSide
  readonly right: HistoryComparisonSide
  readonly generation: number
  readonly status: 'pending' | 'ready' | 'failed'
  readonly result: TResult | null
}

export type HistoryViewerState<TResult> = {
  readonly graph: EditorHistoryGraph
  readonly focusedId: HistoryNodeId | null
  // Zero, one or two ids in selection order; two select a comparison.
  readonly selectedIds: readonly HistoryNodeId[]
  readonly comparison: HistoryComparison<TResult> | null
  // Focused or selected states the buffer pruned since the previous graph.
  readonly lostIds: readonly HistoryNodeId[]
}

export type HistoryViewerOptions<TResult> = {
  readonly compare?: (
    left: HistoryComparisonSide,
    right: HistoryComparisonSide,
    signal: AbortSignal,
  ) => Promise<TResult>
}

export type HistoryViewer<TResult> = {
  getState(): HistoryViewerState<TResult>
  node(id: HistoryNodeId): EditorHistoryGraphNode | null
  subscribe(listener: () => void): () => void
  focus(id: HistoryNodeId): boolean
  focusCurrent(): boolean
  focusParent(): boolean
  focusChild(): boolean
  focusPrevious(): boolean
  focusNext(): boolean
  toggleSelection(id: HistoryNodeId): boolean
  clearSelection(): void
  restore(id: HistoryNodeId, sourceView?: EditorViewSession | null): DocumentSessionChange
  dispose(): void
}

export type HistoryGraphLayoutNode = {
  readonly id: HistoryNodeId
  readonly column: number
  readonly lane: number
}

export type HistoryGraphLayoutEdge = {
  readonly fromId: HistoryNodeId
  readonly toId: HistoryNodeId
}

export type HistoryGraphLayout = {
  readonly columns: number
  readonly lanes: number
  readonly nodes: readonly HistoryGraphLayoutNode[]
  readonly edges: readonly HistoryGraphLayoutEdge[]
}

// Columns are sequence order. A node continues its parent's lane when it is the
// first child placed there; every later sibling opens the lowest lane no branch
// tip still owns. Deterministic, and recomputed only when the graph revision moves.
export function layoutHistoryGraph(graph: EditorHistoryGraph): HistoryGraphLayout {
  const laneOf = new Map<HistoryNodeId, number>()
  const owners: (HistoryNodeId | null)[] = []
  const nodes: HistoryGraphLayoutNode[] = []
  const edges: HistoryGraphLayoutEdge[] = []

  graph.nodes.forEach((node, column) => {
    const lane = laneFor(node, laneOf, owners)
    laneOf.set(node.id, lane)
    owners[lane] = node.id
    nodes.push({ id: node.id, column, lane })
    if (node.parentId !== null) edges.push({ fromId: node.parentId, toId: node.id })
  })

  return { columns: nodes.length, lanes: owners.length, nodes, edges }
}

function laneFor(
  node: EditorHistoryGraphNode,
  laneOf: ReadonlyMap<HistoryNodeId, number>,
  owners: readonly (HistoryNodeId | null)[],
): number {
  const parentLane = node.parentId === null ? undefined : laneOf.get(node.parentId)
  if (parentLane !== undefined && owners[parentLane] === node.parentId) return parentLane
  const free = owners.indexOf(null)
  return free === -1 ? owners.length : free
}

export function createHistoryViewer<TResult = unknown>(
  buffer: EditorTextBuffer,
  options: HistoryViewerOptions<TResult> = {},
): HistoryViewer<TResult> {
  return new BufferHistoryViewer(buffer, options)
}

class BufferHistoryViewer<TResult> implements HistoryViewer<TResult> {
  private readonly listeners = new Set<() => void>()
  private readonly unsubscribe: () => void
  private nodesById = new Map<HistoryNodeId, EditorHistoryGraphNode>()
  private state: HistoryViewerState<TResult>
  private generation = 0
  private pending: AbortController | null = null
  private disposed = false

  constructor(
    private readonly buffer: EditorTextBuffer,
    private readonly options: HistoryViewerOptions<TResult>,
  ) {
    const graph = buffer.getHistoryGraph()
    this.indexGraph(graph)
    this.state = {
      graph,
      focusedId: graph.currentId,
      selectedIds: [],
      comparison: null,
      lostIds: [],
    }
    this.unsubscribe = buffer.subscribe(() => this.refreshGraph())
  }

  getState(): HistoryViewerState<TResult> {
    return this.state
  }

  node(id: HistoryNodeId): EditorHistoryGraphNode | null {
    return this.nodesById.get(id) ?? null
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  // An explicit pick acknowledges a pruning notice: the loss belongs to the refresh that
  // reported it, not to every state chosen afterwards.
  focus(id: HistoryNodeId): boolean {
    if (!this.nodesById.has(id)) return false
    if (this.state.focusedId === id && this.state.lostIds.length === 0) return false
    this.publish({ ...this.state, focusedId: id, lostIds: [] })
    return true
  }

  focusCurrent(): boolean {
    return this.focus(this.state.graph.currentId)
  }

  focusParent(): boolean {
    const focused = this.focusedNode()
    if (!focused || focused.parentId === null) return false
    return this.focus(focused.parentId)
  }

  focusChild(): boolean {
    const focused = this.focusedNode()
    const child = focused?.preferredChildId ?? focused?.childIds[0]
    if (child === undefined) return false
    return this.focus(child)
  }

  focusPrevious(): boolean {
    return this.focusBySequence(-1)
  }

  focusNext(): boolean {
    return this.focusBySequence(1)
  }

  toggleSelection(id: HistoryNodeId): boolean {
    if (!this.nodesById.has(id)) return false
    const selected = this.state.selectedIds
    const next = selected.includes(id)
      ? selected.filter((candidate) => candidate !== id)
      : [...selected.slice(-1), id]
    this.publish({ ...this.state, selectedIds: next, lostIds: [] })
    this.syncComparison()
    return true
  }

  clearSelection(): void {
    if (this.state.selectedIds.length === 0 && this.state.lostIds.length === 0) return
    this.publish({ ...this.state, selectedIds: [], lostIds: [] })
    this.syncComparison()
  }

  restore(id: HistoryNodeId, sourceView: EditorViewSession | null = null): DocumentSessionChange {
    return this.buffer.checkoutHistoryState(id, sourceView)
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.unsubscribe()
    this.cancelPending()
    this.listeners.clear()
    this.nodesById = new Map()
  }

  private focusedNode(): EditorHistoryGraphNode | null {
    return this.state.focusedId === null ? null : this.node(this.state.focusedId)
  }

  private focusBySequence(step: 1 | -1): boolean {
    const nodes = this.state.graph.nodes
    const index = nodes.findIndex((node) => node.id === this.state.focusedId)
    const target = nodes[index === -1 ? (step === 1 ? 0 : nodes.length - 1) : index + step]
    if (!target) return false
    return this.focus(target.id)
  }

  private refreshGraph(): void {
    if (this.disposed) return
    const graph = this.buffer.getHistoryGraph()
    if (graph.revision === this.state.graph.revision) return

    this.indexGraph(graph)
    const lostIds = [this.state.focusedId, ...this.state.selectedIds].filter(
      (id): id is HistoryNodeId => id !== null && !this.nodesById.has(id),
    )
    // Focus rides along with the current state until the user moves it elsewhere.
    const following = this.state.focusedId === this.state.graph.currentId
    const retained = this.state.focusedId !== null && this.nodesById.has(this.state.focusedId)
    const focusedId = following || !retained ? graph.currentId : this.state.focusedId
    const selectedIds = this.state.selectedIds.filter((id) => this.nodesById.has(id))
    this.publish({ ...this.state, graph, focusedId, selectedIds, lostIds })
    this.syncComparison()
  }

  private indexGraph(graph: EditorHistoryGraph): void {
    this.nodesById = new Map(graph.nodes.map((node) => [node.id, node]))
  }

  // Two selected states request one comparison. A request captures the node
  // revisions it saw; a result published later is dropped if either moved.
  private syncComparison(): void {
    const [leftId, rightId] = this.state.selectedIds
    const left = leftId === undefined ? null : this.side(leftId)
    const right = rightId === undefined ? null : this.side(rightId)
    if (!left || !right) {
      if (this.state.comparison) this.publish({ ...this.state, comparison: null })
      this.cancelPending()
      return
    }

    const current = this.state.comparison
    if (current && sameSide(current.left, left) && sameSide(current.right, right)) return
    this.requestComparison(left, right)
  }

  private requestComparison(left: HistoryComparisonSide, right: HistoryComparisonSide): void {
    this.cancelPending()
    this.generation += 1
    const generation = this.generation
    const comparison: HistoryComparison<TResult> = {
      left,
      right,
      generation,
      status: 'pending',
      result: null,
    }
    this.publish({ ...this.state, comparison })
    const compare = this.options.compare
    if (!compare) return

    const controller = new AbortController()
    this.pending = controller
    compare(left, right, controller.signal).then(
      (result) => this.settleComparison(generation, 'ready', result),
      () => this.settleComparison(generation, 'failed', null),
    )
  }

  private settleComparison(
    generation: number,
    status: 'ready' | 'failed',
    result: TResult | null,
  ): void {
    const comparison = this.state.comparison
    if (this.disposed || !comparison || comparison.generation !== generation) return
    this.pending = null
    this.publish({ ...this.state, comparison: { ...comparison, status, result } })
  }

  private cancelPending(): void {
    this.pending?.abort()
    this.pending = null
  }

  private side(id: HistoryNodeId): HistoryComparisonSide | null {
    const node = this.nodesById.get(id)
    return node ? { id, revision: node.revision, snapshot: node.snapshot } : null
  }

  private publish(state: HistoryViewerState<TResult>): void {
    this.state = state
    for (const listener of this.listeners) listener()
  }
}

function sameSide(left: HistoryComparisonSide, right: HistoryComparisonSide): boolean {
  return left.id === right.id && left.revision === right.revision
}
