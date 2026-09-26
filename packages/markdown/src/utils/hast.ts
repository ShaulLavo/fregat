import type { Element, Root as HastRoot } from 'hast'
import type { Root as MdastRoot } from 'mdast'
import { toHast } from 'mdast-util-to-hast'
import rehypeSanitize from 'rehype-sanitize'
import { unified, type Pluggable, type Processor } from 'unified'

import type { MarkdownBlock } from './blocks'
import { rehypeDecorate } from './decorate'
import { MARKDOWN_SANITIZE_SCHEMA } from './sanitize-schema'

/**
 * The two stages that cost real bytes, each present only once its library has
 * loaded. Raw HTML needs an HTML parser; math needs KaTeX. Until then raw HTML
 * is dropped by the sanitizer and math stays a code block.
 */
export type HastExtensions = {
  readonly math: Pluggable | null
  readonly raw: Pluggable | null
}

export type HastProcessor = Processor<undefined, HastRoot, HastRoot, undefined, undefined>

export function createHastProcessor(extensions: HastExtensions): HastProcessor {
  const processor = unified()
  if (extensions.raw) processor.use([extensions.raw])
  processor.use(rehypeSanitize, MARKDOWN_SANITIZE_SCHEMA)
  if (extensions.math) processor.use([extensions.math])
  processor.use(rehypeDecorate)

  return processor as unknown as HastProcessor
}

/** mdast → hast for one block. Sanitization is not a caller choice. */
export function blockToHast(block: MarkdownBlock, processor: HastProcessor): HastRoot {
  const root: MdastRoot = { type: 'root', children: [...block.nodes] }
  // Ids leave this stage bare: the sanitizer prefixes raw HTML and footnotes alike, once.
  const tree = processor.runSync(
    toHast(root, { allowDangerousHtml: true, clobberPrefix: '' }) as HastRoot,
  )
  // The hast root separates blocks with newline text nodes, which a
  // `whitespace-pre-wrap` consumer would paint as blank lines.
  tree.children = tree.children.filter(
    (child) => !(child.type === 'text' && child.value.trim().length === 0),
  )
  // Set after sanitization so raw HTML in the document cannot forge it.
  if (block.openFence) markLastFenceIncomplete(tree)

  return tree
}

function markLastFenceIncomplete(tree: HastRoot) {
  const code = lastFencedCode(tree)
  if (code) code.properties.dataIncomplete = 'true'
}

function lastFencedCode(node: HastRoot | Element): Element | null {
  for (let index = node.children.length - 1; index >= 0; index -= 1) {
    const child = node.children[index]
    if (child?.type !== 'element') continue
    if (child.tagName === 'pre') return child.children.find(isCode) ?? null

    const found = lastFencedCode(child)
    if (found) return found
  }

  return null
}

function isCode(node: Element['children'][number]): node is Element {
  return node.type === 'element' && node.tagName === 'code'
}
