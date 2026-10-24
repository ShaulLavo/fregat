import type { Nodes, Root } from 'hast'
import assert from 'node:assert/strict'
import { toHast } from 'mdast-util-to-hast'
import type { Root as MarkdownRoot } from 'mdast'
import rehypeRaw from 'rehype-raw'
import remarkGfm from 'remark-gfm'
import remarkParse from 'remark-parse'
import { unified } from 'unified'

type CanonicalNode = {
  readonly kind: string
  readonly value?: string
  readonly tag?: string
  readonly properties?: Readonly<Record<string, unknown>>
  readonly children?: readonly CanonicalNode[]
}

const htmlProcessor = unified().use(rehypeRaw)
const commonmark = unified().use(remarkParse)
const gfm = unified().use(remarkParse).use(remarkGfm)

export function referenceOutput(source: string, profile: 'commonmark' | 'gfm') {
  const processor = profile === 'gfm' ? gfm : commonmark
  const markdown = processor.runSync(processor.parse(source)) as MarkdownRoot
  return canonicalMarkdownOutput(markdown)
}

export function canonicalMarkdownOutput(markdown: MarkdownRoot) {
  const tree = toHast(markdown, { allowDangerousHtml: true, clobberPrefix: '' })
  assert(tree.type === 'root', 'A Markdown root must render to an HTML root')
  const last = tree.children.at(-1)
  if (last && !(last.type === 'raw' && last.value.endsWith('\n'))) {
    tree.children.push({ type: 'text', value: '\n' })
  }
  return canonicalHtml(htmlProcessor.runSync(tree) as Root)
}

export function expectedOutput(html: string) {
  const tree: Root = { type: 'root', children: [{ type: 'raw', value: html }] }
  return canonicalHtml(htmlProcessor.runSync(tree) as Root)
}

function canonicalHtml(node: Nodes): CanonicalNode {
  if (node.type === 'text' || node.type === 'comment') return { kind: node.type, value: node.value }
  if (node.type === 'doctype') return { kind: node.type }
  if (node.type === 'raw') return { kind: node.type, value: node.value }
  if (node.type === 'root') {
    const children = node.children.filter(
      (child) => child.type !== 'text' || !/^[\t\r\n ]+$/u.test(child.value),
    )
    return { kind: 'root', children: canonicalChildren(children) }
  }

  assert(node.type === 'element', 'The specification oracle only consumes HTML nodes')
  const properties = Object.fromEntries(
    Object.keys(node.properties)
      .sort()
      .map((key) => [key, node.properties[key]]),
  )
  return {
    kind: 'element',
    tag: node.tagName,
    properties,
    children: canonicalChildren(node.children, node.tagName),
  }
}

const TABLE_CONTAINERS = new Set(['table', 'thead', 'tbody', 'tfoot', 'tr'])

function canonicalChildren(
  children: readonly Nodes[],
  parentTag?: string,
): readonly CanonicalNode[] {
  const result: CanonicalNode[] = []
  for (const child of children) {
    if (child.type === 'text' && child.value.length === 0) continue
    if (
      parentTag &&
      TABLE_CONTAINERS.has(parentTag) &&
      child.type === 'text' &&
      /^[\t\r\n ]+$/u.test(child.value)
    )
      continue
    const value = canonicalHtml(child)
    const previous = result.at(-1)
    if (value.kind === 'text' && previous?.kind === 'text') {
      result[result.length - 1] = {
        kind: 'text',
        value: (previous.value ?? '') + (value.value ?? ''),
      }
      continue
    }
    result.push(value)
  }
  return result
}
