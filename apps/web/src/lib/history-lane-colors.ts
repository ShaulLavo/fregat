// One palette for every lane graph: git commits and a file's undo branches.
export const historyLaneColors = [
  'text-git-graph-1',
  'text-git-graph-2',
  'text-git-graph-3',
  'text-git-graph-4',
  'text-git-graph-5',
] as const

export function historyLaneColor(lane: number): string {
  return historyLaneColors[lane % historyLaneColors.length]!
}
