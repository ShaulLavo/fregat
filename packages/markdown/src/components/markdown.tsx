import type { Components } from 'hast-util-to-jsx-runtime'
import { Fragment, type ComponentType } from 'react'
import type { PluggableList } from 'unified'

import { useMarkdownBlocks } from '../hooks/use-markdown-blocks'
import { useMarkdownElements, type MarkdownRenderOptions } from '../hooks/use-markdown-elements'
import { useMarkdownExtensions } from '../hooks/use-markdown-extensions'
import { MarkdownRenderContext, type MarkdownCodeBlockProps } from '../providers/render-context'
import type { MarkdownBlock } from '../utils/blocks'
import { createHastProcessor } from '../utils/hast'
import { MarkdownPre } from './markdown-pre'

/** Overrides per element. `pre` is owned by the pipeline; fences go through `codeBlock`. */
export type MarkdownComponents = Omit<Partial<Components>, 'pre'>

export type MarkdownProps = {
  /** Show a caret after the last block while streaming. */
  readonly caret?: boolean
  readonly className?: string
  readonly codeBlock?: ComponentType<MarkdownCodeBlockProps>
  readonly components?: MarkdownComponents
  /** Transforms appended after GFM, math and CJK. Keep the identity stable: a new list is a new parser. */
  readonly remarkPlugins?: PluggableList
  /** Heals unfinished syntax and marks the tail as still being written. */
  readonly streaming?: boolean
  readonly text: string
}

const ROOT_CLASS_NAME = 'space-y-4 [&>*:first-child]:mt-0 [&>*:last-child]:mb-0'
const CARET_CLASS_NAME =
  "[&>*:last-child]:after:inline [&>*:last-child]:after:align-baseline [&>*:last-child]:after:content-['_▋']"

const NO_COMPONENTS: MarkdownComponents = {}

export function Markdown({
  caret = false,
  className,
  codeBlock,
  components = NO_COMPONENTS,
  remarkPlugins,
  streaming = false,
  text,
}: MarkdownProps) {
  const blocks = useMarkdownBlocks(text, { heal: streaming, remarkPlugins })
  const extensions = useMarkdownExtensions(blocks)
  // Identity is the block render cache key: rebuilt only when a stage loads or
  // the consumer's overrides change.
  const options: MarkdownRenderOptions = {
    components: { ...components, pre: MarkdownPre },
    processor: createHastProcessor(extensions),
  }
  const elements = useMarkdownElements(blocks, options)
  const renderState = { codeBlock: codeBlock ?? null }
  const showCaret = caret && streaming && caretFits(blocks.at(-1))

  return (
    <MarkdownRenderContext value={renderState}>
      <div className={joinClassNames(ROOT_CLASS_NAME, showCaret && CARET_CLASS_NAME, className)}>
        {blocks.length === 0 && showCaret ? <span /> : null}
        {blocks.map((block, index) => (
          <Fragment key={block.key}>{elements[index]}</Fragment>
        ))}
      </div>
    </MarkdownRenderContext>
  )
}

/** A caret inside an open fence or a table row would land inside the code or the cell. */
function caretFits(tail: MarkdownBlock | undefined) {
  if (!tail) return true
  if (tail.openFence) return false

  return tail.lastNodeType !== 'table'
}

function joinClassNames(...classNames: readonly (string | false | undefined)[]) {
  return classNames.filter(Boolean).join(' ')
}
