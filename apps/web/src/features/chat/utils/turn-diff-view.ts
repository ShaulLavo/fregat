import type { ChatTurnDiffTreeNode } from '@/features/chat/utils/turn-diff-tree'

export type TurnDiffRow = {
  id: string
  label: string
  parentId: string | undefined
  depth: number
  hasChildren: boolean
  expanded: boolean
  node: ChatTurnDiffTreeNode
}

export function collectDirectoryPaths(nodes: readonly ChatTurnDiffTreeNode[]): string[] {
  return nodes.flatMap((node) =>
    node.kind === 'directory' ? [node.path, ...collectDirectoryPaths(node.children)] : [],
  )
}

export function turnDiffRows(
  nodes: readonly ChatTurnDiffTreeNode[],
  defaultsExpanded: boolean,
  overrides: Readonly<Record<string, boolean>>,
  depth = 0,
  parentId?: string,
): TurnDiffRow[] {
  return nodes.flatMap((node) => {
    const expanded = node.kind === 'directory' && (overrides[node.path] ?? defaultsExpanded)
    const row: TurnDiffRow = {
      id: node.path,
      label: node.name,
      parentId,
      depth,
      hasChildren: node.kind === 'directory',
      expanded,
      node,
    }
    if (node.kind !== 'directory' || !expanded) return [row]
    return [row, ...turnDiffRows(node.children, defaultsExpanded, overrides, depth + 1, node.path)]
  })
}
