import type { Node, Query, QueryMatch } from 'web-tree-sitter'
import type { TreeSitterMergeUnit, TreeSitterSyntaxRange } from './types'
import type { TextReadSnapshot } from '@singapore-editor/core/document'

const QUERY_OPTIONS = { maxStartDepth: 0, matchLimit: 128 }

export type MergeUnitQueryContext = {
  readonly analysis?: boolean
  readonly contentKey?: boolean
  readonly progressCallback?: () => boolean
  readonly parents?: Map<number, boolean>
  readonly matches?: Map<number, readonly QueryMatch[]>
}

export function enclosingMergeUnit(
  root: Node,
  query: Query,
  range: TreeSitterSyntaxRange,
  context: MergeUnitQueryContext = {},
): TreeSitterMergeUnit | null {
  let node: Node | null = root.namedDescendantForIndex(range.startIndex, range.endIndex)
  while (node) {
    if (context.progressCallback?.()) return null
    const unit = unitAt(node, query, range, context)
    if (unit) return unit
    node = node.parent
  }
  return null
}

export function touchingMergeUnits(
  root: Node,
  query: Query,
  range: TreeSitterSyntaxRange,
  context: MergeUnitQueryContext = {},
): readonly TreeSitterMergeUnit[] {
  if (range.endIndex - range.startIndex <= 1) {
    const unit = enclosingMergeUnit(root, query, range, context)
    return unit ? [unit] : []
  }
  const selected = root.descendantForIndex(range.startIndex, range.endIndex) ?? root
  const cursor = selected.walk()
  const units = new Map<string, TreeSitterMergeUnit>()
  const cached = { ...context, matches: new Map<number, readonly QueryMatch[]>() }
  let depth = 0
  try {
    for (;;) {
      if (context.progressCallback?.()) return []
      const node = cursor.currentNode
      const intersects = node.startIndex < range.endIndex && node.endIndex > range.startIndex
      if (intersects && cursor.gotoFirstChild()) {
        depth++
        continue
      }
      if (intersects && node.childCount === 0) {
        const unit = enclosingMergeUnit(
          root,
          query,
          {
            startIndex: Math.max(node.startIndex, range.startIndex),
            endIndex: Math.min(node.endIndex, range.endIndex),
          },
          cached,
        )
        if (unit) units.set(JSON.stringify([unit.type, unit.startIndex, unit.endIndex]), unit)
      }
      if (depth === 0) break
      if (cursor.gotoNextSibling()) continue
      while (cursor.gotoParent()) {
        depth--
        if (depth === 0 || cursor.gotoNextSibling()) break
      }
      if (depth === 0) break
    }
    return [...units.values()]
  } finally {
    cursor.delete()
  }
}

function unitAt(
  node: Node,
  query: Query,
  range: TreeSitterSyntaxRange,
  context: MergeUnitQueryContext = {},
): TreeSitterMergeUnit | null {
  let best: { node: Node; signature: string | null } | null = null
  let matches = context.matches?.get(node.id)
  if (!matches) {
    matches = query.matches(node, { ...QUERY_OPTIONS, progressCallback: context.progressCallback })
    if (!context.progressCallback?.()) context.matches?.set(node.id, matches)
  }
  for (const match of matches) {
    const unit = match.captures.find((capture) => capture.name === 'merge.unit')?.node
    if (!unit || unit.startIndex > range.startIndex || unit.endIndex < range.endIndex) continue
    if (!context.analysis && (unit.hasError || unit.isMissing)) continue
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
    ...(context.analysis
      ? {
          hasErrors: best.node.hasError || best.node.isMissing,
          ...(context.contentKey
            ? { contentKey: nodeContentKey(best.node, context.progressCallback) }
            : {}),
        }
      : {}),
    parent: parent
      ? {
          ...nodeRange(parent),
          commutative: parentEligibility(parent, query, context),
        }
      : null,
  }
}

function parentEligibility(parent: Node, query: Query, context: MergeUnitQueryContext): boolean {
  const cached = context.parents?.get(parent.id)
  if (cached !== undefined) return cached
  const value = commutativeParent(
    parent,
    query.matches(parent, {
      ...QUERY_OPTIONS,
      progressCallback: context.progressCallback,
    }),
  )
  if (!context.progressCallback?.()) context.parents?.set(parent.id, value)
  return value
}

function nodeContentKey(node: Node, cancelled?: () => boolean): string | undefined {
  const cursor = node.walk()
  const parts: string[] = []
  let depth = 0
  try {
    for (;;) {
      if (cancelled?.()) return undefined
      parts.push(cursor.nodeType)
      if (cursor.gotoFirstChild()) {
        depth++
        continue
      }
      parts.push(cursor.currentNode.text)
      if (depth === 0) return JSON.stringify(parts)
      if (cursor.gotoNextSibling()) continue
      while (cursor.gotoParent()) {
        depth--
        parts.push(')')
        if (depth === 0) return JSON.stringify(parts)
        if (cursor.gotoNextSibling()) break
      }
    }
  } finally {
    cursor.delete()
  }
}

function mergeRangeHasErrors(
  root: Node,
  range: TreeSitterSyntaxRange,
  cancelled?: () => boolean,
): boolean {
  const cursor = root.walk()
  let depth = 0
  try {
    for (;;) {
      if (cancelled?.()) return false
      const node = cursor.currentNode
      const intersects = node.endIndex >= range.startIndex && node.startIndex <= range.endIndex
      if (intersects && (node.isError || node.isMissing)) return true
      if (intersects && node.hasError && cursor.gotoFirstChild()) {
        depth++
        continue
      }
      if (depth === 0) return false
      if (cursor.gotoNextSibling()) continue
      while (cursor.gotoParent()) {
        depth--
        if (depth === 0) return false
        if (cursor.gotoNextSibling()) break
      }
    }
  } finally {
    cursor.delete()
  }
}

export function analyzeLineMergeUnit(
  root: Node,
  unit: TreeSitterMergeUnit,
  context: MergeUnitQueryContext,
): TreeSitterMergeUnit {
  return {
    ...unit,
    ...(context.analysis
      ? { hasErrors: mergeRangeHasErrors(root, unit, context.progressCallback) }
      : {}),
    ...(context.contentKey
      ? { contentKey: rangeContentKey(root, unit, context.progressCallback) }
      : {}),
  }
}

function rangeContentKey(
  root: Node,
  range: TreeSitterSyntaxRange,
  cancelled?: () => boolean,
): string | undefined {
  const cursor = root.walk()
  const parts: string[] = []
  let depth = 0
  try {
    for (;;) {
      if (cancelled?.()) return undefined
      const node = cursor.currentNode
      const intersects = node.startIndex < range.endIndex && node.endIndex > range.startIndex
      if (intersects) parts.push(node.type)
      if (intersects && cursor.gotoFirstChild()) {
        depth++
        continue
      }
      if (intersects && node.childCount === 0) {
        parts.push(
          node.text.slice(
            Math.max(0, range.startIndex - node.startIndex),
            range.endIndex - node.startIndex,
          ),
        )
      }
      if (depth === 0) return JSON.stringify(parts)
      if (cursor.gotoNextSibling()) continue
      while (cursor.gotoParent()) {
        depth--
        parts.push(')')
        if (depth === 0) return JSON.stringify(parts)
        if (cursor.gotoNextSibling()) break
      }
    }
  } finally {
    cursor.delete()
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
