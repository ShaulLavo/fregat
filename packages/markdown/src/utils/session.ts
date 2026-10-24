import type { Nodes, Root, RootContent } from 'mdast'
import type { PluggableList } from 'unified'

import {
  endsInUnclosedFence,
  groupRootNodes,
  publishBlock,
  retainBlockSources,
  markIncompleteLinks,
  scanNodeFeatures,
  type MarkdownBlock,
  type NodeGroup,
} from './blocks'
import {
  insertNestedCloser,
  insertedRepairIsLiteral,
  nestedStrongRepair,
  visibleRepairIsLiteral,
} from './heal'
import { holdTail } from './hold'
import {
  countLines,
  resolveParsedPositions,
  resolvePositions,
  shiftPositions,
  sourcePoint,
} from './positions'
import { beginRepair, toAuthoredOffset, type TrackedText } from './repair-origin'
import { remendWithOrigins } from './remend-origin'
import { createRemarkProcessor } from './processor'
import { captureCodeSources } from './inline-code-source'

export type MarkdownSessionOptions = {
  readonly remarkPlugins?: PluggableList
  readonly processor?: MarkdownParser
}

export type MarkdownParser = {
  parse(text: string): Root
  runSync(root: Root, fileValue: string): Root
}

export type MarkdownUpdateOptions = {
  /** Hold or close unfinished syntax at the tail. On for a stream, off for a settled document. */
  readonly heal: boolean
}

export type MarkdownSession = {
  update(text: string, options: MarkdownUpdateOptions): readonly MarkdownBlock[]
}

export type MarkdownSessionFactory = (options?: MarkdownSessionOptions) => MarkdownSession

type LastUpdate = {
  readonly blocks: readonly MarkdownBlock[]
  readonly heal: boolean
  readonly text: string
}

type Tail = {
  readonly input: TrackedText
  readonly fileValue: string
  readonly nodes: RootContent[]
  readonly start: number
}

/** Definitions and footnotes reach across the whole document, so no prefix is ever settled. */
const FOOTNOTE = /\[\^[^\]\n]+\]/u

/**
 * One session per rendered document. Every update parses only the text after
 * the last settled block, shifts the new nodes to absolute positions, and
 * settles everything but the final block. Settled blocks keep their nodes for
 * as long as the text still starts with their source.
 *
 * Healing happens after settling and only to the final block: the settled
 * text is always the author's, so a block never goes stale when the stream
 * ends and healing stops.
 */
export function createMarkdownSession(options: MarkdownSessionOptions = {}): MarkdownSession {
  const processor = options.processor ?? createRemarkProcessor(options.remarkPlugins)
  let settled: MarkdownBlock[] = []
  let last: LastUpdate | null = null

  return {
    update(text, { heal }) {
      if (last && last.text === text && last.heal === heal) return last.blocks

      if (text.length === 0) settled = []
      const blocks = text.length === 0 ? [] : parse(text, heal)
      last = { blocks, heal, text }

      return blocks
    },
  }

  function parse(text: string, heal: boolean): readonly MarkdownBlock[] {
    const edited = last !== null && !text.startsWith(last.text)
    const truncated = last !== null && text.length < last.text.length && last.text.startsWith(text)
    settled = reusableBlocks(settled, text, edited, truncated)
    let prefix = settled.at(-1)
    let prefixEnd = prefix?.end ?? 0
    if (!isIncrementallyParsable(text.slice(prefixEnd))) {
      settled = []
      return [wholeDocument(processor, text, heal)]
    }
    if (hasDefinition(settled)) {
      settled = []
      return [wholeDocument(processor, text, heal)]
    }

    let children = parseFrom(processor, text, prefixEnd, prefix?.endLine ?? 0)
    if (children.length === 0 && prefix) {
      // Without a following node, the last settled block becomes the tail.
      settled.pop()
      prefix = settled.at(-1)
      prefixEnd = prefix?.end ?? 0
      children = parseFrom(processor, text, prefixEnd, prefix?.endLine ?? 0)
    }
    if (containsDefinition(children)) {
      settled = []
      return [wholeDocument(processor, text, heal)]
    }
    const groups = groupRootNodes(children, prefixEnd, text.length)
    for (const group of groups.slice(0, -1)) {
      settled.push(settledBlock(group, text, settled.at(-1)?.endLine ?? 0))
    }
    const tailStart = settled.at(-1)?.end ?? prefixEnd
    const tail: Tail = {
      input: identityInput(text, tailStart),
      fileValue: text,
      nodes: groups.at(-1)?.nodes ?? [],
      start: tailStart,
    }
    const tailLine = (prefix?.endLine ?? 0) + countLines(text.slice(prefixEnd, tailStart))

    return settled.concat([tailBlock(heal ? healedTail(processor, tail, tailLine) : tail, heal)])
  }
}

function isIncrementallyParsable(suffix: string): boolean {
  if (suffix.includes('\r')) return false
  if (suffix.includes('﻿')) return false

  return !FOOTNOTE.test(suffix)
}

function hasDefinition(blocks: readonly MarkdownBlock[]): boolean {
  return blocks.some((block) => containsDefinition(block.nodes))
}

function containsDefinition(nodes: readonly Nodes[]): boolean {
  for (const node of nodes) {
    if (node.type === 'definition') return true
    if (!('children' in node)) continue
    if (containsDefinition(node.children)) return true
  }

  return false
}

/** Edits can change the previous block through lazy continuation or table delimiters. */
function reusableBlocks(
  blocks: MarkdownBlock[],
  text: string,
  edited: boolean,
  truncated: boolean,
): MarkdownBlock[] {
  let count = 0
  for (const block of blocks) {
    if (!text.startsWith(block.source, block.start)) break
    count += 1
  }
  // Trimming a block's trailing separator leaves its preceding boundary unchanged.
  const truncatedBlockEnd = truncated
    ? blocks[count]?.nodes.at(-1)?.position?.end.offset
    : undefined
  const separatedTail =
    truncated && count === blocks.length && blocks.at(-1)?.source.endsWith('\n\n')
  if (
    edited &&
    !separatedTail &&
    (truncatedBlockEnd === undefined || text.length < truncatedBlockEnd)
  )
    count = Math.max(0, count - 1)
  if (count === blocks.length) return blocks

  return blocks.slice(0, count)
}

/** Parses `fileValue` from `offset`, a line start, and reports absolute positions. */
function parseFrom(
  processor: MarkdownParser,
  fileValue: string,
  offset: number,
  lines: number,
): RootContent[] {
  const suffix = fileValue.slice(offset)
  const root = processor.parse(suffix)
  resolveParsedPositions(root, suffix)
  if (offset > 0) shiftPositions(root, offset, lines)

  const sources = captureCodeSources(root)
  const transformed = transform(processor, root, fileValue)
  retainBlockSources(transformed.children, sources)
  return transformed.children
}

function transform(processor: MarkdownParser, root: Root, fileValue: string): Root {
  const transformed = processor.runSync(root, fileValue)
  resolvePositions(transformed, fileValue)
  return transformed
}

function wholeDocument(processor: MarkdownParser, text: string, heal: boolean): MarkdownBlock {
  const tail: Tail = {
    input: identityInput(text, 0),
    fileValue: text,
    nodes: parseFrom(processor, text, 0, 0),
    start: 0,
  }

  return tailBlock(heal ? healedTail(processor, tail, 0) : tail, heal)
}

/**
 * Re-parses the tail with an ambiguous trailing construct held back and
 * unfinished syntax closed. Text that stops inside a fence is left alone: the
 * only place a closer could go is inside the code.
 */
function healedTail(processor: MarkdownParser, tail: Tail, line: number): Tail {
  if (endsInUnclosedFence(tail.nodes, tail.fileValue)) return tail

  const source = tail.fileValue.slice(tail.start)
  const held = holdTail(tail.input, tail.nodes)
  const healed = remendWithOrigins(held)
  let prepared = healed.text === source ? tail : parseTail(processor, tail, healed, line)
  if (visibleTailRepairIsLiteral(held.text, healed.text, prepared.nodes))
    prepared = parseTail(processor, tail, held, line)
  const repair = nestedStrongRepair(prepared.fileValue, prepared.nodes)
  if (!repair) return prepared
  const repaired = insertNestedCloser(prepared.input, repair)
  const result = parseTail(processor, prepared, repaired, line)
  return insertedRepairIsLiteral(result.nodes, repair.offset, repair.offset + repair.closers.length)
    ? prepared
    : result
}

function visibleTailRepairIsLiteral(
  source: string,
  repaired: string,
  nodes: readonly RootContent[],
): boolean {
  if (visibleRepairIsLiteral(source, repaired, nodes)) return true
  if (!repaired.startsWith(source)) return false
  const suffix = repaired.slice(source.length)
  if (!/^[*_~`]+$/u.test(suffix)) return false
  const leaf = lastAuthoredLeaf(nodes.at(-1))
  return leaf?.type === 'text' && leaf.value.endsWith(suffix)
}

function lastAuthoredLeaf(node: Nodes | undefined): Nodes | undefined {
  if (!node || !('children' in node)) return node
  // Padded table cells have no source and cannot hide an appended literal marker.
  const child = node.children.findLast(
    (entry) =>
      entry.type !== 'tableCell' || entry.position !== undefined || entry.children.length > 0,
  )
  return child ? lastAuthoredLeaf(child) : node
}

function parseTail(processor: MarkdownParser, tail: Tail, input: TrackedText, line: number): Tail {
  const fileValue = tail.fileValue.slice(0, tail.start) + input.text
  return {
    input,
    fileValue,
    nodes: parseFrom(processor, fileValue, tail.start, line),
    start: tail.start,
  }
}

function settledBlock(group: NodeGroup, text: string, lineBefore: number): MarkdownBlock {
  const source = text.slice(group.start, group.end)
  const features = scanNodeFeatures(group.nodes)

  return publishBlock(identityInput(text, group.start, group.end), group.nodes, {
    endLine: lineBefore + countLines(source),
    hasHtml: features.html,
    hasMath: features.math,
    key: group.start,
    lastNodeType: group.nodes.at(-1)?.type ?? null,
    openFence: false,
    settled: true,
  })
}

function tailBlock({ input, fileValue, nodes, start }: Tail, streaming: boolean): MarkdownBlock {
  if (streaming) markIncompleteLinks(nodes)
  const features = scanNodeFeatures(nodes)

  return publishBlock(input, nodes, {
    endLine: 0,
    hasHtml: features.html,
    hasMath: features.math,
    key: start,
    lastNodeType: nodes.at(-1)?.type ?? null,
    openFence: streaming && endsInUnclosedFence(nodes, fileValue),
    settled: false,
  })
}

function identityInput(fileValue: string, start: number, end = fileValue.length): TrackedText {
  return beginRepair({
    text: fileValue.slice(start, end),
    start: toAuthoredOffset(start),
    point: sourcePoint(fileValue, start),
  })
}
