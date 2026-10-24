import {
  loadMarkdownExtension,
  setMarkdownExtensionLoaders,
} from '@workspace/markdown/state/extensions'
import { onTestFinished, vi } from 'vitest'
import { page, userEvent } from 'vitest/browser'

import { expect, test } from '../../../../test/fixtures'
import { createBrowserWorkspace } from '../../../../test/factories/browser-workspace'
import { observeMarkdownDom } from '../../../../test/factories/markdown-observation'
import {
  createMarkdownBrowser,
  paintedFrame,
  requiredElement,
} from '../../../../test/factories/markdown-browser'
import { testTabContent } from '../../../../test/factories/document-targets'
import { readyRemarkExtensions } from '../../../../../../packages/markdown/test/qualification'
import { createClientInvariantError } from '@/lib/structured-errors'

test('native keyboard copy preserves a selected settled paragraph during unrelated appends', async () => {
  const proof = await createMarkdownBrowser()
  const source = 'Read [the docs](https://example.com/guide) for **detail**.\n\nTail'
  await proof.update(source, true)
  const paragraph = requiredElement(proof.host, 'p')
  await page.elementLocator(paragraph).click()
  const selection = window.getSelection()
  expect(selection).not.toBeNull()
  const range = document.createRange()
  range.selectNodeContents(paragraph)
  selection?.removeAllRanges()
  selection?.addRange(range)
  const selected = selection?.toString()
  await proof.update(source + ' keeps growing', true)
  expect(proof.host.querySelector('p')).toBe(paragraph)
  expect(selection?.toString()).toBe(selected)
  expect(selection?.isCollapsed).toBe(false)

  let payload: { text: string; html: string; trusted: boolean; prevented: boolean } | null = null
  const capture = (event: ClipboardEvent) => {
    payload = {
      text: event.clipboardData?.getData('text/plain') ?? '',
      html: event.clipboardData?.getData('text/html') ?? '',
      trusted: event.isTrusted,
      prevented: event.defaultPrevented,
    }
  }
  document.addEventListener('copy', capture)
  onTestFinished(() => document.removeEventListener('copy', capture))
  await userEvent.copy()
  await vi.waitFor(() => expect(payload).not.toBeNull())
  expect(payload).toMatchObject({
    text: 'Read [the docs](https://example.com/guide) for **detail**.',
    trusted: true,
    prevented: true,
  })
  const rich = document.createElement('div')
  rich.innerHTML = clipboardHtml(payload)
  expect(rich.querySelector('a')?.getAttribute('href')).toBe('https://example.com/guide')
  expect(rich.querySelector('strong')?.textContent).toBe('detail')
  expect(rich.querySelector('button')).toBeNull()
})

test('fragment activation scrolls to the heading in its own message', async () => {
  const proof = await createMarkdownBrowser({ width: 390 })
  const paragraphs = Array.from({ length: 24 }, (_, index) => `Paragraph ${index}`).join('\n\n')
  await proof.update(`[Jump to details](#details)\n\n${paragraphs}\n\n## Details\n\nTarget`)
  const heading = requiredElement(proof.host, 'h2')
  const hash = location.hash
  expect(heading.getBoundingClientRect().top).toBeGreaterThan(window.innerHeight)
  await page.getByRole('link', { name: 'Jump to details' }).click()
  await vi.waitFor(() =>
    expect(heading.getBoundingClientRect().top).toBeLessThan(window.innerHeight),
  )
  expect(location.hash).toBe(hash)
})

test('a workspace file link activates the real file server and opens its line', async () => {
  const workspace = await createBrowserWorkspace('repo')
  const proof = await createMarkdownBrowser({
    application: workspace.application,
    queryClient: workspace.queryClient,
  })
  await proof.update('See `src/editor-tab-a.ts:2` for the implementation.')
  await page.getByRole('link', { name: /src\/editor-tab-a\.ts:2/u }).click()
  const editor = workspace.application.getSnapshot().editor
  await vi.waitFor(() =>
    expect(editor.workspaceStore.getState().selectedTabContent).toEqual(
      testTabContent('repo/src/editor-tab-a.ts'),
    ),
  )
  expect(editor.uiStore.getState().definitionTarget?.target).toMatchObject({
    path: 'repo/src/editor-tab-a.ts',
    range: { start: { line: 1, character: 0 } },
  })
})

test('dangerous HTML and link activation preserve safe display after the real HTML stage loads', async () => {
  const proof = await createMarkdownBrowser()
  const marker = 'markdownQualificationExecuted'
  Reflect.set(window, marker, false)
  onTestFinished(() => {
    Reflect.deleteProperty(window, marker)
  })
  const source = `<script>window.${marker}=true</script>\n\n<a href="javascript:window.${marker}=true" onclick="window.${marker}=true">Run</a>\n\nVisible`
  await proof.update(source)
  await loadMarkdownExtension('raw')
  await paintedFrame()
  expect(proof.host.querySelector('script')).toBeNull()
  const link = requiredElement(proof.host, 'a')
  expect(link.getAttribute('href')).toBeNull()
  expect(link.getAttribute('onclick')).toBeNull()
  await page.elementLocator(link).click()
  expect(Reflect.get(window, marker)).toBe(false)
  expect(observeMarkdownDom(proof.message()).text).toContain('Visible')
})

test('late HTML cannot restore a replaced source or contaminate a sibling document', async () => {
  const gate = Promise.withResolvers<void>()
  holdHtml(gate.promise)
  onTestFinished(() => gate.resolve())
  const proof = await createMarkdownBrowser()
  await proof.updateMessages([
    { id: 'changing', text: '<kbd>Stale</kbd>', live: false },
    { id: 'sibling', text: 'Sibling stays.', live: false },
  ])
  expect(proof.host.querySelector('kbd')).toBeNull()
  const sibling = proof.host.querySelectorAll('[data-chat-markdown]')[1]?.querySelector('p')
  await proof.updateMessages([
    { id: 'changing', text: 'Replacement.', live: false },
    { id: 'sibling', text: 'Sibling stays.', live: false },
  ])
  gate.resolve()
  await loadMarkdownExtension('raw')
  await paintedFrame()
  expect(observeMarkdownDom(proof.host).text).toBe('Replacement.Sibling stays.')
  expect(proof.host.querySelector('kbd')).toBeNull()
  expect(sibling?.isConnected).toBe(true)
})

test('late math loads the actual renderer after a commit and preserves the prose around it', async () => {
  const gate = Promise.withResolvers<void>()
  setMarkdownExtensionLoaders({
    math: async () => {
      await gate.promise
      const extensions = await readyRemarkExtensions()
      if (!extensions.math) throw createClientInvariantError('Real math extension is unavailable')
      return { default: extensions.math }
    },
  })
  onTestFinished(() => setMarkdownExtensionLoaders(null))
  onTestFinished(() => gate.resolve())
  const proof = await createMarkdownBrowser()
  const receipt = await proof.update('Before $$x^2$$ after.')
  expect(receipt.observation.text).toContain('Before x^2 after.')
  expect(proof.host.querySelector('math')).toBeNull()
  gate.resolve()
  await loadMarkdownExtension('math')
  await vi.waitFor(() => expect(proof.host.querySelector('math')).not.toBeNull())
  expect(requiredElement(proof.host, 'p').textContent).toContain('Before')
  expect(requiredElement(proof.host, 'p').textContent).toContain('after.')
})

test('disposed messages stay disposed when their deferred HTML stage resolves', async () => {
  const gate = Promise.withResolvers<void>()
  holdHtml(gate.promise)
  onTestFinished(() => gate.resolve())
  const proof = await createMarkdownBrowser()
  await proof.update('<kbd>Disposed source</kbd>')
  const detached = proof.message()
  proof.dispose()
  gate.resolve()
  await loadMarkdownExtension('raw')
  await paintedFrame()
  expect(detached.isConnected).toBe(false)
  expect(document.querySelector('[data-markdown-proof]')).toBeNull()
  const fresh = await createMarkdownBrowser()
  await fresh.update('Fresh source.')
  expect(observeMarkdownDom(fresh.message()).text).toBe('Fresh source.')
})

test('twenty cycles detach message DOM and query observers before harness cache cleanup', async () => {
  for (let cycle = 0; cycle < 20; cycle += 1) {
    const proof = await createMarkdownBrowser()
    await proof.update(`Cycle ${cycle}\n\n**working`, true)
    await proof.update(`Cycle ${cycle}\n\n**done**`, false)
    expect(requiredElement(proof.host, 'strong').textContent).toBe('done')
    const disposal = proof.dispose()
    expect(disposal.queryObserversAfterUnmount).toBe(0)
    expect(disposal.queryEntriesAfterHarnessClear).toBe(0)
    expect(proof.host.isConnected).toBe(false)
  }
  expect(document.querySelectorAll('[data-markdown-proof]')).toHaveLength(0)
}, 30_000)

function holdHtml(gate: Promise<void>) {
  setMarkdownExtensionLoaders({
    raw: async () => {
      await gate
      const extensions = await readyRemarkExtensions()
      if (!extensions.raw) throw createClientInvariantError('Real HTML extension is unavailable')
      return { default: extensions.raw }
    },
  })
  onTestFinished(() => setMarkdownExtensionLoaders(null))
}

function clipboardHtml(payload: { html: string } | null): string {
  return payload?.html ?? ''
}
