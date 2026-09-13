import type { Root as HastRoot } from 'hast'
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
  const tree = toHast(root, { allowDangerousHtml: true }) as HastRoot

  return processor.runSync(tree)
}
