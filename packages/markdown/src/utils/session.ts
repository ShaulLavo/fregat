import type { Root, RootContent } from 'mdast'
import type { PluggableList } from 'unified'

import {
  endsInUnclosedFence,
  groupRootNodes,
  markIncompleteLinks,
  scanNodeFeatures,
  type MarkdownBlock,
  type NodeGroup,
} from './blocks'
import { healMarkdown } from './heal'
import { countLines, shiftPositions } from './positions'
import { createRemarkProcessor, type RemarkProcessor } from './processor'

export type MarkdownSessionOptions = {
  readonly remarkPlugins?: PluggableList
}

export type MarkdownUpdateOptions = {
  /** Close unfinished syntax at the tail. On for a stream, off for a settled document. */
  readonly heal: boolean
}

export type MarkdownSession = {
  update(text: string, options: MarkdownUpdateOptions): readonly MarkdownBlock[]
}

type LastUpdate = {
  readonly blocks: readonly MarkdownBlock[]
  readonly heal: boolean
  readonly text: string
}

type Tail = {
  readonly fileValue: string
  readonly nodes: RootContent[]
  readonly start: number
}

/** Definitions and footnotes reach across the whole document, so no prefix is ever settled. */
const LINK_DEFINITION = /^ {0,3}\[[^\]\n]*\]:/mu
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
  const processor = createRemarkProcessor(options.remarkPlugins)
  let settled: MarkdownBlock[] = []
  let last: LastUpdate | null = null

  return {
    update(text, { heal }) {
      if (last && last.text === text && last.heal === heal) return last.blocks

      const blocks = text.length === 0 ? [] : parse(text, heal)
      last = { blocks, heal, text }

      return blocks
    },
  }

  function parse(text: string, heal: boolean): readonly MarkdownBlock[] {
    settled = reusableBlocks(settled, text)
    const prefix = settled.at(-1)
    const prefixEnd = prefix?.end ?? 0
    if (!isIncrementallyParsable(text.slice(prefixEnd))) {
      settled = []
      return [wholeDocument(processor, text, heal)]
    }

    const children = parseFrom(processor, text, prefixEnd, prefix?.endLine ?? 0)
    const groups = groupRootNodes(children, prefixEnd, text.length)
    for (const group of groups.slice(0, -1)) {
      settled.push(settledBlock(group, text, settled.at(-1)?.endLine ?? 0))
    }
    const tailStart = settled.at(-1)?.end ?? prefixEnd
    const tail: Tail = { fileValue: text, nodes: groups.at(-1)?.nodes ?? [], start: tailStart }
    const tailLine = (prefix?.endLine ?? 0) + countLines(text.slice(prefixEnd, tailStart))

    return [...settled, tailBlock(heal ? healedTail(processor, tail, tailLine) : tail, heal)]
  }
}

function isIncrementallyParsable(suffix: string): boolean {
  if (suffix.includes('\r')) return false
  if (suffix.includes('﻿')) return false
  if (LINK_DEFINITION.test(suffix)) return false

  return !FOOTNOTE.test(suffix)
}

/** The longest run of settled blocks whose source the text still starts with. */
function reusableBlocks(blocks: MarkdownBlock[], text: string): MarkdownBlock[] {
  let count = 0
  for (const block of blocks) {
    if (!text.startsWith(block.source, block.start)) break
    count += 1
  }
  if (count === blocks.length) return blocks

  return blocks.slice(0, count)
}

/** Parses `fileValue` from `offset`, a line start, and reports absolute positions. */
function parseFrom(
  processor: RemarkProcessor,
  fileValue: string,
  offset: number,
  lines: number,
): RootContent[] {
  const root = processor.parse(fileValue.slice(offset))
  if (offset > 0) shiftPositions(root, offset, lines)

  return transform(processor, root, fileValue).children
}

function transform(processor: RemarkProcessor, root: Root, fileValue: string): Root {
  return processor.runSync(root, fileValue)
}

function wholeDocument(processor: RemarkProcessor, text: string, heal: boolean): MarkdownBlock {
  const tail: Tail = { fileValue: text, nodes: parseFrom(processor, text, 0, 0), start: 0 }

  return tailBlock(heal ? healedTail(processor, tail, 0) : tail, heal)
}

/**
 * Re-parses the tail with unfinished syntax closed. Text that stops inside a
 * fence is left alone: the only place a closer could go is inside the code.
 */
function healedTail(processor: RemarkProcessor, tail: Tail, line: number): Tail {
  if (endsInUnclosedFence(tail.nodes, tail.fileValue)) return tail

  const source = tail.fileValue.slice(tail.start)
  const healed = healMarkdown(source)
  if (healed === source) return tail

  const fileValue = tail.fileValue.slice(0, tail.start) + healed

  return { fileValue, nodes: parseFrom(processor, fileValue, tail.start, line), start: tail.start }
}

function settledBlock(group: NodeGroup, text: string, lineBefore: number): MarkdownBlock {
  const source = text.slice(group.start, group.end)
  const features = scanNodeFeatures(group.nodes)

  return {
    end: group.end,
    endLine: lineBefore + countLines(source),
    hasHtml: features.html,
    hasMath: features.math,
    key: group.start,
    lastNodeType: group.nodes.at(-1)?.type ?? null,
    nodes: group.nodes,
    openFence: false,
    settled: true,
    source,
    start: group.start,
  }
}

function tailBlock({ fileValue, nodes, start }: Tail, streaming: boolean): MarkdownBlock {
  if (streaming) markIncompleteLinks(nodes)
  const features = scanNodeFeatures(nodes)

  return {
    end: fileValue.length,
    endLine: 0,
    hasHtml: features.html,
    hasMath: features.math,
    key: start,
    lastNodeType: nodes.at(-1)?.type ?? null,
    nodes,
    openFence: streaming && endsInUnclosedFence(nodes, fileValue),
    settled: false,
    source: fileValue.slice(start),
    start,
  }
}
