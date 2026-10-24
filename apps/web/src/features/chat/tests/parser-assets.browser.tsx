import { treeSitterMarkdownAssets } from '@workspace/markdown/utils/tree-sitter-runtime'
import { onTestFinished, vi } from 'vitest'

import { expect, test } from '../../../../test/fixtures'
import { createMarkdownBrowser } from '../../../../test/factories/markdown-browser'

test('production chat parses with the WASM assets owned by its renderer package', async () => {
  const requests: string[] = []
  const originalFetch = globalThis.fetch
  const fetchBoundary = vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
    const request = typeof input === 'string' || input instanceof URL ? input : input.url
    requests.push(new URL(request, location.href).href)
    return originalFetch(input, init)
  })
  onTestFinished(() => fetchBoundary.mockRestore())
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
    expect(requests, name).toContain(url)
  }
})
