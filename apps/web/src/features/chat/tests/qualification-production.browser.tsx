import { createEditorTextBuffer } from '@singapore-editor/core/document'
import {
  createMarkdownSession,
  type MarkdownSessionFactory,
} from '@workspace/markdown/utils/session'
import { onTestFinished } from 'vitest'
import { commands, page } from 'vitest/browser'
import grammarUrl from 'tree-sitter-md/tree-sitter-markdown.wasm?url'

import { MarkdownPreviewPane } from '@/features/workbench/components/markdown-preview-pane'
import { createMarkdownScrollSync } from '@/features/workbench/state/markdown-scroll-sync'
import { chatMarkdownQueryOptions } from '@/features/chat/state/markdown-session'
import { chatMarkdownQueryKeys } from '@/features/chat/utils/query-keys'
import { chatMutationKeys } from '@/features/chat/utils/mutation-keys'
import { resourceQueryClient } from '@/lib/resources/state/query-client'
import { expect, test } from '../../../../test/fixtures'
import {
  createMarkdownBrowser,
  readyForScreenshot,
} from '../../../../test/factories/markdown-browser'
import { TestEditorStateProvider } from '../../../../test/factories/editor-state-provider'
import { renderWithProviders } from '../../../../test/render'
import { observeMarkdownSemantics } from '../../../../test/factories/markdown-observation'

test('split preview stays on remark while cold production chat preserves pending source and settles exactly', async () => {
  expect(resourceQueryClient.getQueryData(chatMarkdownQueryKeys.runtime)).toBeUndefined()
  const preview = renderWithProviders(
    <TestEditorStateProvider>
      <MarkdownPreviewPane
        buffer={createEditorTextBuffer('## Preview before WASM\n\n**preview**')}
        documentPath='preview.md'
        rootPath=''
        sync={createMarkdownScrollSync()}
      />
    </TestEditorStateProvider>,
  )
  onTestFinished(() => {
    preview.unmount()
    preview.queryClient.clear()
  })
  await expect.poll(() => preview.container.querySelector('strong')?.textContent).toBe('preview')
  expect(resourceQueryClient.getQueryData(chatMarkdownQueryKeys.runtime)).toBeUndefined()

  const grammar = new URL(grammarUrl, location.href)
  await commands.delayRequest({ ms: 750, path: `${grammar.pathname}${grammar.search}` })
  const proof = await createMarkdownBrowser({ sessionFactory: null })
  const source = '**production**\n\n-       aligned bullet\n\n[docs](https://example.com)'
  const observations: {
    readonly raw: string | null
    readonly pending: boolean
    readonly observation: ReturnType<typeof observeMarkdownSemantics>
  }[] = []
  const observer = new MutationObserver(() => {
    const message = proof.host.querySelector('[data-chat-markdown]')
    if (!(message instanceof HTMLElement)) return
    observations.push({
      raw: message.querySelector('[data-chat-markdown-raw]')?.textContent ?? null,
      pending: message.querySelector('[role="status"]') !== null,
      observation: observeMarkdownSemantics(message),
    })
  })
  observer.observe(proof.host, { childList: true, characterData: true, subtree: true })
  onTestFinished(() => observer.disconnect())
  await proof.update(source, false)
  expect(proof.message().textContent).toBe(source)
  expect(proof.message().querySelector('[data-chat-markdown-raw]')?.textContent).toBe(source)
  expect(proof.message().querySelector('strong')).toBeNull()
  expect(proof.message().querySelector('[role="status"]')).not.toBeNull()
  await expect.poll(() => proof.message().querySelector('strong')?.textContent).toBe('production')

  const candidate = await import('@workspace/markdown/utils/tree-sitter-session')
  const runtime = resourceQueryClient.getQueryData(chatMarkdownQueryOptions().queryKey)
  expect(runtime?.createSession).toBe(candidate.createTreeSitterMarkdownSession)
  expect(proof.message().querySelector('li')?.textContent).toBe('aligned bullet')
  expect(proof.message().querySelector('a')?.getAttribute('href')).toBe('https://example.com')
  expect(observations.length).toBeGreaterThan(0)
  const remark = await createMarkdownBrowser({ sessionFactory: createMarkdownSession })
  await remark.update(source, false)
  const settled = observeMarkdownSemantics(remark.message())
  expect(observeMarkdownSemantics(proof.message())).toEqual(settled)
  expect(proof.message().querySelector('[data-chat-markdown-raw]')).toBeNull()
  expect(proof.message().querySelector('[role="status"]')).toBeNull()
  expect(proof.message().textContent).not.toContain('**')
  expect(proof.message().textContent).not.toContain('[docs]')
  const pending = observations.filter((entry) => entry.raw !== null)
  const ready = observations.filter((entry) => entry.raw === null)
  expect(pending.length).toBeGreaterThan(0)
  expect(ready.length).toBeGreaterThan(0)
  for (const entry of pending) {
    expect(entry.raw).toBe(source)
    expect(entry.observation.text).toBe(source)
    expect(entry.pending).toBe(true)
    expect(entry.observation.elements.some((element) => element.tag === 'strong')).toBe(false)
  }
  for (const entry of ready) {
    expect(entry.pending).toBe(false)
    expect(entry.observation).toEqual(settled)
  }
  expect(
    resourceQueryClient
      .getMutationCache()
      .findAll({ mutationKey: chatMutationKeys.markdownRuntime }),
  ).toHaveLength(1)
  expect(preview.container.querySelector('strong')?.textContent).toBe('preview')
  await readyForScreenshot(proof.host)
  await page.screenshot({ path: 'markdown-production-boundary.png' })
}, 30_000)

test('qualification can still select independent explicit remark and candidate factories', async () => {
  const candidate = await resourceQueryClient.query(chatMarkdownQueryOptions())
  const mutationsBefore = resourceQueryClient
    .getMutationCache()
    .findAll({ mutationKey: chatMutationKeys.markdownRuntime }).length
  let remarkCalls = 0
  let candidateCalls = 0
  const remarkFactory: MarkdownSessionFactory = (options) => {
    remarkCalls += 1
    return createMarkdownSession(options)
  }
  const candidateFactory: MarkdownSessionFactory = (options) => {
    candidateCalls += 1
    return candidate.createSession(options)
  }
  const remark = await createMarkdownBrowser({ sessionFactory: remarkFactory })
  const target = await createMarkdownBrowser({ sessionFactory: candidateFactory })
  const source = '## Same source\n\n~~gone~~ and **kept**'
  await remark.update(source)
  await target.update(source)
  expect(remarkCalls).toBeGreaterThan(0)
  expect(candidateCalls).toBeGreaterThan(0)
  expect(remark.message().textContent).toBe(target.message().textContent)
  expect(
    resourceQueryClient
      .getMutationCache()
      .findAll({ mutationKey: chatMutationKeys.markdownRuntime }),
  ).toHaveLength(mutationsBefore)
})

test('production appends preserve settled blocks and the native selection', async () => {
  const proof = await createMarkdownBrowser({ sessionFactory: null })
  await proof.update('Settled **answer**.\n\nStreaming', true)
  await expect.poll(() => proof.message().querySelector('strong')?.textContent).toBe('answer')
  const settled = proof.message().querySelector('p')!
  const range = document.createRange()
  range.selectNodeContents(settled)
  const selection = window.getSelection()!
  selection.removeAllRanges()
  selection.addRange(range)
  const selected = selection.toString()
  await proof.update('Settled **answer**.\n\nStreaming **tail', true)
  expect(proof.message().querySelector('p')).toBe(settled)
  expect(selection.toString()).toBe(selected)
  expect(proof.message().textContent).not.toContain('**')
  await proof.update('Settled **answer**.\n\nStreaming **tail**.', false)
  expect(proof.message().querySelector('p')).toBe(settled)
  expect(selection.toString()).toBe(selected)
  expect(proof.message().textContent).toContain('Streaming tail.')
})
