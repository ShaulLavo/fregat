export type HistoryNodeId = number

type EditorHistoryEntry<TSnapshot, TSelectionState, TTransaction = never> = {
  readonly snapshot: TSnapshot
  readonly selections: TSelectionState
  readonly transaction?: TTransaction
}

export type EditorHistoryNode<TSnapshot, TSelectionState, TTransaction = never> = {
  readonly id: HistoryNodeId
  readonly parentId: HistoryNodeId | null
  readonly childIds: readonly HistoryNodeId[]
  // The child redo follows: the branch most recently left or created.
  readonly preferredChildId: HistoryNodeId | null
  readonly sequence: number
  // Bumped when a typing run amends the node in place, so a summary computed from
  // an earlier revision can tell it is stale.
  readonly revision: number
  readonly visitedAt: number
  readonly committedAt: number
  readonly sealed: boolean
  readonly snapshot: TSnapshot
  readonly selections: TSelectionState
  // The selections to restore when undoing out of this node into its parent.
  readonly selectionsBefore: TSelectionState
  readonly transaction: TTransaction | undefined
}

export type EditorHistory<TSnapshot, TSelectionState, TTransaction = never> = {
  readonly nodes: ReadonlyMap<
    HistoryNodeId,
    EditorHistoryNode<TSnapshot, TSelectionState, TTransaction>
  >
  readonly rootId: HistoryNodeId
  readonly currentId: HistoryNodeId
  readonly nextId: HistoryNodeId
  readonly clock: number
  readonly retainedStates: number
  readonly graphRevision: number
  readonly current: TSnapshot
  readonly selections: TSelectionState
  readonly undo: EditorHistoryEntry<TSnapshot, TSelectionState, TTransaction> | null
  readonly redo: EditorHistoryEntry<TSnapshot, TSelectionState, TTransaction> | null
}

export type EditorHistoryOptions = {
  // Retained states other than the current one, measured across the whole graph.
  readonly retainedStates?: number
  readonly committedAt?: number
}

export type EditorHistoryCommitOptions<TSelectionState> = {
  readonly selectionsBefore?: TSelectionState
  readonly committedAt?: number
}

// Every retained node pins the snapshot it was taken from, and a pinned snapshot
// keeps alive every piece the document has ever deleted. Unbounded history therefore
// makes a long session monotonically slower rather than merely larger.
const DEFAULT_RETAINED_HISTORY_STATES = 200

type Node<S, Sel, T> = EditorHistoryNode<S, Sel, T>
type Nodes<S, Sel, T> = Map<HistoryNodeId, Node<S, Sel, T>>

type HistoryState<S, Sel, T> = {
  nodes: Nodes<S, Sel, T>
  rootId: HistoryNodeId
  currentId: HistoryNodeId
  nextId: HistoryNodeId
  clock: number
  retainedStates: number
  graphRevision: number
}

export const createEditorHistory = <TSnapshot, TSelectionState, TTransaction = never>(
  current: TSnapshot,
  selections: TSelectionState,
  options: EditorHistoryOptions = {},
): EditorHistory<TSnapshot, TSelectionState, TTransaction> => {
  const root: Node<TSnapshot, TSelectionState, TTransaction> = {
    id: 0,
    parentId: null,
    childIds: [],
    preferredChildId: null,
    sequence: 0,
    revision: 0,
    visitedAt: 0,
    committedAt: options.committedAt ?? 0,
    sealed: false,
    snapshot: current,
    selections,
    selectionsBefore: selections,
    transaction: undefined,
  }
  return finish({
    nodes: new Map([[0, root]]),
    rootId: 0,
    currentId: 0,
    nextId: 1,
    clock: 0,
    retainedStates: options.retainedStates ?? DEFAULT_RETAINED_HISTORY_STATES,
    graphRevision: 0,
  })
}

export type RestoredEditorHistoryNode<TSnapshot, TSelectionState, TTransaction = never> = Omit<
  EditorHistoryNode<TSnapshot, TSelectionState, TTransaction>,
  'childIds' | 'revision'
>

export type RestoredEditorHistoryState = {
  readonly rootId: HistoryNodeId
  readonly currentId: HistoryNodeId
  readonly nextId: HistoryNodeId
  readonly clock: number
  readonly retainedStates?: number
}

// Rebuilds a graph from nodes listed in creation order. Child lists are derived here,
// so a caller cannot hand over a parent that disagrees with its children.
export const restoreEditorHistory = <TSnapshot, TSelectionState, TTransaction = never>(
  restored: readonly RestoredEditorHistoryNode<TSnapshot, TSelectionState, TTransaction>[],
  state: RestoredEditorHistoryState,
): EditorHistory<TSnapshot, TSelectionState, TTransaction> => {
  const nodes: Nodes<TSnapshot, TSelectionState, TTransaction> = new Map()
  for (const node of restored) nodes.set(node.id, { ...node, childIds: [], revision: 0 })
  for (const node of restored) {
    if (node.parentId === null) continue
    const parent = nodes.get(node.parentId)!
    nodes.set(parent.id, { ...parent, childIds: [...parent.childIds, node.id] })
  }

  const history: HistoryState<TSnapshot, TSelectionState, TTransaction> = {
    nodes,
    rootId: state.rootId,
    currentId: state.currentId,
    nextId: state.nextId,
    clock: state.clock,
    retainedStates: state.retainedStates ?? DEFAULT_RETAINED_HISTORY_STATES,
    graphRevision: 0,
  }
  prune(history)
  return finish(history)
}

export const commitEditorHistory = <TSnapshot, TSelectionState, TTransaction = never>(
  history: EditorHistory<TSnapshot, TSelectionState, TTransaction>,
  current: TSnapshot,
  selections: TSelectionState,
  transaction?: TTransaction,
  options: EditorHistoryCommitOptions<TSelectionState> = {},
): EditorHistory<TSnapshot, TSelectionState, TTransaction> => {
  const state = clone(history)
  const parent = state.nodes.get(state.currentId)!
  const id = state.nextId
  state.nextId += 1
  state.clock += 1
  state.nodes.set(parent.id, {
    ...parent,
    childIds: [...parent.childIds, id],
    preferredChildId: id,
    sealed: true,
  })
  state.nodes.set(id, {
    id,
    parentId: parent.id,
    childIds: [],
    preferredChildId: null,
    sequence: state.clock,
    revision: 0,
    visitedAt: state.clock,
    committedAt: options.committedAt ?? 0,
    sealed: false,
    snapshot: current,
    selections,
    selectionsBefore: options.selectionsBefore ?? parent.selections,
    transaction,
  })
  state.currentId = id
  prune(state)
  return finish(state)
}

// Amends the current node in place while it is the unsealed leaf of a typing run.
// Anything else — a sealed node, a branch point, the root — gets a new node instead,
// because rewriting it would change what an existing branch point means.
export const amendEditorHistory = <TSnapshot, TSelectionState, TTransaction = never>(
  history: EditorHistory<TSnapshot, TSelectionState, TTransaction>,
  current: TSnapshot,
  selections: TSelectionState,
  transaction: TTransaction,
  options: EditorHistoryCommitOptions<TSelectionState> = {},
): EditorHistory<TSnapshot, TSelectionState, TTransaction> => {
  const node = history.nodes.get(history.currentId)!
  if (node.parentId === null || node.sealed || node.childIds.length > 0) {
    return commitEditorHistory(history, current, selections, transaction, options)
  }

  const state = clone(history)
  state.nodes.set(node.id, {
    ...node,
    revision: node.revision + 1,
    committedAt: options.committedAt ?? node.committedAt,
    snapshot: current,
    selections,
    transaction,
  })
  return finish(state)
}

export const undoEditorHistory = <TSnapshot, TSelectionState, TTransaction = never>(
  history: EditorHistory<TSnapshot, TSelectionState, TTransaction>,
): EditorHistory<TSnapshot, TSelectionState, TTransaction> => {
  const node = history.nodes.get(history.currentId)!
  if (node.parentId === null) return history

  const state = clone(history)
  const parent = state.nodes.get(node.parentId)!
  state.clock += 1
  state.nodes.set(node.id, { ...node, sealed: true })
  state.nodes.set(parent.id, {
    ...parent,
    preferredChildId: node.id,
    visitedAt: state.clock,
    selections: node.selectionsBefore,
  })
  state.currentId = parent.id
  return finish(state)
}

export const redoEditorHistory = <TSnapshot, TSelectionState, TTransaction = never>(
  history: EditorHistory<TSnapshot, TSelectionState, TTransaction>,
): EditorHistory<TSnapshot, TSelectionState, TTransaction> => {
  const node = history.nodes.get(history.currentId)!
  if (node.preferredChildId === null) return history
  return moveTo(history, node.preferredChildId)
}

// Moves to any retained state. Every ancestor on the way learns the path as its
// preferred branch, so redo afterwards walks back down the same way.
export const checkoutEditorHistory = <TSnapshot, TSelectionState, TTransaction = never>(
  history: EditorHistory<TSnapshot, TSelectionState, TTransaction>,
  id: HistoryNodeId,
): EditorHistory<TSnapshot, TSelectionState, TTransaction> => {
  if (id === history.currentId || !history.nodes.has(id)) return history
  return moveTo(history, id)
}

// Chooses which branch redo follows from the current state without moving.
export const preferEditorHistoryBranch = <TSnapshot, TSelectionState, TTransaction = never>(
  history: EditorHistory<TSnapshot, TSelectionState, TTransaction>,
  id: HistoryNodeId,
): EditorHistory<TSnapshot, TSelectionState, TTransaction> => {
  if (!history.nodes.has(id) || id === history.currentId) return history
  const state = clone(history)
  preferPath(state, id)
  return finish(state)
}

// Replaces what the current state holds without recording a transition. Used for
// edits the session tracks outside the graph and for barrier bookkeeping.
export const replaceEditorHistoryState = <TSnapshot, TSelectionState, TTransaction = never>(
  history: EditorHistory<TSnapshot, TSelectionState, TTransaction>,
  current: TSnapshot,
  selections: TSelectionState,
  options: { readonly clearRedo?: boolean } = {},
): EditorHistory<TSnapshot, TSelectionState, TTransaction> => {
  const state = clone(history)
  const node = state.nodes.get(state.currentId)!
  state.nodes.set(node.id, {
    ...node,
    preferredChildId: options.clearRedo ? null : node.preferredChildId,
    snapshot: current,
    selections,
  })
  return finish(state)
}

// Redo from here stops offering a branch. The branch itself stays retained for the
// graph; only the two-key path forgets it.
export const clearEditorHistoryRedo = <TSnapshot, TSelectionState, TTransaction = never>(
  history: EditorHistory<TSnapshot, TSelectionState, TTransaction>,
): EditorHistory<TSnapshot, TSelectionState, TTransaction> => {
  const node = history.nodes.get(history.currentId)!
  if (node.preferredChildId === null) return history
  const state = clone(history)
  state.nodes.set(node.id, { ...node, preferredChildId: null })
  return finish(state)
}

// Creation order is sequence order: a node is only ever re-set under its own key,
// which keeps its place in the map, so no sort is needed.
export const editorHistoryNodes = <TSnapshot, TSelectionState, TTransaction = never>(
  history: EditorHistory<TSnapshot, TSelectionState, TTransaction>,
): readonly EditorHistoryNode<TSnapshot, TSelectionState, TTransaction>[] =>
  Array.from(history.nodes.values())

export const editorHistoryPath = <TSnapshot, TSelectionState, TTransaction = never>(
  history: EditorHistory<TSnapshot, TSelectionState, TTransaction>,
  id: HistoryNodeId,
): readonly HistoryNodeId[] => {
  const path: HistoryNodeId[] = []
  for (let node = history.nodes.get(id); node; node = nodeParent(history.nodes, node)) {
    path.push(node.id)
  }
  return path.reverse()
}

const moveTo = <S, Sel, T>(
  history: EditorHistory<S, Sel, T>,
  id: HistoryNodeId,
): EditorHistory<S, Sel, T> => {
  const state = clone(history)
  const leaving = state.nodes.get(state.currentId)!
  state.nodes.set(leaving.id, { ...leaving, sealed: true })
  preferPath(state, id)
  state.clock += 1
  const target = state.nodes.get(id)!
  state.nodes.set(id, { ...target, visitedAt: state.clock })
  state.currentId = id
  return finish(state)
}

const preferPath = <S, Sel, T>(state: HistoryState<S, Sel, T>, id: HistoryNodeId): void => {
  let child = state.nodes.get(id)!
  for (
    let parent = nodeParent(state.nodes, child);
    parent;
    parent = nodeParent(state.nodes, parent)
  ) {
    if (parent.preferredChildId !== child.id) {
      state.nodes.set(parent.id, { ...parent, preferredChildId: child.id })
    }
    child = parent
  }
}

// Least-recently-visited inactive leaves go first, then the root advances along the
// only path left. The current state is never pruned.
const prune = <S, Sel, T>(state: HistoryState<S, Sel, T>): void => {
  while (state.nodes.size - 1 > state.retainedStates) {
    const leaf = staleLeaf(state)
    if (leaf) {
      removeLeaf(state, leaf)
      continue
    }
    advanceRoot(state)
  }
}

const staleLeaf = <S, Sel, T>(state: HistoryState<S, Sel, T>): Node<S, Sel, T> | null => {
  let stale: Node<S, Sel, T> | null = null
  for (const node of state.nodes.values()) {
    if (node.id === state.currentId || node.childIds.length > 0) continue
    if (!stale || isStalerThan(node, stale)) stale = node
  }
  return stale
}

const isStalerThan = <S, Sel, T>(node: Node<S, Sel, T>, than: Node<S, Sel, T>): boolean => {
  if (node.visitedAt !== than.visitedAt) return node.visitedAt < than.visitedAt
  return node.sequence < than.sequence
}

const removeLeaf = <S, Sel, T>(state: HistoryState<S, Sel, T>, leaf: Node<S, Sel, T>): void => {
  state.nodes.delete(leaf.id)
  if (leaf.parentId === null) return
  const parent = state.nodes.get(leaf.parentId)!
  state.nodes.set(parent.id, {
    ...parent,
    childIds: parent.childIds.filter((id) => id !== leaf.id),
    preferredChildId: parent.preferredChildId === leaf.id ? null : parent.preferredChildId,
  })
}

const advanceRoot = <S, Sel, T>(state: HistoryState<S, Sel, T>): void => {
  const root = state.nodes.get(state.rootId)!
  const nextId = root.childIds[0]
  if (nextId === undefined) return
  const next = state.nodes.get(nextId)!
  state.nodes.delete(root.id)
  state.nodes.set(nextId, {
    ...next,
    parentId: null,
    selectionsBefore: next.selections,
    transaction: undefined,
  })
  state.rootId = nextId
}

const nodeParent = <S, Sel, T>(
  nodes: ReadonlyMap<HistoryNodeId, Node<S, Sel, T>>,
  node: Node<S, Sel, T>,
): Node<S, Sel, T> | undefined => (node.parentId === null ? undefined : nodes.get(node.parentId))

// The map is copied per operation. It never holds more than the retention budget,
// so the copy is cheaper than the persistent-structure bookkeeping it replaces, and
// it keeps every history value immutable for the barrier code that stashes one.
const clone = <S, Sel, T>(history: EditorHistory<S, Sel, T>): HistoryState<S, Sel, T> => ({
  nodes: new Map(history.nodes),
  rootId: history.rootId,
  currentId: history.currentId,
  nextId: history.nextId,
  clock: history.clock,
  retainedStates: history.retainedStates,
  graphRevision: history.graphRevision + 1,
})

const finish = <S, Sel, T>(state: HistoryState<S, Sel, T>): EditorHistory<S, Sel, T> => {
  const current = state.nodes.get(state.currentId)!
  const parent = nodeParent(state.nodes, current)
  const preferred =
    current.preferredChildId === null ? undefined : state.nodes.get(current.preferredChildId)
  return {
    nodes: state.nodes,
    rootId: state.rootId,
    currentId: state.currentId,
    nextId: state.nextId,
    clock: state.clock,
    retainedStates: state.retainedStates,
    graphRevision: state.graphRevision,
    current: current.snapshot,
    selections: current.selections,
    undo: parent
      ? {
          snapshot: parent.snapshot,
          selections: current.selectionsBefore,
          transaction: current.transaction,
        }
      : null,
    redo: preferred
      ? {
          snapshot: preferred.snapshot,
          selections: preferred.selections,
          transaction: preferred.transaction,
        }
      : null,
  }
}
