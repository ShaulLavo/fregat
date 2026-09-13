import type { Root, RootContent } from 'mdast'
import type { PluggableList } from 'unified'

import {
  groupRootNodes,
  markStreamingTail,
  scanNodeFeatures,
  type MarkdownBlock,
  type NodeGroup,
} from './blocks'
import { endsInsideOpenFence } from './fence'
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

/** Definitions and footnotes reach across the whole document, so no prefix is ever settled. */
const LINK_DEFINITION = /^ {0,3}\[[^\]\n]*\]:/mu
const FOOTNOTE = /\[\^[^\]\n]+\]/u

/**
 * One session per rendered document. Every update parses only the text after
 * the last settled block, shifts the new nodes to absolute positions, and
 * settles everything but the final block. Settled blocks keep their nodes for
 * as long as the text still starts with their source.
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
    const suffix = text.slice(prefixEnd)
    if (!isIncrementallyParsable(suffix)) {
      settled = []
      return [parseWhole(processor, text, heal)]
    }

    const healed = heal ? healMarkdown(suffix) : suffix
    const fileValue = prefixEnd === 0 ? healed : text.slice(0, prefixEnd) + healed
    const children = parseSuffix(processor, healed, fileValue, prefixEnd, prefix?.endLine ?? 0)
    const groups = groupRootNodes(children, prefixEnd, fileValue.length)
    const settledCount = settledGroupCount(groups, text, healed, prefixEnd)
    for (const group of groups.slice(0, settledCount)) {
      settled.push(settledBlock(group, text, settled.at(-1)?.endLine ?? 0))
    }
    const tailGroups = groups.slice(settledCount)
    const tail = tailBlock(tailGroups, settled.at(-1)?.end ?? 0, fileValue)

    return [...settled, tail]
  }
}

function isIncrementallyParsable(suffix: string): boolean {
  if (suffix.includes('\r')) return false
  if (suffix.includes('\uFEFF')) return false
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

function parseSuffix(
  processor: RemarkProcessor,
  healed: string,
  fileValue: string,
  offset: number,
  lines: number,
): RootContent[] {
  const root = processor.parse(healed)
  if (offset > 0) shiftPositions(root, offset, lines)

  return transform(processor, root, fileValue).children
}

function transform(processor: RemarkProcessor, root: Root, fileValue: string): Root {
  return processor.runSync(root, fileValue)
}

function parseWhole(processor: RemarkProcessor, text: string, heal: boolean): MarkdownBlock {
  const healed = heal ? healMarkdown(text) : text
  const root = transform(processor, processor.parse(healed), healed)

  return tailBlock([{ end: healed.length, nodes: root.children, start: 0 }], 0, healed)
}

/**
 * Every group but the last is settled, unless healing rewrote text inside a
 * settled range: an escaped `~` or `>` is not in the source, and a block cached
 * from it would go stale the moment the stream ends and healing stops.
 */
function settledGroupCount(
  groups: NodeGroup[],
  text: string,
  healed: string,
  prefixEnd: number,
): number {
  const count = groups.length - 1
  if (count <= 0) return 0

  const settledEnd = groups[count - 1]?.end ?? prefixEnd
  const healedPrefix = healed.slice(0, settledEnd - prefixEnd)
  if (!text.startsWith(healedPrefix, prefixEnd)) return 0

  return count
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

function tailBlock(groups: NodeGroup[], start: number, fileValue: string): MarkdownBlock {
  const nodes = groups.flatMap((group) => group.nodes)
  markStreamingTail(nodes, fileValue)
  const features = scanNodeFeatures(nodes)
  const source = fileValue.slice(start)

  return {
    end: fileValue.length,
    endLine: 0,
    hasHtml: features.html,
    hasMath: features.math,
    key: start,
    lastNodeType: nodes.at(-1)?.type ?? null,
    nodes,
    openFence: endsInsideOpenFence(source),
    settled: false,
    source,
    start,
  }
}
