import type { GitBranch, GitWorktree } from '@workspace/contracts'

type ParentRecord = Pick<GitWorktree, 'branch' | 'baseBranch'>

export type BranchLaneRow = {
  readonly branch: GitBranch
  readonly parent: string | null
  readonly lane: number
  readonly above: readonly number[]
  readonly below: readonly number[]
  readonly parentLane: number | null
}

function recordedParents(branches: readonly GitBranch[], worktrees: readonly ParentRecord[]) {
  const names = new Set(branches.map((branch) => branch.name))
  const parents = new Map<string, string | null>()
  for (const { branch, baseBranch } of worktrees) {
    if (!branch || !names.has(branch)) continue
    const parent = baseBranch && names.has(baseBranch) && baseBranch !== branch ? baseBranch : null
    const previous = parents.get(branch)
    parents.set(branch, previous === undefined || previous === parent ? parent : null)
  }
  return parents
}

export function branchLanes(branches: readonly GitBranch[], worktrees: readonly ParentRecord[]) {
  const parents = recordedParents(branches, worktrees)
  const children = new Map<string, GitBranch[]>()
  for (const branch of branches) {
    const parent = parents.get(branch.name)
    if (!parent) continue
    const siblings = children.get(parent) ?? []
    siblings.push(branch)
    children.set(parent, siblings)
  }
  const rows: BranchLaneRow[] = []
  const roots = branches.filter((branch) => !parents.get(branch.name))
  const stack: {
    branch: GitBranch
    depth: number
    through: number[]
    parent: string | null
    last: boolean
  }[] = roots
    .toReversed()
    .map((branch) => ({ branch, depth: 0, through: [], parent: null, last: true }))
  const visited = new Set<string>()
  while (stack.length) {
    const entry = stack.pop()!
    const { branch, depth, through, parent, last } = entry
    visited.add(branch.name)
    const lane = Math.min(depth, 2)
    const parentLane = parent === null ? null : Math.min(depth - 1, 2)
    const descendants = children.get(branch.name) ?? []
    const below = [...through]
    if (parentLane !== null && !last) below.push(parentLane)
    rows.push({
      branch,
      parent,
      lane,
      parentLane,
      above: parentLane === null ? through : [...through, parentLane],
      below: descendants.length ? [...below, lane] : below,
    })
    for (let index = descendants.length - 1; index >= 0; index -= 1) {
      stack.push({
        branch: descendants[index]!,
        depth: depth + 1,
        through: [...new Set(below)],
        parent: branch.name,
        last: index === descendants.length - 1,
      })
    }
  }
  // Cyclic records cannot establish ancestry; keep their branches in the flat list.
  for (const branch of branches) {
    if (visited.has(branch.name)) continue
    rows.push({ branch, parent: null, lane: 0, parentLane: null, above: [], below: [] })
  }
  return {
    rows,
    lanes: rows.some((row) => row.parent !== null)
      ? rows.reduce((maximum, row) => Math.max(maximum, row.lane + 1), 0)
      : 0,
  }
}
