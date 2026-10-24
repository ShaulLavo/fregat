import { treeSitterMarkdownAssets } from '@workspace/markdown/utils/tree-sitter-runtime'

import { expect, test } from '../../../../test/fixtures'
import { createMarkdownBrowser } from '../../../../test/factories/markdown-browser'

test('production chat parses with the WASM assets owned by its renderer package', async () => {
  const proof = await createMarkdownBrowser({ sessionFactory: null })
  await proof.update('~_~a_~\n\n*~~a*~~\n\n*~~*a~~*', false)
  await expect.poll(() => proof.message().querySelectorAll('p').length).toBe(3)

  const paragraphs = Array.from(proof.message().querySelectorAll('p'), (node) =>
    node.outerHTML
      .replaceAll(/ data-source-line="\d+"/g, '')
      .replaceAll(/ data-source-end-line="\d+"/g, ''),
  )
  expect(paragraphs).toEqual([
    '<p>~_<del>a_</del></p>',
    '<p><em>~~a</em>~~</p>',
    '<p><em>~~</em>a~~*</p>',
  ])
  for (const [name, asset] of Object.entries(treeSitterMarkdownAssets)) {
    const url = new URL(asset, location.href).href
    expect(performance.getEntriesByName(url), name).not.toHaveLength(0)
  }
})
