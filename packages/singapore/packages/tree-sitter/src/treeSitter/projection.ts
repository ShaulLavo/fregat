import type { Node, ParseCallback, Parser, Tree } from 'web-tree-sitter'
import type { TextReadSnapshot } from '@singapore-editor/core/document'
import type { TreeSitterInputEdit, TreeSitterSyntaxRange } from './types'
import { editReusableTree } from './reuse'

export type ProjectedTree = {
  readonly tree: Tree
  readonly parentRange?: TreeSitterSyntaxRange
}

/** Projection trees are temporary; the retained highlighting tree is never edited. */
export function parseProjectedTree(
  parser: Parser,
  base: Tree,
  input: ParseCallback,
  text: TextReadSnapshot,
  edits: readonly TreeSitterInputEdit[],
  options: {
    readonly ranges: readonly TreeSitterSyntaxRange[]
    readonly cancelled?: () => boolean
    readonly bounded?: boolean
  },
): ProjectedTree | null {
  const context = options.bounded === false ? null : isolatedContext(base, edits)
  const range = context?.range
  if (
    range &&
    options.ranges.every(
      (query) => query.startIndex >= range.startIndex && query.endIndex <= range.endIndex,
    )
  ) {
    const bounded = parseContext(parser, input, text, range, options.cancelled)
    if (!bounded) return null
    if (
      !bounded.rootNode.hasError &&
      context &&
      unchangedBoundary(context.before, bounded.rootNode.firstNamedChild) &&
      unchangedBoundary(context.after, bounded.rootNode.lastNamedChild)
    ) {
      return {
        tree: bounded,
        parentRange: {
          startIndex: base.rootNode.startIndex,
          endIndex: base.rootNode.endIndex + delta(edits),
        },
      }
    }
    bounded.delete()
    if (options.cancelled?.()) return null
  }
  const reusable = editReusableTree(base, edits)
  try {
    const tree = parser.parse(input, reusable, {
      includedRanges: [],
      progressCallback: options.cancelled,
    })
    return tree ? { tree } : null
  } finally {
    reusable.delete()
  }
}

function parseContext(
  parser: Parser,
  input: ParseCallback,
  text: TextReadSnapshot,
  range: TreeSitterSyntaxRange,
  cancelled?: () => boolean,
): Tree | null {
  const startRow = text.lineAt(range.startIndex)
  const endRow = text.lineAt(range.endIndex)
  return parser.parse(input, null, {
    includedRanges: [
      {
        ...range,
        startPosition: { row: startRow, column: range.startIndex - text.lineStart(startRow) },
        endPosition: { row: endRow, column: range.endIndex - text.lineStart(endRow) },
      },
    ],
    progressCallback: cancelled,
  })
}

type IsolatedContext = {
  readonly range: TreeSitterSyntaxRange
  readonly before: Node | null
  readonly after: Node | null
}

function isolatedContext(
  base: Tree,
  edits: readonly TreeSitterInputEdit[],
): IsolatedContext | null {
  if (!edits.length) return null
  const start = edits.reduce((value, edit) => Math.min(value, edit.startIndex), Infinity)
  const end = edits.reduce((value, edit) => Math.max(value, edit.oldEndIndex), 0)
  const root = base.rootNode
  const first = topLevelNode(root, start)
  const last = topLevelNode(root, Math.max(start, end - 1))
  if (!first || !last) return null
  // Recovery nodes can change when an adjacent edit repairs their missing delimiter.
  let before = first.previousNamedSibling
  while (before?.hasError) before = before.previousNamedSibling
  let after = last.nextNamedSibling
  while (after?.hasError) after = after.nextNamedSibling
  return {
    range: {
      startIndex: before?.startIndex ?? root.startIndex,
      endIndex: (after?.endIndex ?? root.endIndex) + delta(edits),
    },
    before,
    after,
  }
}

function delta(edits: readonly TreeSitterInputEdit[]): number {
  return edits.reduce((sum, edit) => sum + edit.newEndIndex - edit.oldEndIndex, 0)
}

function topLevelNode(root: Node, offset: number): Node | null {
  let node = root.namedDescendantForIndex(offset, offset)
  while (node?.parent && node.parent.id !== root.id) node = node.parent
  return node && node.id !== root.id ? node : null
}

function unchangedBoundary(before: Node | null, after: Node | null): boolean {
  return before === null || (after !== null && before.toString() === after.toString())
}
