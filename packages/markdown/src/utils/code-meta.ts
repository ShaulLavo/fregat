import type { Root } from 'mdast'
import { visit } from 'unist-util-visit'

/**
 * The fence metastring rides on the `code` element as a property. Element
 * `data` would be simpler, but the raw HTML stage rebuilds elements and drops
 * it; a property survives as an attribute.
 */
export function remarkCodeMeta() {
  return (tree: Root) => {
    visit(tree, 'code', (node) => {
      if (!node.meta) return

      const data = node.data ?? {}
      node.data = { ...data, hProperties: { ...data.hProperties, dataMeta: node.meta } }
    })
  }
}
