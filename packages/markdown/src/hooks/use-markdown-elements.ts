import { toJsxRuntime, type Components } from 'hast-util-to-jsx-runtime'
import { useState, type ReactNode } from 'react'
import { Fragment, jsx, jsxs } from 'react/jsx-runtime'

import type { MarkdownBlock } from '../utils/blocks'
import { blockToHast, type HastProcessor } from '../utils/hast'

export type MarkdownRenderOptions = {
  readonly components: Partial<Components>
  readonly processor: HastProcessor
}

type Rendered = {
  readonly element: ReactNode
  readonly options: MarkdownRenderOptions
}

/**
 * hast and JSX for each block, computed once per block object and render
 * options. A settled block keeps its element until the document drops it, so a
 * streamed token costs one block's conversion and one block's reconciliation.
 */
export function useMarkdownElements(
  blocks: readonly MarkdownBlock[],
  options: MarkdownRenderOptions,
): readonly ReactNode[] {
  const [cache] = useState(() => new WeakMap<MarkdownBlock, Rendered>())

  return blocks.map((block) => {
    const cached = cache.get(block)
    if (cached && cached.options === options) return cached.element

    const element = renderBlock(block, options)
    cache.set(block, { element, options })

    return element
  })
}

function renderBlock(block: MarkdownBlock, options: MarkdownRenderOptions): ReactNode {
  return toJsxRuntime(blockToHast(block, options.processor), {
    Fragment,
    components: options.components,
    ignoreInvalidStyle: true,
    jsx,
    jsxs,
    passKeys: true,
    passNode: true,
  })
}
