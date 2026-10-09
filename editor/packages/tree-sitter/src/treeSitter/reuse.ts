import { Edit } from 'web-tree-sitter'
import type { Tree } from 'web-tree-sitter'
import type { TreeSitterInputEdit } from './types'

export function editReusableTree(tree: Tree, edits: readonly TreeSitterInputEdit[]): Tree {
  const reusable = tree.copy()
  for (const edit of edits) reusable.edit(new Edit(edit))
  return reusable
}
