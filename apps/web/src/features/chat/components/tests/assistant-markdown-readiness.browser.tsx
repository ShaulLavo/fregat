import { treeSitterMarkdownAssets } from '@workspace/markdown/utils/tree-sitter-runtime'
import { onTestFinished, vi } from 'vitest'
import { page } from 'vitest/browser'

import { chatMarkdownQueryOptions } from '@/features/chat/state/markdown-session'
import { resourceQueryClient } from '@/lib/resources/state/query-client'
import { expect, test } from '../../../../../test/fixtures'
import { createMarkdownBrowser } from '../../../../../test/factories/markdown-browser'

const source = '  # Authored heading\n\nA **formatted** answer with `code` and 😀.\n\n'

test('authored text stays selectable through a failed grammar fetch and a successful retry', async () => {
  const entered = Promise.withResolvers<void>()
  const release = Promise.withResolvers<void>()
  const fetch = globalThis.fetch
  let held = false
  const chatGrammar = new URL(treeSitterMarkdownAssets.chatGrammar, location.href).href
  const boundary = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const request = typeof input === 'string' || input instanceof URL ? input : input.url
    if (!held && new URL(request, location.href).href === chatGrammar) {
      held = true
      entered.resolve()
      await release.promise
      return new Response(null, { status: 503 })
    }
    return fetch(input, init)
  })
  onTestFinished(() => {
    release.resolve()
    boundary.mockRestore()
    resourceQueryClient.removeQueries({
      queryKey: chatMarkdownQueryOptions().queryKey,
      exact: true,
    })
  })
  const proof = await createMarkdownBrowser({ sessionFactory: null })
  await proof.update(source, true)
  await entered.promise
  expect(proof.message().textContent).toBe(source)
  expect(proof.message().querySelector('strong')).toBeNull()
  expect(proof.message().querySelector('[role="status"]')).not.toBeNull()
  expectRawSelection(proof.message())

  release.resolve()
  await expect.element(page.getByRole('button', { name: 'Try again' })).toBeVisible()
  expect(proof.message().textContent).toContain(source)
  expectRawSelection(proof.message())

  await page.getByRole('button', { name: 'Try again' }).click()
  await expect.element(page.getByRole('heading', { name: 'Authored heading' })).toBeVisible()
  await expect.poll(() => proof.message().querySelector('strong')?.textContent).toBe('formatted')
  expect(proof.message().querySelector('[data-chat-markdown-raw]')).toBeNull()
  expect(proof.message().querySelector('[role="status"]')).toBeNull()
  expect(proof.message().querySelector('p')?.textContent).toBe(
    'A formatted answer with code and 😀.',
  )
  const strong = proof.message().querySelector('strong')
  expect(strong).not.toBeNull()
  if (!strong) return
  const selection = window.getSelection()
  const range = document.createRange()
  range.selectNode(strong)
  selection?.removeAllRanges()
  selection?.addRange(range)
  const clipboardData = new DataTransfer()
  const copy = new ClipboardEvent('copy', { bubbles: true, cancelable: true, clipboardData })
  strong.dispatchEvent(copy)
  expect(copy.defaultPrevented).toBe(true)
  expect(clipboardData.getData('text/plain')).toBe('**formatted**')
  expect(clipboardData.getData('text/html')).toMatch(/<strong\b[^>]*>formatted<\/strong>/u)
  selection?.removeAllRanges()
  const candidate = await import('@workspace/markdown/utils/tree-sitter-session')
  expect(resourceQueryClient.getQueryData(chatMarkdownQueryOptions().queryKey)?.createSession).toBe(
    candidate.createTreeSitterMarkdownSession,
  )
})

function expectRawSelection(message: Element) {
  const raw = message.querySelector('[data-chat-markdown-raw]')
  expect(raw).not.toBeNull()
  if (!raw) return
  expect(raw.textContent).toBe(source)
  expect(getComputedStyle(raw).whiteSpace).toBe('pre-wrap')
  const selection = window.getSelection()
  const range = document.createRange()
  range.selectNodeContents(raw)
  selection?.removeAllRanges()
  selection?.addRange(range)
  expect(selection?.getRangeAt(0).toString()).toBe(source)
  expect(selection?.toString()).toContain('**formatted** answer with `code` and 😀.')
  const event = new ClipboardEvent('copy', { bubbles: true, cancelable: true })
  raw.dispatchEvent(event)
  expect(event.defaultPrevented).toBe(false)
  selection?.removeAllRanges()
}
