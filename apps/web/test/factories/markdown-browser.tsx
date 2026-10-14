import type { QueryClient } from '@tanstack/react-query'
import { settingsKeys } from '@workspace/client-core/settings/query-keys'
import '@workspace/ui/globals.css'
import { useLayoutEffect } from 'react'
import { flushSync } from 'react-dom'
import { createRoot } from 'react-dom/client'
import { onTestFinished, vi } from 'vitest'
import { page } from 'vitest/browser'

import { AssistantMarkdown } from '@/features/chat/components/assistant-markdown'
import { ChatWorkspaceRootContext } from '@/features/chat/providers/workspace-root-context'
import { createClientInvariantError } from '@/lib/structured-errors'
import type { ApplicationRuntime } from '@/state/application-runtime'
import type { Observation } from '../../../../packages/markdown/test/qualification'
import { checkExpectations } from '../../../../packages/markdown/test/qualification'
import type { Expectation } from '../../../../packages/markdown/test/fixtures/cases'
import { AppProviders, createTestQueryClient, seedHtmlTheme } from '../render'
import { TestEditorStateProvider } from './editor-state-provider'
import { settingsSnapshot } from './settings'

type ReplayMessage = {
  readonly id: string
  readonly text: string
  readonly live: boolean
}

export type MarkdownPaintReceipt = {
  readonly revision: number
  readonly received: number
  readonly committed: number
  readonly painted: number
  readonly observation: Observation
}

export async function createMarkdownBrowser({
  width = 720,
  theme = 'dark',
  application,
  queryClient = createTestQueryClient(),
}: {
  readonly width?: number
  readonly theme?: 'dark' | 'light'
  readonly application?: ApplicationRuntime
  readonly queryClient?: QueryClient
} = {}) {
  const previousViewport = { width: window.innerWidth, height: window.innerHeight }
  const host = document.createElement('main')
  host.className = 'bg-background text-foreground font-sans p-4'
  host.dataset.markdownProof = 'true'
  const root = createRoot(host)
  let disposed = false
  let revision = 0
  const dispose = () => {
    if (disposed) return
    disposed = true
    flushSync(() => root.unmount())
    host.remove()
    queryClient.clear()
    window.getSelection()?.removeAllRanges()
  }
  onTestFinished(async () => {
    dispose()
    await page.viewport(previousViewport.width, previousViewport.height)
  })
  await page.viewport(width, width === 390 ? 844 : 900)
  document.body.append(host)
  queryClient.setQueryData(
    settingsKeys.document(),
    settingsSnapshot({ values: { 'workbench.colorTheme': theme } }),
  )
  seedHtmlTheme(theme)

  async function updateMessages(messages: readonly ReplayMessage[]): Promise<MarkdownPaintReceipt> {
    if (disposed) throw createClientInvariantError('Markdown proof was disposed')
    revision += 1
    const current = revision
    const completion = Promise.withResolvers<number>()
    const received = performance.now()
    flushSync(() => {
      root.render(
        <AppProviders application={application} queryClient={queryClient}>
          <TestEditorStateProvider>
            <ChatWorkspaceRootContext value={null}>
              <MarkdownReplay
                messages={messages}
                onCommitted={completion.resolve}
                revision={current}
              />
            </ChatWorkspaceRootContext>
          </TestEditorStateProvider>
        </AppProviders>,
      )
    })
    const committed = await completion.promise
    await paintedFrame()
    return {
      revision: current,
      received,
      committed,
      painted: performance.now(),
      observation: observeMarkdownDom(host),
    }
  }

  return {
    host,
    queryClient,
    dispose,
    updateMessages,
    update: (text: string, live = false) => updateMessages([{ id: 'primary', text, live }]),
    message: () => requiredElement(host, '[data-chat-markdown]'),
  }
}

function MarkdownReplay({
  messages,
  onCommitted,
  revision,
}: {
  readonly messages: readonly ReplayMessage[]
  readonly onCommitted: (timestamp: number) => void
  readonly revision: number
}) {
  useLayoutEffect(() => onCommitted(performance.now()), [onCommitted, revision])
  return (
    <section data-markdown-proof-revision={revision}>
      {messages.map((message) => (
        <AssistantMarkdown key={message.id} streaming={message.live} text={message.text} />
      ))}
    </section>
  )
}

export async function paintedFrame(): Promise<void> {
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
}

/** Excludes declared copy chrome, while preserving all message whitespace and content. */
export function observeMarkdownDom(host: Element): Observation {
  const copy = host.cloneNode(true)
  if (!(copy instanceof Element))
    throw createClientInvariantError('Markdown observation needs an element')
  for (const chrome of copy.querySelectorAll('[data-markdown-copy=""]')) chrome.remove()
  return {
    text: renderedText(copy),
    elements: Array.from(copy.querySelectorAll('*'), (element) => ({
      tag: element.tagName.toLowerCase(),
      text: renderedText(element),
      attributes: Object.fromEntries(
        Array.from(element.attributes, (attribute) => [attribute.name, attribute.value]),
      ),
      parents: ancestorTags(element, copy),
    })),
  }
}

function renderedText(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? ''
  if (node instanceof HTMLBRElement) return '\n'
  return Array.from(node.childNodes, renderedText).join('')
}

function ancestorTags(element: Element, root: Element): string[] {
  const parents: string[] = []
  let parent = element.parentElement
  while (parent && parent !== root) {
    parents.push(parent.tagName.toLowerCase())
    parent = parent.parentElement
  }
  return parents.reverse()
}

/** Chat fence chrome owns language/incomplete metadata and trims its final newlines. */
export function checkChatExpectations(
  host: HTMLElement,
  expectations: readonly Expectation[],
): string[] {
  const codes = Array.from(host.querySelectorAll('code'))
  const pres = Array.from(host.querySelectorAll('pre'))
  const findings: string[] = []
  const adjusted = expectations.map((expectation) =>
    adaptFenceExpectation(expectation, codes, pres, findings),
  )
  return findings.concat(checkExpectations(observeMarkdownDom(host), adjusted))
}

function adaptFenceExpectation(
  expectation: Expectation,
  codes: readonly HTMLElement[],
  pres: readonly HTMLElement[],
  findings: string[],
): Expectation {
  if (expectation.tag !== 'code' && expectation.tag !== 'pre') return expectation
  const elements = expectation.tag === 'code' ? codes : pres
  return {
    ...expectation,
    texts: expectation.texts?.map((text, index) =>
      elements[index]?.closest('[data-markdown="code-block"]') ? text.replace(/\n+$/u, '') : text,
    ),
    attributes: expectation.attributes?.map((attributes, index) =>
      adaptCodeAttributes(elements[index], attributes, findings),
    ),
  }
}

function adaptCodeAttributes(
  code: HTMLElement | undefined,
  attributes: Readonly<Record<string, string | null>>,
  findings: string[],
): Readonly<Record<string, string | null>> {
  const fence = code?.closest('[data-markdown="code-block"]')
  if (!fence) return attributes
  const adjusted = { ...attributes }
  const language = /(?:^|\s)language-(\S+)/u.exec(attributes.class ?? '')?.[1]
  if (language && fence.getAttribute('data-language') !== language)
    findings.push(`Chat fence language: expected ${language}`)
  if (
    'data-incomplete' in attributes &&
    fence.getAttribute('data-incomplete') !== attributes['data-incomplete']
  )
    findings.push('Chat fence incomplete state differs')
  const title = /title="([^"]+)"/u.exec(attributes['data-meta'] ?? '')?.[1]
  if (
    title &&
    !fence.querySelector('[data-markdown="code-block-header"]')?.textContent?.includes(title)
  )
    findings.push('Chat fence title differs')
  delete adjusted.class
  delete adjusted['data-incomplete']
  delete adjusted['data-meta']
  return adjusted
}

export function requiredElement(host: ParentNode, selector: string): HTMLElement {
  const element = host.querySelector(selector)
  if (!(element instanceof HTMLElement))
    throw createClientInvariantError(`Missing Markdown proof element: ${selector}`)
  return element
}

export async function readyForScreenshot(host: HTMLElement): Promise<void> {
  await document.fonts.ready
  await vi.waitFor(() => {
    const box = host.getBoundingClientRect()
    if (box.width <= 0 || box.height <= 0)
      throw createClientInvariantError('Markdown proof has no visible bounds')
    if (!(host.textContent ?? '').trim())
      throw createClientInvariantError('Markdown proof has no visible text')
    const expectedTheme = host.ownerDocument.documentElement.classList.contains('dark')
    if (expectedTheme && getComputedStyle(host).color.length === 0)
      throw createClientInvariantError('Markdown proof theme did not load')
  })
  await vi.waitFor(() => assertHighlightedFences(host), { timeout: 10_000 })
  await document.fonts.ready
  await paintedFrame()
}

function assertHighlightedFences(host: HTMLElement): void {
  for (const fence of host.querySelectorAll('[data-markdown="code-block"]')) {
    const language = fence.getAttribute('data-language')
    if (language !== 'ts' && language !== 'typescript') continue
    if (!fence.querySelector('[data-markdown="code-block-body"] span[style]'))
      throw createClientInvariantError('Markdown proof highlighting has not loaded')
  }
}

export function recordMarkdownFrames(host: HTMLElement) {
  const frames: { revision: number; text: string; code: string; tokenColors: readonly string[] }[] =
    []
  let active = true
  let callback = 0
  function capture() {
    if (!active) return
    const code = host.querySelector('[data-markdown="code-block-body"]')
    frames.push({
      revision: Number(
        host
          .querySelector('[data-markdown-proof-revision]')
          ?.getAttribute('data-markdown-proof-revision'),
      ),
      text: observeMarkdownDom(host).text,
      code: code?.textContent ?? '',
      tokenColors: code
        ? Array.from(
            code.querySelectorAll<HTMLElement>('span[style]'),
            (span) => getComputedStyle(span).color,
          )
        : [],
    })
    callback = requestAnimationFrame(capture)
  }
  callback = requestAnimationFrame(capture)
  const stop = () => {
    active = false
    cancelAnimationFrame(callback)
    return frames
  }
  onTestFinished(() => {
    stop()
  })
  return { frames, stop }
}
