import type { Root } from 'mdast'
import remarkCjkFriendlyGfmStrikethrough from 'remark-cjk-friendly-gfm-strikethrough'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import remarkParse from 'remark-parse'
import { unified, type PluggableList, type Processor } from 'unified'

import { remarkAttention } from './attention'
import { remarkCjkAutolinkBoundaries } from './cjk-autolinks'
import { remarkCodeMeta } from './code-meta'
import { remarkInlineCodeSource } from './inline-code-source'
import { remarkPositionedAutolinks } from './positioned-autolinks'
import { remarkTableRejection } from './table-rejection'

export type RemarkProcessor = Processor<Root, Root, Root, undefined, undefined>

/**
 * The parse and transform half of the pipeline. CJK emphasis has to be wired
 * before GFM and CJK strikethrough after it, which is why the order is fixed
 * here and consumers only append.
 */
export function createRemarkProcessor(remarkPlugins: PluggableList = []): RemarkProcessor {
  return unified()
    .use(remarkParse)
    .use(remarkAttention)
    .use(remarkGfm)
    .use(remarkTableRejection)
    .use(remarkPositionedAutolinks)
    .use(remarkMath, { singleDollarTextMath: false })
    .use(remarkCjkFriendlyGfmStrikethrough)
    .use(remarkCjkAutolinkBoundaries)
    .use(remarkCodeMeta)
    .use(remarkInlineCodeSource)
    .use(remarkPlugins) as unknown as RemarkProcessor
}
