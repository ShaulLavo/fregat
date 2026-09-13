import type { Code, Link, Nodes, RootContent } from 'mdast'

import { isUnclosedFencedCode } from './fence'
import { trackOpenHtmlTags } from './html-tags'
import { nodeLineStart } from './positions'

/**
 * A run of top-level nodes rendered as one unit. Settled blocks are immutable:
 * their source can only be extended after them, never changed, so their nodes
 * and their rendered output are reused for the rest of the message.
 */
export type MarkdownBlock = {
  /** Start offset in the source; stable for a settled block, so it doubles as the React key. */
  readonly key: number
  readonly start: number
  /** Exclusive end offset. The tail block always ends at the end of the text. */
  readonly end: number
  /** Newlines in the text before `end`, for shifting suffix positions. */
  readonly endLine: number
  readonly source: string
  /** Transformed mdast, ready for the hast stage. */
  readonly nodes: readonly RootContent[]
  readonly settled: boolean
  readonly hasHtml: boolean
  readonly hasMath: boolean
  /** The tail ends inside a fence that has not closed yet. */
  readonly openFence: boolean
  readonly lastNodeType: string | null
}

export type NodeGroup = {
  readonly nodes: RootContent[]
  readonly start: number
  readonly end: number
}

/**
 * Cuts root children into groups at boundaries where no raw HTML tag is left
 * open. Every boundary is a line start, so a group's source always parses the
 * same on its own as it did in context.
 */
export function groupRootNodes(children: RootContent[], start: number, end: number): NodeGroup[] {
  const groups: NodeGroup[] = []
  const openTags: string[] = []
  let current: RootContent[] = []
  let currentStart = start

  for (const node of children) {
    const lineStart = nodeLineStart(node)
    const canSplit = current.length > 0 && openTags.length === 0 && lineStart !== null
    if (canSplit && lineStart !== null) {
      groups.push({ nodes: current, start: currentStart, end: lineStart })
      current = []
      currentStart = lineStart
    }
    current.push(node)
    if (node.type === 'html') trackOpenHtmlTags(openTags, node.value)
  }
  if (current.length > 0) groups.push({ nodes: current, start: currentStart, end })

  return groups
}

export type NodeFeatures = {
  readonly html: boolean
  readonly math: boolean
}

/** Which deferred rendering stages a group of nodes needs. */
export function scanNodeFeatures(nodes: readonly RootContent[]): NodeFeatures {
  const found = { html: false, math: false }
  for (const node of nodes) scanNode(node, found)

  return found
}

function scanNode(node: Nodes, found: { html: boolean; math: boolean }) {
  if (node.type === 'html') found.html = true
  if (node.type === 'math' || node.type === 'inlineMath') found.math = true
  if (found.html && found.math) return
  if (!('children' in node)) return

  for (const child of node.children) scanNode(child, found)
}

/** The placeholder destination the healer gives a link whose URL has not arrived. */
const INCOMPLETE_LINK_URL = 'streamdown:incomplete-link'

/**
 * The tail is the only block the stream is still writing. A fence with no
 * closing line and a link with no destination yet are flagged as properties so
 * renderers can treat them as unfinished rather than broken.
 */
export function markStreamingTail(nodes: readonly RootContent[], text: string): void {
  const contentEnd = text.trimEnd().length
  for (const node of nodes) markNode(node, text, contentEnd)
}

function markNode(node: Nodes, text: string, contentEnd: number) {
  if (node.type === 'code') {
    markCode(node, text, contentEnd)
    return
  }
  if (node.type === 'link') markLink(node)
  if (!('children' in node)) return

  for (const child of node.children) markNode(child, text, contentEnd)
}

function markCode(node: Code, text: string, contentEnd: number) {
  const start = node.position?.start.offset
  const end = node.position?.end.offset
  if (start === undefined || end === undefined || end < contentEnd) return
  if (!isUnclosedFencedCode(text.slice(start, end))) return

  markIncomplete(node)
}

function markLink(node: Link) {
  if (node.url !== INCOMPLETE_LINK_URL) return

  node.url = ''
  markIncomplete(node)
}

function markIncomplete(node: Code | Link) {
  const data = node.data ?? {}
  node.data = { ...data, hProperties: { ...data.hProperties, dataIncomplete: 'true' } }
}
