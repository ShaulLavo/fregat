import type { Element, Root } from 'hast'
import { visit } from 'unist-util-visit'

import { MARKDOWN_ID_PREFIX } from './sanitize-schema'

/**
 * Presentation the pipeline owns. Applied after sanitization, since the schema
 * strips classes, and before component overrides, which receive these as
 * `className` and may merge or replace them.
 */
export const MARKDOWN_CLASS_NAMES: Readonly<Record<string, string>> = {
  a: 'wrap-anywhere font-medium text-primary underline',
  blockquote: 'my-4 border-l-4 border-muted-foreground/30 pl-4 text-muted-foreground italic',
  code: 'rounded-md bg-muted px-1.5 py-0.5 font-mono text-sm',
  h1: 'mt-6 mb-2 font-semibold text-3xl',
  h2: 'mt-6 mb-2 font-semibold text-2xl',
  h3: 'mt-6 mb-2 font-semibold text-xl',
  h4: 'mt-6 mb-2 font-semibold text-lg',
  h5: 'mt-6 mb-2 font-semibold text-base',
  h6: 'mt-6 mb-2 font-semibold text-sm',
  hr: 'my-6 h-px border-0 bg-muted',
  img: 'my-4 max-w-full rounded-lg',
  li: 'py-1 [&>p]:inline',
  ol: 'list-inside list-decimal whitespace-normal [li_&]:pl-6',
  pre: 'my-4 overflow-x-auto rounded-md bg-background p-4 text-sm',
  strong: 'font-semibold',
  sub: 'text-sm',
  sup: 'text-sm',
  table: 'w-full',
  tbody: '[&>tr:nth-child(even)]:bg-muted/40',
  td: 'px-4 py-2 text-sm',
  th: 'whitespace-nowrap px-4 py-2 text-left font-semibold text-sm',
  thead: 'bg-muted/80',
  ul: 'list-inside list-disc whitespace-normal [li_&]:pl-6',
}

const TABLE_WRAPPER_CLASS_NAME = 'my-4 overflow-x-auto rounded-md bg-background'

export function rehypeDecorate() {
  return (tree: Root) => {
    visit(tree, 'element', (node, index, parent) => {
      if (node.position) {
        node.properties.dataSourceLine = node.position.start.line
        node.properties.dataSourceEndLine = node.position.end.line
      }
      if (node.tagName === 'a' && node.properties.dataIncomplete) delete node.properties.href
      if (node.tagName === 'a') prefixFragmentHref(node)
      if (node.tagName === 'code' && parent?.type === 'element' && parent.tagName === 'pre') return
      if (node.tagName === 'table' && parent && typeof index === 'number') {
        parent.children[index] = wrapTable(node)
      }

      const className = MARKDOWN_CLASS_NAMES[node.tagName]
      if (className) node.properties.className = className.split(' ')
    })
  }
}

/** An in-document link follows its target's id through the sanitizer's prefix. */
function prefixFragmentHref(link: Element) {
  const href = link.properties.href
  if (typeof href !== 'string' || !href.startsWith('#') || href.length === 1) return
  if (href.startsWith(`#${MARKDOWN_ID_PREFIX}`)) return

  link.properties.href = `#${MARKDOWN_ID_PREFIX}${href.slice(1)}`
}

function wrapTable(table: Element): Element {
  return {
    type: 'element',
    tagName: 'div',
    properties: { className: TABLE_WRAPPER_CLASS_NAME.split(' ') },
    children: [table],
  }
}
