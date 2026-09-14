import type { GitHistoryCommit } from '@workspace/contracts'

type HistoryLane = { id: string; color: number }
type HistoryEdge = {
  from: number
  to: number
  color: number
  half: 'top' | 'bottom' | 'full'
}
export type HistoryRow = {
  commit: GitHistoryCommit
  column: number
  color: number
  width: number
  edges: readonly HistoryEdge[]
}

export function layoutHistoryMatches(commits: readonly GitHistoryCommit[]): HistoryRow[] {
  return commits.map((commit) => ({ commit, column: 0, color: 0, width: 1, edges: [] }))
}

export function layoutHistory(commits: readonly GitHistoryCommit[]): HistoryRow[] {
  let lanes: HistoryLane[] = []
  let nextColor = 0
  const rows: HistoryRow[] = []
  for (const commit of commits) {
    const existing = lanes.findIndex((lane) => lane.id === commit.id)
    const column = existing < 0 ? lanes.length : existing
    const color = lanes[column]?.color ?? nextColor++
    const after = lanes.filter((lane) => lane.id !== commit.id)
    commit.parents.forEach((parent, index) => {
      if (after.some((lane) => lane.id === parent)) return
      const lane = { id: parent, color: index === 0 ? color : nextColor++ }
      after.splice(index === 0 ? Math.min(column, after.length) : after.length, 0, lane)
    })
    const edges = historyEdges(commit, lanes, after, column, color)
    rows.push({
      commit,
      column,
      color,
      edges,
      width: Math.max(column + 1, lanes.length, after.length),
    })
    lanes = after
  }
  return rows
}

function historyEdges(
  commit: GitHistoryCommit,
  before: readonly HistoryLane[],
  after: readonly HistoryLane[],
  column: number,
  color: number,
): HistoryEdge[] {
  const edges: HistoryEdge[] = before.map((lane, from) => ({
    from,
    to: lane.id === commit.id ? column : after.findIndex((next) => next.id === lane.id),
    color: lane.color,
    half: lane.id === commit.id ? 'top' : 'full',
  }))
  for (const parent of commit.parents) {
    const to = after.findIndex((lane) => lane.id === parent)
    edges.push({
      from: column,
      to,
      color: parent === commit.parents[0] ? color : (after[to]?.color ?? color),
      half: 'bottom',
    })
  }
  return edges
}

export function historyEdgePath(edge: HistoryEdge) {
  const fromX = 12 + edge.from * 14
  const toX = 12 + edge.to * 14
  const fromY = edge.half === 'bottom' ? 12 : 0
  const toY = edge.half === 'top' ? 12 : 24
  const middle = (fromY + toY) / 2
  return `M ${fromX} ${fromY} C ${fromX} ${middle}, ${toX} ${middle}, ${toX} ${toY}`
}

export const historyLaneColors = [
  'text-git-graph-1',
  'text-git-graph-2',
  'text-git-graph-3',
  'text-git-graph-4',
  'text-git-graph-5',
] as const
