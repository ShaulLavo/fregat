import { MarkdownSessionContext } from '@workspace/markdown/providers/session-context'
import type { MarkdownSessionFactory } from '@workspace/markdown/utils/session'
import { loadMarkdownExtension } from '@workspace/markdown/state/extensions'
import { highlightingService } from '@/lib/highlighting/state/service'
import type { MarkdownBlock } from '@workspace/markdown/utils/blocks'
import { useLayoutEffect } from 'react'
import { flushSync } from 'react-dom'
import { createRoot } from 'react-dom/client'

import { AssistantMarkdown } from '@/features/chat/components/assistant-markdown'
import { ChatWorkspaceRootContext } from '@/features/chat/providers/workspace-root-context'
import { createClientInvariantError } from '@/lib/structured-errors'
import type {
  ProductionMarkdownFrame,
  ProductionMismatchSink,
  ProductionMismatchSample,
  ProductionOracleSink,
  ProductionMarkdownReceipt,
  ProductionOutputReceipt,
  ProductionResourceTiming,
  ProductionResourceWindow,
  ProductionTimelineObservation,
  ProductionTimingFrame,
  ProductionProcessedUpdate,
  ProductionTimingOptions,
  ProductionTimingReceipt,
} from './markdown-production-types'
import type { Observation } from '../../../../packages/markdown/test/qualification'
import type { ChatSession } from '@workspace/client-core/chat/types'
import { messageIdSchema } from '@workspace/contracts'
import * as v from 'valibot'
import { clearTimelineReload } from '@/features/chat/state/timeline-reload'
import { chatMessage, session, TEST_ENVIRONMENT_ID } from './chat'
import { productionAssetKind } from './markdown-production-assets'
import { ProductionMarkdownTimeline } from './markdown-timeline-scene'

import { AppProviders, createTestQueryClient, seedHtmlTheme } from '../providers'
import { TestEditorStateProvider } from './editor-state-provider'
import { observeMarkdownSemantics } from './markdown-observation'

async function observePaintReceipt(
  container: HTMLElement,
  readRevision: () => number,
  processed: ProductionProcessedUpdate,
  expectation?: Pick<ProductionMismatchSample, 'expected' | 'expectedIndex'>,
  onMismatch?: ProductionMismatchSink,
): Promise<ProductionTimingFrame> {
  const deadline = performance.now() + 15_000
  while (true) {
    await paintedFrame()
    const observedRevision = readRevision()
    const painted = performance.now()
    const observation = observeMarkdownSemantics(container)
    const paintedOutput = await outputReceipt(observation)
    // Preserve only a terminal mismatch. Transient readiness polling stays uninstrumented.
    if (
      expectation &&
      (paintedOutput.digest !== expectation.expected.digest ||
        observedRevision !== processed.revision) &&
      (observedRevision !== processed.revision || performance.now() >= deadline)
    )
      await onMismatch?.({
        actual: { ...processed, observedRevision, painted, paintedOutput, ...observation },
        ...expectation,
      })
    if (
      !expectation ||
      paintedOutput.digest === expectation.expected.digest ||
      observedRevision !== processed.revision
    )
      return { ...processed, observedRevision, painted, paintedOutput }
    if (performance.now() >= deadline)
      throw createClientInvariantError(
        'Production revision never matched its independent expected projection',
      )
  }
}

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
  const paintReceipt = observePaintReceipt.bind(null, container, () => revision)
  let disposed = false
  let preparation: Promise<number> | null = null
  let timeline: ChatSession | null = null
  let simultaneousMessages = 1
  let parseCalls = 0
  let parserWallMs = 0
  let lastInputSha256 = ''
  const frameIntervalsMs: number[] = []
  let previousFrame = performance.now()
  let frameRequest = requestAnimationFrame(recordFrame)
  function recordFrame(timestamp: number) {
    frameIntervalsMs.push(timestamp - previousFrame)
    previousFrame = timestamp
    frameRequest = requestAnimationFrame(recordFrame)
  }
  const longTasks = observeLongTasks()
  const required = { raw: false, math: false, code: false, mermaid: false }
  const trackedFactory: MarkdownSessionFactory = (options) => {
    const owner = factory(options)
    return {
      update(text, updateOptions) {
        const started = performance.now()
        const blocks = owner.update(text, updateOptions)
        parserWallMs += performance.now() - started
        if (parseCalls === 0)
          required.raw = required.math = required.code = required.mermaid = false
        parseCalls += 1
        captureRequirements(blocks, required)
        return blocks
      },
    }
  }

  async function run(
    source: string,
    chunks: readonly string[],
  ): Promise<ProductionMarkdownReceipt> {
    await prepare()
    documentId += 1
    timeline = null
    const started = performance.now()
    const frames: ProductionMarkdownFrame[] = []
    const updates = chunks.length > 0 ? chunks : [source]
    for (const text of updates) frames.push(await update(text, chunks.length > 0))
    if (chunks.length > 0) frames.push(await update(source, false))
    const final = frames.at(-1) ?? (await update(source, false))
    const fullyReady = final.painted
    return {
      frames,
      final,
      fullyReady,
      longTasks: longTasks.read(started),
      resources: resourceTimings(started),
    }
  }

  async function streamOracle(
    source: string,
    chunks: readonly string[],
    sink: ProductionOracleSink,
  ): Promise<void> {
    await prepare()
    documentId += 1
    timeline = null
    const started = performance.now()
    const updates = chunks.length > 0 ? chunks : [source]
    for (let index = 0; index < updates.length; index += 1)
      await emitOracleUpdate(
        updates[index],
        chunks.length > 0,
        chunks.length === 0 && index === updates.length - 1,
        started,
        sink,
      )
    if (chunks.length > 0) await emitOracleUpdate(source, false, true, started, sink)
    documentId += 1
    timeline = null
    await sink({ kind: 'fresh', frame: await update(source, false) })
  }

  async function emitOracleUpdate(
    text: string,
    live: boolean,
    final: boolean,
    started: number,
    sink: ProductionOracleSink,
  ) {
    const frame = await update(text, live)
    await sink({ kind: 'frame', frame })
    if (final)
      await sink({
        kind: 'final',
        frame,
        fullyReady: frame.painted,
        longTasks: longTasks.read(started),
        resources: resourceTimings(started),
      })
  }

  async function time(
    source: string,
    chunks: readonly string[],
    options: ProductionTimingOptions,
  ): Promise<ProductionTimingReceipt> {
    await prepare()
    const updates = chunks.length > 0 ? chunks : [source]
    const expectedCount = updates.length + Number(chunks.length > 0)
    if (
      options.expected.length !== expectedCount ||
      options.arrivalOffsetsMs.length !== updates.length
    )
      throw createClientInvariantError(
        'Production timing requires one frozen expectation and deadline per input',
      )
    let mismatchReported = false
    const onMismatch: ProductionMismatchSink = async (sample) => {
      if (mismatchReported || !options.onMismatch) return
      mismatchReported = true
      await options.onMismatch(sample)
    }
    const inputDigests = await Promise.all(updates.map(textDigest))
    documentId += 1
    timeline = null
    simultaneousMessages = 1
    const started = performance.now()
    performance.mark('markdown-stream-start')
    const samples = await Promise.all(
      updates.map((text, index) =>
        scheduledUpdate({
          text,
          live: chunks.length > 0,
          scheduled: started + options.arrivalOffsetsMs[index],
          inputSha256: inputDigests[index],
          expected: options.expected[index],
          expectedIndex: index,
          onMismatch,
          paint:
            options.arrival === 'paced' || (index + 1) % 32 === 0 || index + 1 === updates.length,
        }),
      ),
    )
    const processed = samples.map((sample) => sample.processed)
    const frames = samples.flatMap((sample) => (sample.frame ? [sample.frame] : []))
    if (chunks.length > 0) {
      const settled = await commit(source, false)
      processed.push(settled)
      const expected = options.expected.at(-1)
      frames.push(
        await paintReceipt(
          settled,
          expected
            ? {
                expected,
                expectedIndex: options.expected.length - 1,
              }
            : undefined,
          onMismatch,
        ),
      )
    }
    const final = frames.at(-1)
    if (!final) throw createClientInvariantError('Production timing recorded no final paint')
    const fullyReady = await waitForReady()
    const readyObservation = observeMarkdownSemantics(container)
    const fullyReadyOutput = await outputReceipt(readyObservation)
    const readyExpected = options.expected.at(-1)
    if (readyExpected && fullyReadyOutput.digest !== readyExpected.digest)
      await onMismatch({
        actual: { ...final, ...readyObservation, paintedOutput: fullyReadyOutput },
        expected: readyExpected,
        expectedIndex: options.expected.length - 1,
      })
    performance.mark('markdown-stream-end')
    const ended = performance.now()
    performance.mark('markdown-timing-end')
    const heldSyntax = options.heldSyntax ? await measureHeldSyntax(options.heldSyntax) : null
    return {
      started,
      ended,
      processed,
      frames,
      skippedPaintRevisions: processed
        .filter((tick) => !frames.some((frame) => frame.revision === tick.revision))
        .map((tick) => tick.revision),
      final,
      fullyReady,
      fullyReadyOutput,
      heldSyntax,
      longTasks: longTasks.read(started, ended),
      resources: resourceTimings(started),
    }
  }

  async function scheduledUpdate(input: {
    text: string
    live: boolean
    scheduled: number
    inputSha256: string
    expected: ProductionOutputReceipt
    expectedIndex: number
    onMismatch: ProductionMismatchSink
    paint: boolean
  }) {
    await waitUntil(input.scheduled)
    const processed = await commit(input.text, input.live, input.scheduled, input.inputSha256)
    const frame = input.paint
      ? await paintReceipt(
          processed,
          {
            expected: input.expected,
            expectedIndex: input.expectedIndex,
          },
          input.onMismatch,
        )
      : null
    return { processed, frame }
  }

  async function measureHeldSyntax(heldSyntax: NonNullable<ProductionTimingOptions['heldSyntax']>) {
    documentId += 1
    const held = await paintReceipt(await commit(heldSyntax.held, true))
    const heldOutput = observeMarkdownSemantics(container)
    if (
      heldOutput.elements.some((element) => element.tag === 'h2') ||
      heldOutput.text.includes('##')
    )
      throw createClientInvariantError('The held-heading probe published unresolved syntax')
    await new Promise<void>((resolve) => setTimeout(resolve, 80))
    const releasedAt = performance.now()
    const released = await paintReceipt(await commit(heldSyntax.released, true))
    const releasedOutput = observeMarkdownSemantics(container)
    if (
      !releasedOutput.elements.some((element) => element.tag === 'h2' && element.text === 'Ready')
    )
      throw createClientInvariantError(
        'The held-heading probe did not release the expected heading',
      )
    return { held, released, holdMs: releasedAt - held.painted }
  }

  async function waitForReady() {
    const stages: Promise<unknown>[] = []
    if (required.raw)
      stages.push(
        loadMarkdownExtension('raw').then((extensions) => {
          if (!extensions.raw)
            throw createClientInvariantError('Required raw Markdown loader failed')
        }),
      )
    if (required.math)
      stages.push(
        loadMarkdownExtension('math').then((extensions) => {
          if (!extensions.math)
            throw createClientInvariantError('Required math Markdown loader failed')
        }),
      )
    await Promise.all(stages)
    await document.fonts.ready
    await Promise.all(
      Array.from(container.querySelectorAll('img'))
        .filter((image) => !image.closest('[data-chat-link-favicon]'))
        .map((image) => image.decode().catch(() => undefined)),
    )
    const deadline = performance.now() + 15_000
    while (true) {
      await highlightingService().awaitIdle()
      if (!container.querySelector('[aria-busy="true"]') && renderersReady(container, required))
        break
      if (performance.now() >= deadline)
        throw createClientInvariantError('Required Markdown renderer did not become ready')
      await paintedFrame()
    }
    await paintedFrame()
    performance.mark('markdown-fully-ready')
    return performance.now()
  }

  async function show(source: string, live: boolean) {
    ensureLive()
    timeline = null
    return update(source, live)
  }

  async function resources(
    source: string | null,
    windows: readonly number[],
    concurrentMessages = 1,
  ): Promise<readonly ProductionResourceWindow[]> {
    ensureLive()
    timeline = null
    const results: ProductionResourceWindow[] = []
    await update(null, false)
    for (const cycles of windows)
      results.push(await resourceWindow(source, cycles, concurrentMessages))
    return results
  }

  async function resourceWindow(
    source: string | null,
    cycles: number,
    concurrentMessages: number,
  ): Promise<ProductionResourceWindow> {
    const started = performance.now()
    const before = resourceState()
    let peakWasmReservedBytes = before.parserWasmReservedBytes
    let peakMessageNodes = 0
    for (let cycle = 0; cycle < cycles; cycle += 1) {
      const peak = await resourceCycle(source, concurrentMessages)
      peakWasmReservedBytes = maximumMemory(peakWasmReservedBytes, peak.parserWasmReservedBytes)
      peakMessageNodes = Math.max(peakMessageNodes, peak.messageNodes)
    }
    await paintedFrame()
    const after = resourceState()
    return {
      cycles,
      elapsedMs: performance.now() - started,
      parserWasmReservedBeforeBytes: before.parserWasmReservedBytes,
      parserWasmReservedAfterBytes: after.parserWasmReservedBytes,
      jsHeapUsedBeforeBytes: before.jsHeapUsedBytes,
      jsHeapUsedAfterBytes: after.jsHeapUsedBytes,
      jsHeapReservedBeforeBytes: before.jsHeapReservedBytes,
      jsHeapReservedAfterBytes: after.jsHeapReservedBytes,
      backingStorageBeforeBytes: null,
      backingStorageAfterBytes: null,
      queryObserversBefore: before.queryObservers,
      queryObserversAfter: after.queryObservers,
      retainedMessageNodes: after.messageNodes,
      simultaneousMessages: concurrentMessages,
      peakWasmReservedBytes,
      peakMessageNodes,
    }
  }

  async function mountTimeline(count: number, source: string) {
    await prepare()
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
    ensureLive()
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
      revision,
      sourceSha256: lastInputSha256,
      parserCalls: parseCalls,
      renderedTailText:
        Array.from(log.querySelectorAll('[data-chat-markdown]')).at(-1)?.textContent ?? '',
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

  async function resourceCycle(source: string | null, count: number) {
    documentId += 1
    simultaneousMessages = count
    await update(source, true)
    const peak = resourceState()
    await update(source, false)
    await update(null, false)
    simultaneousMessages = 1
    // Trace events already own the marks. Retaining observation buffers would inflate post-GC heaps.
    for (const entry of performance.getEntriesByType('mark')) {
      if (entry.name.startsWith('markdown-')) performance.clearMarks(entry.name)
    }
    frameIntervalsMs.length = 0
    longTasks.clear()
    return peak
  }

  function resourceState() {
    const memory = browserMemory()
    return {
      parserWasmReservedBytes: parserMemoryBytes?.() ?? null,
      jsHeapUsedBytes: memory?.usedJSHeapSize ?? null,
      jsHeapReservedBytes: memory?.totalJSHeapSize ?? null,
      queryObservers: queryClient
        .getQueryCache()
        .getAll()
        .reduce((count, query) => count + query.getObserversCount(), 0),
      messageNodes: container.querySelectorAll('[data-chat-markdown]').length,
    }
  }

  async function dispose() {
    if (disposed) return
    disposed = true
    flushSync(() => root.unmount())
    queryClient.clear()
    container.remove()
    longTasks.dispose()
    cancelAnimationFrame(frameRequest)
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
    await waitForReady()
    const tick = await paintReceipt(processed)
    if (!observe) return tick
    const observed = observeMarkdownSemantics(container)
    performance.mark(`markdown-update-${processed.revision}-inspection-end`)
    return { ...tick, ...observed }
  }

  async function commit(
    text: string | null,
    live: boolean,
    scheduled?: number,
    inputDigest?: string,
  ): Promise<ProductionProcessedUpdate> {
    await prepare()
    const inputText = timeline?.messages.at(-1)?.text ?? text ?? ''
    const inputSha256 = inputDigest ?? (await textDigest(inputText))
    lastInputSha256 = inputSha256
    revision += 1
    const current = revision
    const received = performance.now()
    performance.mark(`markdown-update-${current}-start`)
    parseCalls = 0
    parserWallMs = 0
    if (text === null && !timeline)
      required.raw = required.math = required.code = required.mermaid = false
    const committedAt = await render(text, live, current)
    performance.mark(`markdown-update-${current}-commit`)
    const parser = { parseCalls, parserWallMs }
    return {
      revision: current,
      inputSha256,
      inputUtf16Units: inputText.length,
      live,
      scheduled: scheduled ?? received,
      received,
      committed: committedAt,
      ...parser,
      output: await readOutput(),
    }
  }

  async function prepare() {
    ensureLive()
    preparation ??= render(null, false, 0).then(waitForReady)
    await preparation
    ensureLive()
  }

  async function render(text: string | null, live: boolean, current: number) {
    const committed = Promise.withResolvers<number>()
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
                    count={simultaneousMessages}
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
    return committed.promise
  }

  function ensureLive() {
    if (disposed) throw createClientInvariantError('Production Markdown probe was disposed')
  }

  async function readOutput(): Promise<ProductionOutputReceipt> {
    return outputReceipt(observeMarkdownSemantics(container))
  }

  return {
    get ready() {
      return prepare()
    },
    run,
    streamOracle,
    time,
    show,
    resources,
    mountTimeline,
    updateTimeline,
    observeTimeline,
    activity: () => ({
      longTasks: longTasks.read(0),
      frameIntervalsMs: frameIntervalsMs.slice(),
    }),
    dispose,
  }
}

type RequiredRenderers = {
  raw: boolean
  math: boolean
  code: boolean
  mermaid: boolean
}

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
    Array.from(bodies).every((body) => {
      const language = body.closest('[data-language]')?.getAttribute('data-language')
      if (!language || body.textContent?.length === 0) return true
      if (body.closest('[data-incomplete]')?.getAttribute('data-incomplete') === 'true') return true
      if (highlightingService().grammarFor(language) === null) return true
      return body.querySelector('span[style]') !== null
    })
  )
}

function ProductionMarkdownReplay({
  revision,
  documentId,
  count,
  text,
  live,
  onCommitted,
}: {
  readonly revision: number
  readonly documentId: number
  readonly count: number
  readonly text: string | null
  readonly live: boolean
  readonly onCommitted: (timestamp: number) => void
}) {
  useLayoutEffect(() => onCommitted(performance.now()), [onCommitted, revision])
  if (text === null) return null
  return Array.from({ length: count }, (_, index) => (
    <AssistantMarkdown key={`${documentId}-${index}`} streaming={live} text={text} />
  ))
}

function paintedFrame() {
  return new Promise<void>((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)))
}

function resourceTimings(since: number): ProductionResourceTiming[] {
  return performance.getEntriesByType('resource').flatMap((entry) => {
    if (!(entry instanceof PerformanceResourceTiming) || entry.startTime < since) return []
    return [
      {
        name: entry.name,
        kind: productionAssetKind(entry.name, entry.initiatorType),
        initiatorType: entry.initiatorType,
        startTime: entry.startTime,
        duration: entry.duration,
        transferSize: entry.transferSize,
        decodedBodySize: entry.decodedBodySize,
      },
    ]
  })
}

function browserMemory(): {
  readonly usedJSHeapSize: number
  readonly totalJSHeapSize: number
} | null {
  const memory: unknown = Reflect.get(performance, 'memory')
  if (!memory || typeof memory !== 'object') return null
  const used = Reflect.get(memory, 'usedJSHeapSize')
  const total = Reflect.get(memory, 'totalJSHeapSize')
  if (typeof used !== 'number' || typeof total !== 'number') return null
  return { usedJSHeapSize: used, totalJSHeapSize: total }
}

export async function outputReceipt(observation: Observation): Promise<ProductionOutputReceipt> {
  const bytes = new TextEncoder().encode(JSON.stringify(observation))
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return {
    digest: Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join(
      '',
    ),
    textBytes: new TextEncoder().encode(observation.text).byteLength,
    elementCount: observation.elements.length,
  }
}

function observeLongTasks() {
  const values: { readonly start: number; readonly duration: number }[] = []
  if (
    typeof PerformanceObserver === 'undefined' ||
    !PerformanceObserver.supportedEntryTypes.includes('longtask')
  )
    return {
      read: (_since: number, _until?: number) => null,
      clear: () => undefined,
      dispose: () => undefined,
    }
  const observer = new PerformanceObserver((list) => {
    for (const entry of list.getEntries())
      values.push({ start: entry.startTime, duration: entry.duration })
  })
  try {
    observer.observe({ type: 'longtask', buffered: true })
  } catch {
    return {
      read: (_since: number, _until?: number) => null,
      clear: () => undefined,
      dispose: () => undefined,
    }
  }
  return {
    read: (since: number, until = Infinity) => {
      for (const entry of observer.takeRecords())
        values.push({ start: entry.startTime, duration: entry.duration })
      return values
        .filter((entry) => entry.start >= since && entry.start <= until)
        .map((entry) => entry.duration)
    },
    clear: () => {
      observer.takeRecords()
      values.length = 0
    },
    dispose: () => observer.disconnect(),
  }
}

async function textDigest(source: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(source))
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

function maximumMemory(left: number | null, right: number | null) {
  return left === null || right === null ? null : Math.max(left, right)
}

async function waitUntil(deadline: number) {
  while (performance.now() < deadline)
    await new Promise<void>((resolve) =>
      setTimeout(resolve, Math.max(1, deadline - performance.now())),
    )
}

export function productionProbeLifecycle<T extends { dispose(): void | Promise<void> }>(
  pending: Promise<T>,
) {
  let current: T | null = null
  let disposed = false
  const ready = pending.then(async (value) => {
    if (disposed) {
      await value.dispose()
      throw createClientInvariantError('Production probe was disposed during initialization')
    }
    current = value
    return value
  })
  return {
    ready,
    current: () => current,
    dispose: async () => {
      if (disposed) return
      disposed = true
      const owner = current
      current = null
      await owner?.dispose()
    },
  }
}
