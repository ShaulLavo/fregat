import type { Node, Query, QueryMatch } from 'web-tree-sitter'
import type { TreeSitterMergeUnit, TreeSitterSyntaxRange } from './types'
import type { TextReadSnapshot } from '@singapore-editor/core/document'

const QUERY_OPTIONS = { maxStartDepth: 0, matchLimit: 128 }

export function enclosingMergeUnit(
  root: Node,
  query: Query,
  range: TreeSitterSyntaxRange,
): TreeSitterMergeUnit | null {
  let node: Node | null = root.namedDescendantForIndex(range.startIndex, range.endIndex)
  while (node) {
    const unit = unitAt(node, query, range)
    if (unit) return unit
    node = node.parent
  }
  return null
}

function unitAt(
  node: Node,
  query: Query,
  range: TreeSitterSyntaxRange,
): TreeSitterMergeUnit | null {
  let best: { node: Node; signature: string | null } | null = null
  for (const match of query.matches(node, QUERY_OPTIONS)) {
    const unit = match.captures.find((capture) => capture.name === 'merge.unit')?.node
    if (!unit || unit.startIndex > range.startIndex || unit.endIndex < range.endIndex) continue
    if (unit.hasError || unit.isMissing) continue
    if (best && unit.endIndex - unit.startIndex > best.node.endIndex - best.node.startIndex)
      continue
    const signature = match.captures.find((capture) => capture.name === 'merge.signature')?.node
    if (best?.node.id === unit.id && !signature) continue
    best = { node: unit, signature: signature?.text ?? null }
  }
  if (!best) return null
  const parent = best.node.parent
  return {
    source: 'syntax',
    ...nodeRange(best.node),
    signature: best.signature,
    parent: parent
      ? {
          ...nodeRange(parent),
          commutative: commutativeParent(parent, query.matches(parent, QUERY_OPTIONS)),
        }
      : null,
  }
}

function commutativeParent(parent: Node, matches: readonly QueryMatch[]): boolean {
  const membersByPattern = new Map<number, Set<number>>()
  for (const match of matches) {
    if (
      !match.captures.some(
        (capture) => capture.name === 'merge.commutative' && capture.node.id === parent.id,
      )
    )
      continue
    const members = match.captures.filter((capture) => capture.name === '_merge.member')
    if (members.length === 0) return true
    const ids = membersByPattern.get(match.patternIndex) ?? new Set<number>()
    for (const member of members) ids.add(member.node.id)
    membersByPattern.set(match.patternIndex, ids)
  }
  // Repeated query patterns can skip siblings, so require coverage of the entire parent.
  return [...membersByPattern.values()].some((ids) =>
    parent.namedChildren.every((child) => child.isExtra || ids.has(child.id)),
  )
}

function nodeRange(node: Node) {
  return { startIndex: node.startIndex, endIndex: node.endIndex, type: node.type }
}

export function lineMergeUnit(
  text: TextReadSnapshot,
  range: TreeSitterSyntaxRange,
): TreeSitterMergeUnit {
  const first = text.lineAt(range.startIndex)
  const last = text.lineAt(Math.max(range.startIndex, range.endIndex - 1))
  const lastLine = text.lineRange(last)
  let endIndex = lastLine.end
  if (last + 1 < text.lineCount) {
    // Line ranges exclude LF but include CR; keep CRLF together at unit boundaries.
    if (endIndex > lastLine.start && text.readRange(endIndex - 1, endIndex) === '\r') endIndex--
    if (range.endIndex > endIndex) endIndex = text.lineStart(last + 1)
  }
  return {
    source: 'line',
    type: 'line',
    startIndex: text.lineRange(first).start,
    endIndex,
    signature: null,
    parent: null,
  }
}
