import { MarkdownSessionContext } from '@workspace/markdown/providers/session-context'
import type { MarkdownSessionFactory } from '@workspace/markdown/utils/session'
import { loadMarkdownExtension } from '@workspace/markdown/state/extensions'
import type { MarkdownBlock } from '@workspace/markdown/utils/blocks'
import { useLayoutEffect } from 'react'
import { flushSync } from 'react-dom'
import { createRoot } from 'react-dom/client'

import { AssistantMarkdown } from '@/features/chat/components/assistant-markdown'
import { ChatWorkspaceRootContext } from '@/features/chat/providers/workspace-root-context'
import { createClientInvariantError } from '@/lib/structured-errors'
import type {
  ProductionMarkdownFrame,
  ProductionMarkdownReceipt,
  ProductionResourceTiming,
  ProductionResourceWindow,
  ProductionTimelineObservation,
  ProductionTimingFrame,
  ProductionProcessedUpdate,
  ProductionTimingOptions,
  ProductionTimingReceipt,
} from './markdown-production-types'
import type { ChatSession } from '@workspace/client-core/chat/types'
import { messageIdSchema } from '@workspace/contracts'
import * as v from 'valibot'
import { clearTimelineReload } from '@/features/chat/state/timeline-reload'
import { chatMessage, session, TEST_ENVIRONMENT_ID } from './chat'
import { ProductionMarkdownTimeline } from './markdown-timeline-scene'

import { AppProviders, createTestQueryClient, seedHtmlTheme } from '../providers'
import { TestEditorStateProvider } from './editor-state-provider'
import { observeMarkdownSemantics } from './markdown-observation'

export function createProductionMarkdownProbe({
  factory,
  parserMemoryBytes = null,
  host = document.getElementById('markdown-root'),
}: {
  readonly factory: MarkdownSessionFactory
  readonly parserMemoryBytes?: (() => number) | null
  readonly host?: HTMLElement | null
}) {
  if (!host) throw createClientInvariantError('Production Markdown probe host is missing')
  const container = host
  const root = createRoot(container)
  const queryClient = createTestQueryClient()
  seedHtmlTheme('dark')
  let documentId = 0
  let revision = 0
  let disposed = false
  let timeline: ChatSession | null = null
  const longTasks = observeLongTasks()
  const required = { raw: false, math: false, code: false, mermaid: false }
  const trackedFactory: MarkdownSessionFactory = (options) => {
    const owner = factory(options)
    return {
      update(text, options) {
        const blocks = owner.update(text, options)
        captureRequirements(blocks, required)
        return blocks
      },
    }
  }

  async function run(
    source: string,
    chunks: readonly string[],
  ): Promise<ProductionMarkdownReceipt> {
    if (disposed) throw createClientInvariantError('Production Markdown probe was disposed')
    documentId += 1
    timeline = null
    const started = performance.now()
    const frames: ProductionMarkdownFrame[] = []
    const updates = chunks.length > 0 ? chunks : [source]
    for (const text of updates) {
      frames.push(await update(text, chunks.length > 0))
    }
    if (chunks.length > 0) frames.push(await update(source, false))
    return {
      frames,
      final: frames.at(-1) ?? (await update(source, false)),
      longTasks: longTasks.read(started),
      resources: resourceTimings(),
    }
  }

  async function time(
    source: string,
    chunks: readonly string[],
    options: ProductionTimingOptions = {},
  ): Promise<ProductionTimingReceipt> {
    if (disposed) throw createClientInvariantError('Production Markdown probe was disposed')
    documentId += 1
    timeline = null
    const started = performance.now()
    const frames: ProductionTimingFrame[] = []
    const processed: ProductionProcessedUpdate[] = []
    const updates = chunks.length > 0 ? chunks : [source]
    for (const [index, text] of updates.entries()) {
      const tick = await commit(text, chunks.length > 0)
      processed.push(tick)
      if (
        options.arrival !== 'burst-coalesced' ||
        (index + 1) % 32 === 0 ||
        index + 1 === updates.length
      )
        frames.push(await paintReceipt(tick))
    }
    if (chunks.length > 0) {
      const settled = await commit(source, false)
      processed.push(settled)
      frames.push(await paintReceipt(settled))
    }
    const final = frames.at(-1) ?? (await update(source, false, false))
    const fullyReady = await waitForReady()
    return {
      processed,
      frames,
      final,
      fullyReady,
      longTasks: longTasks.read(started),
      resources: resourceTimings(),
    }
  }

  async function waitForReady() {
    const stages: Promise<unknown>[] = []
    if (required.raw) stages.push(loadMarkdownExtension('raw'))
    if (required.math) stages.push(loadMarkdownExtension('math'))
    await Promise.all(stages)
    await document.fonts.ready
    await Promise.all(
      Array.from(container.querySelectorAll('img'), (image) =>
        image.decode().catch(() => undefined),
      ),
    )
    const deadline = performance.now() + 15_000
    while (!renderersReady(container, required)) {
      if (performance.now() >= deadline)
        throw createClientInvariantError('Required Markdown renderer did not become ready')
      await paintedFrame()
    }
    await paintedFrame()
    performance.mark('markdown-fully-ready')
    return performance.now()
  }

  async function show(source: string, live: boolean) {
    timeline = null
    return update(source, live)
  }

  async function resources(
    source: string,
    windows: readonly number[],
  ): Promise<readonly ProductionResourceWindow[]> {
    timeline = null
    const results: ProductionResourceWindow[] = []
    await update(null, false)
    for (const cycles of windows) {
      const started = performance.now()
      const before = resourceState()
      for (let cycle = 0; cycle < cycles; cycle += 1) await resourceCycle(source)
      const after = resourceState()
      results.push({
        cycles,
        elapsedMs: performance.now() - started,
        parserWasmReservedBeforeBytes: before.parserWasmReservedBytes,
        parserWasmReservedAfterBytes: after.parserWasmReservedBytes,
        queryObserversBefore: before.queryObservers,
        queryObserversAfter: after.queryObservers,
        retainedMessageNodes: after.messageNodes,
      })
    }
    return results
  }

  async function mountTimeline(count: number, source: string) {
    clearTimelineReload(TEST_ENVIRONMENT_ID)
    timeline = session({
      latestTurn: null,
      messages: Array.from({ length: count }, (_, index) =>
        chatMessage({
          id: v.parse(messageIdSchema, `production-markdown-${index}`),
          createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, index)).toISOString(),
          text: index + 1 === count ? source : `Answer ${index}. **Rendered** history paragraph.`,
          streaming: false,
        }),
      ),
    })
    await update(null, false)
    return observeTimeline()
  }

  async function updateTimeline(source: string, live: boolean) {
    const last = timeline?.messages.at(-1)
    if (!timeline || !last) throw createClientInvariantError('Production timeline is empty')
    timeline = {
      ...timeline,
      messages: timeline.messages.slice(0, -1).concat([{ ...last, text: source, streaming: live }]),
    }
    await update(null, false)
    return observeTimeline()
  }

  function observeTimeline(): ProductionTimelineObservation {
    const log = container.querySelector('[role="log"]')
    if (!(log instanceof HTMLElement)) throw createClientInvariantError('Timeline log is missing')
    return {
      logicalMessages: timeline?.messages.length ?? 0,
      renderedMessages: log.querySelectorAll('[data-chat-markdown]').length,
      renderedRows: log.querySelectorAll('[data-index]').length,
      scrollTop: log.scrollTop,
      scrollHeight: log.scrollHeight,
      clientHeight: log.clientHeight,
      pinned: log.hasAttribute('data-pinned'),
      selectedText: window.getSelection()?.toString() ?? '',
      composerText: container.querySelector('[data-testid="chat-input-editor"]')?.textContent ?? '',
    }
  }

  async function resourceCycle(source: string) {
    documentId += 1
    await update(source, true)
    await update(source, false)
    await update(null, false)
  }

  function resourceState() {
    return {
      parserWasmReservedBytes: parserMemoryBytes?.() ?? null,
      queryObservers: queryClient
        .getQueryCache()
        .getAll()
        .reduce((count, query) => count + query.getObserversCount(), 0),
      messageNodes: container.querySelectorAll('[data-chat-markdown]').length,
    }
  }

  function dispose() {
    if (disposed) return
    disposed = true
    flushSync(() => root.unmount())
    queryClient.clear()
    container.remove()
    longTasks.dispose()
  }

  function update(
    text: string | null,
    live: boolean,
    observe?: true,
  ): Promise<ProductionMarkdownFrame>
  function update(
    text: string | null,
    live: boolean,
    observe: false,
  ): Promise<ProductionTimingFrame>
  async function update(
    text: string | null,
    live: boolean,
    observe = true,
  ): Promise<ProductionMarkdownFrame | ProductionTimingFrame> {
    const processed = await commit(text, live)
    const tick = await paintReceipt(processed)
    if (!observe) return tick
    const observed = observeMarkdownSemantics(container)
    performance.mark(`markdown-update-${processed.revision}-inspection-end`)
    return { ...tick, ...observed }
  }

  async function paintReceipt(
    processed: ProductionProcessedUpdate,
  ): Promise<ProductionTimingFrame> {
    await paintedFrame()
    const painted = performance.now()
    performance.mark(`markdown-update-${processed.revision}-paint-receipt`)
    return { ...processed, painted }
  }

  async function commit(text: string | null, live: boolean): Promise<ProductionProcessedUpdate> {
    revision += 1
    const current = revision
    const received = performance.now()
    performance.mark(`markdown-update-${current}-start`)
    const committed = Promise.withResolvers<number>()
    required.raw = required.math = required.code = required.mermaid = false
    flushSync(() => {
      root.render(
        <MarkdownSessionContext value={trackedFactory}>
          <AppProviders queryClient={queryClient}>
            <TestEditorStateProvider>
              <ChatWorkspaceRootContext value={null}>
                {timeline ? (
                  <ProductionMarkdownTimeline
                    session={timeline}
                    revision={current}
                    onCommitted={committed.resolve}
                  />
                ) : (
                  <ProductionMarkdownReplay
                    revision={current}
                    documentId={documentId}
                    text={text}
                    live={live}
                    onCommitted={committed.resolve}
                  />
                )}
              </ChatWorkspaceRootContext>
            </TestEditorStateProvider>
          </AppProviders>
        </MarkdownSessionContext>,
      )
    })
    const committedAt = await committed.promise
    performance.mark(`markdown-update-${current}-commit`)
    return { revision: current, received, committed: committedAt }
  }

  return { run, time, show, resources, mountTimeline, updateTimeline, dispose }
}

type RequiredRenderers = { raw: boolean; math: boolean; code: boolean; mermaid: boolean }

function captureRequirements(blocks: readonly MarkdownBlock[], required: RequiredRenderers) {
  required.raw ||= blocks.some((block) => block.hasHtml)
  required.math ||= blocks.some((block) => block.hasMath)
  for (const block of blocks) scanCodeRequirements(block.nodes, required)
}

function scanCodeRequirements(nodes: MarkdownBlock['nodes'], required: RequiredRenderers) {
  for (const node of nodes) {
    if (node.type === 'code' && node.value.length > 0) {
      required.mermaid ||= node.lang === 'mermaid'
      required.code ||= node.lang !== 'mermaid'
    }
    if ('children' in node) scanCodeRequirements(node.children, required)
  }
}

function renderersReady(container: HTMLElement, required: RequiredRenderers) {
  if (required.mermaid && !container.querySelector('[aria-label="Mermaid diagram"]')) return false
  if (!required.code) return true
  const bodies = container.querySelectorAll('[data-markdown="code-block-body"] code')
  return (
    bodies.length > 0 &&
    Array.from(bodies).every((body) => body.textContent?.length === 0 || body.querySelector('span'))
  )
}

function ProductionMarkdownReplay({
  revision,
  documentId,
  text,
  live,
  onCommitted,
}: {
  readonly revision: number
  readonly documentId: number
  readonly text: string | null
  readonly live: boolean
  readonly onCommitted: (timestamp: number) => void
}) {
  useLayoutEffect(() => onCommitted(performance.now()), [onCommitted, revision])
  return text === null ? null : <AssistantMarkdown key={documentId} streaming={live} text={text} />
}

function paintedFrame() {
  return new Promise<void>((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
  )
}

function resourceTimings(): ProductionResourceTiming[] {
  return performance.getEntriesByType('resource').flatMap((entry) => {
    if (!(entry instanceof PerformanceResourceTiming)) return []
    return [
      {
        name: entry.name,
        duration: entry.duration,
        transferSize: entry.transferSize,
        decodedBodySize: entry.decodedBodySize,
      },
    ]
  })
}

function observeLongTasks() {
  const values: { readonly start: number; readonly duration: number }[] = []
  if (
    typeof PerformanceObserver === 'undefined' ||
    !PerformanceObserver.supportedEntryTypes.includes('longtask')
  )
    return { read: (_since: number) => null, dispose: () => undefined }
  const observer = new PerformanceObserver((list) => {
    for (const entry of list.getEntries())
      values.push({ start: entry.startTime, duration: entry.duration })
  })
  try {
    observer.observe({ type: 'longtask', buffered: true })
  } catch {
    return { read: (_since: number) => null, dispose: () => undefined }
  }
  return {
    read: (since: number) =>
      values.filter((entry) => entry.start >= since).map((entry) => entry.duration),
    dispose: () => observer.disconnect(),
  }
}
