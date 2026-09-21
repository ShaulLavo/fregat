import type { EditorHistoryGraph } from '@singapore-editor/core/document'

// The state next to the current one in sequence order, for the chronological
// history commands that step across branches.
export function adjacentHistoryState(graph: EditorHistoryGraph, step: -1 | 1): number | null {
  const index = graph.nodes.findIndex((node) => node.id === graph.currentId)
  if (index === -1) return null
  return graph.nodes[index + step]?.id ?? null
}
