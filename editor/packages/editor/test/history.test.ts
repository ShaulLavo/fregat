import { describe, expect, it } from 'vitest'

import {
  amendEditorHistory,
  checkoutEditorHistory,
  clearEditorHistoryRedo,
  commitEditorHistory,
  createEditorHistory,
  editorHistoryNodes,
  editorHistoryPath,
  preferEditorHistoryBranch,
  redoEditorHistory,
  replaceEditorHistoryState,
  undoEditorHistory,
  type EditorHistory,
} from '../src/history'

type Snapshot = { readonly id: number }
type Selections = { readonly caret: number }
type Transaction = { readonly label: string }
type History = EditorHistory<Snapshot, Selections, Transaction>

// Everything below counts in literals rather than in the default: a test that
// derives its expectations from the constant it is guarding passes for any value
// of it, which is exactly the typo the cap has to be protected from.
const CAP = 200
const OVERSHOOT = 50
const COMMITS = CAP + OVERSHOOT

const commit = (history: History, id: number, label = `t${id}`): History =>
  commitEditorHistory(history, { id }, { caret: id }, { label }, { committedAt: id })

const commitRange = (
  count: number,
): { history: History; snapshots: Snapshot[]; selections: Selections[] } => {
  const snapshots: Snapshot[] = [{ id: 0 }]
  const selections: Selections[] = [{ caret: 0 }]
  let history = createEditorHistory<Snapshot, Selections, Transaction>(
    snapshots[0]!,
    selections[0]!,
  )

  for (let id = 1; id <= count; id += 1) {
    const snapshot = { id }
    const selection = { caret: id }
    snapshots.push(snapshot)
    selections.push(selection)
    history = commitEditorHistory(history, snapshot, selection, { label: `t${id}` })
  }

  return { history, snapshots, selections }
}

// A, then B, undo B, then C: the shape every branching test starts from.
const branched = () => {
  const a = commit(
    createEditorHistory<Snapshot, Selections, Transaction>({ id: 0 }, { caret: 0 }),
    1,
  )
  const b = commit(a, 2)
  const undone = undoEditorHistory(b)
  const c = commit(undone, 3)
  return { c, bId: b.currentId, cId: c.currentId, aId: a.currentId }
}

// The point of the cap is releasing what it drops, which entry counts alone cannot
// show — a stale link anywhere in the record would keep the tail alive.
const isReachableFrom = (root: unknown, target: object): boolean => {
  const seen = new Set<object>()
  const pending: unknown[] = [root]

  while (pending.length > 0) {
    const value = pending.pop()
    if (value === target) return true
    if (typeof value !== 'object' || value === null || seen.has(value)) continue
    seen.add(value)
    if (value instanceof Map) {
      pending.push(...value.values())
      continue
    }
    pending.push(...Object.values(value))
  }

  return false
}

describe('editor history branches', () => {
  it('keeps the branch that was undone when a different edit follows', () => {
    const { c, bId, cId, aId } = branched()

    expect(c.nodes.size).toBe(4)
    expect(c.nodes.get(aId)?.childIds).toEqual([bId, cId])
    expect(c.nodes.get(bId)?.snapshot).toEqual({ id: 2 })
    expect(c.current).toEqual({ id: 3 })
  })

  it('redoes along the branch most recently created or left', () => {
    const { c, bId, cId } = branched()
    const atA = undoEditorHistory(c)

    expect(redoEditorHistory(atA).currentId).toBe(cId)

    const preferred = preferEditorHistoryBranch(atA, bId)
    expect(redoEditorHistory(preferred).currentId).toBe(bId)
    expect(preferred.currentId).toBe(atA.currentId)
  })

  it('checks out any retained state and teaches the path to redo', () => {
    const { c, bId, cId, aId } = branched()
    const atB = checkoutEditorHistory(c, bId)

    expect(atB.current).toEqual({ id: 2 })
    expect(atB.selections).toEqual({ caret: 2 })
    expect(atB.nodes.get(aId)?.preferredChildId).toBe(bId)
    expect(editorHistoryPath(atB, cId)).toEqual([0, aId, cId])
    expect(checkoutEditorHistory(atB, bId)).toBe(atB)
    expect(checkoutEditorHistory(atB, 99)).toBe(atB)
    expect(redoEditorHistory(undoEditorHistory(atB)).currentId).toBe(bId)
  })

  it('undo restores the selections the edit started from', () => {
    const root = createEditorHistory<Snapshot, Selections, Transaction>({ id: 0 }, { caret: 0 })
    const moved = replaceEditorHistoryState(root, { id: 0 }, { caret: 7 })
    const committed = commitEditorHistory(
      moved,
      { id: 1 },
      { caret: 1 },
      { label: 't' },
      {
        selectionsBefore: { caret: 5 },
      },
    )

    expect(undoEditorHistory(committed).selections).toEqual({ caret: 5 })
    expect(redoEditorHistory(undoEditorHistory(committed)).selections).toEqual({ caret: 1 })
  })

  it('amends only the unsealed leaf of a typing run', () => {
    const root = createEditorHistory<Snapshot, Selections, Transaction>({ id: 0 }, { caret: 0 })
    const typed = commit(root, 1)
    const amended = amendEditorHistory(
      typed,
      { id: 2 },
      { caret: 2 },
      { label: 'run' },
      {
        committedAt: 20,
      },
    )

    expect(amended.nodes.size).toBe(2)
    expect(amended.currentId).toBe(typed.currentId)
    expect(amended.nodes.get(amended.currentId)).toMatchObject({
      committedAt: 20,
      revision: 1,
      transaction: { label: 'run' },
    })

    const returned = redoEditorHistory(undoEditorHistory(amended))
    const sibling = amendEditorHistory(returned, { id: 3 }, { caret: 3 }, { label: 'after' })
    expect(sibling.nodes.size).toBe(3)
    expect(sibling.nodes.get(returned.currentId)?.sealed).toBe(true)
  })

  it('clears redo without dropping the branch from the graph', () => {
    const { c, bId, cId } = branched()
    const atA = clearEditorHistoryRedo(undoEditorHistory(c))

    expect(atA.redo).toBeNull()
    expect(redoEditorHistory(atA)).toBe(atA)
    expect(atA.nodes.has(bId)).toBe(true)
    expect(atA.nodes.has(cId)).toBe(true)
    expect(checkoutEditorHistory(atA, cId).current).toEqual({ id: 3 })
  })

  it('lists nodes in creation order with wall-clock times', () => {
    const { c } = branched()
    expect(editorHistoryNodes(c).map((node) => [node.id, node.committedAt])).toEqual([
      [0, 0],
      [1, 1],
      [2, 2],
      [3, 3],
    ])
  })
})

describe('editor history retention', () => {
  it('keeps the two hundred newest states and drops everything older', () => {
    const { history, snapshots } = commitRange(COMMITS)

    expect(history.nodes.size - 1).toBe(CAP)
    let cursor = history
    for (let step = 0; step < CAP; step += 1) cursor = undoEditorHistory(cursor)
    expect(cursor.current).toBe(snapshots[OVERSHOOT])
    expect(undoEditorHistory(cursor)).toBe(cursor)
  })

  it('releases the dropped snapshot and its selection from the history', () => {
    const { history, snapshots, selections } = commitRange(COMMITS)

    expect(isReachableFrom(history, snapshots[OVERSHOOT - 1]!)).toBe(false)
    expect(isReachableFrom(history, selections[OVERSHOOT - 1]!)).toBe(false)
    expect(isReachableFrom(history, snapshots[OVERSHOOT]!)).toBe(true)
  })

  it('prunes the least recently visited inactive leaf before the active path', () => {
    const root = createEditorHistory<Snapshot, Selections, Transaction>(
      { id: 0 },
      { caret: 0 },
      {
        retainedStates: 3,
      },
    )
    const a = commit(root, 1)
    const b = commit(a, 2)
    const atA = undoEditorHistory(b)
    const c = commit(atA, 3)
    const d = commit(c, 4)

    expect(d.nodes.size - 1).toBe(3)
    expect(d.nodes.has(b.currentId)).toBe(false)
    expect(d.nodes.get(a.currentId)?.childIds).toEqual([c.currentId])
    expect(editorHistoryPath(d, d.currentId)).toEqual([0, a.currentId, c.currentId, d.currentId])
  })

  it('never lets redo point at a pruned child', () => {
    const root = createEditorHistory<Snapshot, Selections, Transaction>(
      { id: 0 },
      { caret: 0 },
      {
        retainedStates: 2,
      },
    )
    const a = commit(root, 1)
    const b = commit(a, 2)
    const atRoot = undoEditorHistory(undoEditorHistory(b))
    const c = commit(atRoot, 3)
    const d = commit(c, 4)

    expect(d.nodes.has(b.currentId)).toBe(false)
    expect(d.nodes.get(root.currentId)?.preferredChildId).toBe(c.currentId)
    expect(redoEditorHistory(undoEditorHistory(undoEditorHistory(d))).currentId).toBe(c.currentId)
  })

  it('redoes everything the cap kept', () => {
    const { history, snapshots } = commitRange(COMMITS)
    let cursor = history
    for (let step = 0; step < CAP; step += 1) cursor = undoEditorHistory(cursor)
    for (let step = 0; step < CAP; step += 1) cursor = redoEditorHistory(cursor)

    expect(cursor.current).toBe(snapshots[COMMITS])
    expect(redoEditorHistory(cursor)).toBe(cursor)
  })
})
