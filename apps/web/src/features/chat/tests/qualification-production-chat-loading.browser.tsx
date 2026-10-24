import { treeSitterMarkdownAssets as assets } from '@workspace/markdown/utils/tree-sitter-runtime'
import { onTestFinished } from 'vitest'
import { commands } from 'vitest/browser'

import { chatMarkdownQueryOptions } from '@/features/chat/state/markdown-session'
import { chatMarkdownQueryKeys } from '@/features/chat/utils/query-keys'
import { chatMutationKeys } from '@/features/chat/utils/mutation-keys'
import { resourceQueryClient } from '@/lib/resources/state/query-client'
import { expect, test } from '../../../../test/fixtures'
import { createMarkdownBrowser } from '../../../../test/factories/markdown-browser'

test('cold production chat waits for CHAT grammar after the base grammar loads', async () => {
  expect(resourceQueryClient.getQueryData(chatMarkdownQueryKeys.runtime)).toBeUndefined()
  const chatGrammar = new URL(assets.chatGrammar, location.href)
  await commands.delayRequest({ ms: 5000, path: `${chatGrammar.pathname}${chatGrammar.search}` })
  const proof = await createMarkdownBrowser({ sessionFactory: null })
  const observations: string[] = []
  const observer = new MutationObserver(() => {
    const message = proof.host.querySelector('[data-chat-markdown]')
    if (message) observations.push(message.textContent ?? '')
  })
  observer.observe(proof.host, { childList: true, characterData: true, subtree: true })
  onTestFinished(() => observer.disconnect())
  // Module imports can fill the resource timing buffer before the runtime fetches start.
  performance.clearResourceTimings()
  await proof.update('**production**\n\n$$x + y$$', false)
  const grammar = new URL(assets.grammar, location.href)
  await expect
    .poll(() => performance.getEntriesByName(grammar.href).length, { timeout: 15_000 })
    .toBeGreaterThan(0)
  expect(performance.getEntriesByName(chatGrammar.href)).toHaveLength(0)
  expect(resourceQueryClient.getQueryData(chatMarkdownQueryKeys.runtime)).toBeUndefined()
  expect(proof.message().textContent).toBe('**production**\n\n$$x + y$$')
  expect(proof.message().querySelector('strong')).toBeNull()
  expect(proof.message().querySelector('[role="status"]')).not.toBeNull()
  await expect
    .poll(() => proof.message().querySelector('strong')?.textContent, { timeout: 15_000 })
    .toBe('production')
  await expect.poll(() => proof.message().querySelector('.katex')).not.toBeNull()
  expect(observations.length).toBeGreaterThan(0)
  expect(observations.some((text) => text.includes('**production**'))).toBe(true)
  expect(proof.message().textContent).not.toContain('**')
  expect(proof.message().textContent).not.toContain('$$')
  const candidate = await import('@workspace/markdown/utils/tree-sitter-session')
  const runtime = resourceQueryClient.getQueryData(chatMarkdownQueryOptions().queryKey)
  expect(runtime?.createSession).toBe(candidate.createTreeSitterMarkdownSession)
  expect(
    resourceQueryClient
      .getMutationCache()
      .findAll({ mutationKey: chatMutationKeys.markdownRuntime }),
  ).toHaveLength(1)
}, 30_000)
