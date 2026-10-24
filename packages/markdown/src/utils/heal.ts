import type { Nodes, Paragraph, RootContent, Text } from 'mdast'

import { lastBlock, lastLeaf } from './hold'
import {
  beginRepair,
  copy,
  insert,
  rewrite,
  toAuthoredOffset,
  type TrackedText,
} from './repair-origin'
import { remendWithOrigins } from './remend-origin'

/**
 * Closes syntax the stream has not finished: `**bol` renders bold instead of
 * as literal asterisks. The caller keeps text that stops inside a fence away
 * from here, because remend would append the closers inside the code.
 */
export function healMarkdown(text: string): string {
  return remendWithOrigins(
    beginRepair({ text, start: toAuthoredOffset(0), point: { line: 1, column: 1, offset: 0 } }),
  ).text
}

export function visibleRepairIsLiteral(
  source: string,
  repaired: string,
  nodes: readonly RootContent[],
): boolean {
  if (!repaired.startsWith(source) || repaired === source) return false
  const suffix = repaired.slice(source.length)
  if (!/^[*_~`]+$/u.test(suffix)) return false
  const block = lastBlock(nodes)
  if (!block) return false
  const leaf = lastLeaf(block)
  return leaf.type === 'text' && leaf.value.endsWith(suffix)
}

/** Close an outer strong opener that remend left as text before completed nested content. */
export function nestedStrongRepair(fileValue: string, nodes: readonly RootContent[]) {
  const block = lastBlock(nodes)
  if (block?.type !== 'paragraph') return null
  let offset = block.position?.end.offset
  if (offset === undefined) return null
  let markers: string[] = []
  for (const [index, child] of block.children.entries()) {
    if (child.type !== 'text' || !hasNestedContent(block, index + 1)) continue
    markers = markers.concat(strongOpeners(fileValue, child))
  }
  if (markers.length === 0) return null
  while (offset > 0 && /\s/u.test(fileValue[offset - 1] ?? '')) offset -= 1
  let escapes = 0
  for (let cursor = offset - 1; fileValue[cursor] === '\\'; cursor -= 1) escapes += 1
  if (escapes % 2 === 1) offset -= 1
  return { offset, closers: markers.reverse().join('') }
}

export function insertedRepairIsLiteral(nodes: readonly RootContent[], start: number, end: number) {
  let pending: Nodes[] = Array.from(nodes)
  while (pending.length > 0) {
    const node = pending.pop()
    if (!node) continue
    const position = node.position
    if (
      'value' in node &&
      position &&
      (position.start.offset ?? end) < end &&
      (position.end.offset ?? start) > start
    )
      return true
    if ('children' in node) pending = pending.concat(node.children)
  }
  return false
}

function hasNestedContent(paragraph: Paragraph, start: number): boolean {
  return paragraph.children
    .slice(start)
    .some(
      (node) =>
        node.type === 'emphasis' ||
        node.type === 'strong' ||
        node.type === 'delete' ||
        node.type === 'inlineCode' ||
        node.type === 'link' ||
        node.type === 'image' ||
        node.type === 'inlineMath',
    )
}

function strongOpeners(fileValue: string, node: Text): string[] {
  const start = node.position?.start.offset
  const end = node.position?.end.offset
  if (start === undefined || end === undefined) return []
  const raw = fileValue.slice(start, end)
  const markers: string[] = []
  for (const match of raw.matchAll(/\*\*|__/gu)) {
    const marker = match[0]
    if (!strongCanOpen(fileValue, start + match.index, marker)) continue
    markers.push(marker)
  }
  return markers
}

function strongCanOpen(source: string, index: number, marker: string): boolean {
  const before = source[index - 1] ?? ''
  const after = source[index + 2] ?? ''
  if (!after || /\s/u.test(after) || before === marker[0] || after === marker[0]) return false
  let escapes = 0
  for (let cursor = index - 1; source[cursor] === '\\'; cursor -= 1) escapes += 1
  if (escapes % 2 === 1) return false
  const beforeBoundary = !before || /[\s\p{P}\p{S}]/u.test(before)
  if (marker === '__' && !beforeBoundary) return false
  return !/[\p{P}\p{S}]/u.test(after) || beforeBoundary
}

export function insertNestedCloser(
  input: TrackedText,
  repair: { readonly offset: number; readonly closers: string },
): TrackedText {
  const offset = repair.offset - input.window.start
  return rewrite({
    input,
    owner: 'nestedStrongRepair',
    site: 'nestedStrongRepair.close',
    parts: [copy(input, 0, offset), insert(input, repair.closers, offset), copy(input, offset)],
    expected: input.text.slice(0, offset) + repair.closers + input.text.slice(offset),
  })
}
