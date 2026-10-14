import { loadMarkdownExtension } from '@workspace/markdown/state/extensions'
import { vi } from 'vitest'

import { expect, test } from '../../../../test/fixtures'
import {
  checkChatExpectations,
  createMarkdownBrowser,
  observeMarkdownDom,
  paintedFrame,
  requiredElement,
  type MarkdownPaintReceipt,
} from '../../../../test/factories/markdown-browser'
import {
  MARKDOWN_CASES,
  type Expectation,
} from '../../../../../../packages/markdown/test/fixtures/cases'
import { observeHast, renderRemark } from '../../../../../../packages/markdown/test/qualification'
import {
  fixedChunks,
  mixedWorkload,
  pathologicalWorkloads,
  referenceRevisions,
  timelineWorkloads,
  type BenchmarkFamily,
  type Workload,
} from '../../../../../../scripts/markdown/workloads'

type BrowserMetric = {
  readonly family: BenchmarkFamily
  readonly fixture: string
  readonly revision: number
  readonly field: string
  readonly sample: number
  readonly unit: 'ms' | 'bytes' | 'count'
  readonly sourceBytes: number
  readonly outputMatches: boolean
  readonly trial: number
  readonly cacheState: string
}

type SourceProjection = {
  readonly expectations: readonly Expectation[]
  readonly parentPaths: readonly { readonly tag: string; readonly parents: readonly string[] }[]
}

const PROJECTION_TAGS: readonly string[] = [
  'p',
  'strong',
  'em',
  'a',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'ul',
  'ol',
  'li',
  'blockquote',
  'table',
  'thead',
  'tbody',
  'tr',
  'th',
  'td',
  'pre',
  'code',
  'hr',
  'input',
  'br',
  'del',
  'img',
  'details',
  'summary',
  'kbd',
  'sup',
  'sub',
  'section',
  'dl',
  'dt',
  'dd',
  'b',
  'i',
  's',
  'script',
  'iframe',
]

test('records real first-message mount to a matching painted frame', async () => {
  const fixture = MARKDOWN_CASES.find((entry) => entry.id === 'plain-paragraph')
  expect(fixture).toBeDefined()
  if (!fixture) return
  const proof = await createMarkdownBrowser()
  const receipt = await proof.update(fixture.source)
  expect(checkChatExpectations(proof.message(), fixture.expected)).toEqual([])
  metric({
    family: 'cold-mount',
    fixture: fixture.id,
    revision: receipt.revision,
    field: 'firstMeaningfulPaintMs',
    sample: receipt.painted - receipt.received,
    unit: 'ms',
    sourceBytes: bytes(fixture.source),
    outputMatches: true,
    trial: 0,
    cacheState: 'fresh React mount; loaded modules retained; development build',
  })
})

test.each([256, 2048, 8192, 32768, 131072])(
  'records warm completed-message commit and paint for %i bytes',
  async (size) => {
    const workload = mixedWorkload(size)
    const expected = expectedForSource(workload.source)
    const proof = await createMarkdownBrowser()
    await proof.update('Warmup.')
    const receipt = await proof.update(workload.source)
    expectSourceProjection(proof.message(), expected)
    latency('warm-completed', workload, receipt, 'completedToPaintMs')
  },
  30_000,
)

test('generated projection checks reject an unexpected empty semantic element', async () => {
  const source = 'Plain.'
  const expected = expectedForSource(source)
  const proof = await createMarkdownBrowser()
  await proof.update(source)
  expectSourceProjection(proof.message(), expected)
  requiredElement(proof.host, 'p').append(document.createElement('strong'))
  expect(checkChatExpectations(proof.message(), expected.expectations)).toContain(
    'strong: expected 0 elements, received 1',
  )
})

test('generated projection checks reject changed nesting with equal tag counts and text', async () => {
  const source = '**_label_**'
  const expected = expectedForSource(source)
  const proof = await createMarkdownBrowser()
  await proof.update(source)
  expectSourceProjection(proof.message(), expected)
  const paragraph = requiredElement(proof.host, 'p')
  const strong = requiredElement(proof.host, 'strong')
  const emphasis = requiredElement(proof.host, 'em')
  paragraph.replaceChildren(emphasis)
  emphasis.replaceChildren(strong)
  strong.textContent = 'label'
  expect(checkChatExpectations(proof.message(), expected.expectations)).toEqual([])
  expect(() => expectSourceProjection(proof.message(), expected)).toThrow()
})

test('records streamed prefixes, completion receipts, held syntax and release paint separately', async () => {
  const workload = mixedWorkload(256)
  const proof = await createMarkdownBrowser()
  let receipts = 0
  for (const chunk of fixedChunks(workload.source, 24)) {
    const expected = expectedForSource(chunk.text, true)
    const receipt = await proof.update(chunk.text, true)
    expectSourceProjection(proof.message(), expected)
    receipts += 1
    latency(
      'streaming-replay',
      { ...workload, id: `${workload.id}-prefix-${chunk.offset}`, sourceBytes: bytes(chunk.text) },
      receipt,
      'receiptToMatchingPaintMs',
    )
  }
  const settled = await proof.update(workload.source)
  expectSourceProjection(proof.message(), expectedForSource(workload.source))
  latency('streaming-replay', workload, settled, 'settlementPaintMs')
  const heldSource = 'Stable\n\n## '
  const held = await proof.update(heldSource, true)
  expect(observeMarkdownDom(proof.message()).text).toBe('Stable')
  latency(
    'streaming-replay',
    { id: 'held-heading', source: heldSource, sourceBytes: bytes(heldSource), shape: 'held' },
    held,
    'heldPrefixProcessingAndPaintMs',
  )
  const releasedSource = 'Stable\n\n## Ready'
  const released = await proof.update(releasedSource, true)
  expect(requiredElement(proof.host, 'h2').textContent).toBe('Ready')
  latency(
    'streaming-replay',
    {
      id: 'released-heading',
      source: releasedSource,
      sourceBytes: bytes(releasedSource),
      shape: 'held',
    },
    released,
    'heldReleasePaintMs',
  )
  metric({
    family: 'streaming-replay',
    fixture: workload.id,
    revision: settled.revision,
    field: 'completionReceipts',
    sample: receipts + 1,
    unit: 'count',
    sourceBytes: workload.sourceBytes,
    outputMatches: true,
    trial: 0,
    cacheState: 'warm modules; synchronous commit receipt plus two RAF checkpoints',
  })
})

test.each(pathologicalWorkloads(8192))(
  '$id records complete rendered output and large-message paint',
  async (workload) => {
    const expected = expectedForSource(workload.source)
    const proof = await createMarkdownBrowser()
    const receipt = await proof.update(workload.source)
    expectSourceProjection(proof.message(), expected)
    latency('pathological-scaling', workload, receipt, 'largeMessagePaintMs')
  },
  30_000,
)

test('records earlier-link publication through late definition edits and removal', async () => {
  const proof = await createMarkdownBrowser()
  for (const revision of referenceRevisions()) {
    const expected = expectedForSource(revision.source)
    const receipt = await proof.update(revision.source, true)
    expectSourceProjection(proof.message(), expected)
    latency(
      'reference-invalidation',
      {
        id: revision.id,
        source: revision.source,
        sourceBytes: bytes(revision.source),
        shape: 'references',
      },
      receipt,
      'earlierLinkPaintMs',
    )
  }
})

test('records combined code highlighting and loaded math publication on the real message', async () => {
  const proof = await createMarkdownBrowser()
  const code = '```ts\nconst answer: number = 42\n```'
  const receipt = await proof.update(code)
  await vi.waitFor(
    () =>
      expect(
        proof.host.querySelectorAll('[data-markdown="code-block-body"] span[style]').length,
      ).toBeGreaterThan(1),
    { timeout: 10_000 },
  )
  await paintedFrame()
  expect(requiredElement(proof.host, '[data-markdown="code-block-body"]').textContent).toBe(
    'const answer: number = 42',
  )
  metric({
    family: 'highlighting-extensions',
    fixture: 'typescript-highlight',
    revision: receipt.revision,
    field: 'combinedReadyPaintMs',
    sample: performance.now() - receipt.received,
    unit: 'ms',
    sourceBytes: bytes(code),
    outputMatches: true,
    trial: 0,
    cacheState: 'real theme and grammar loader; development build',
  })

  const math = 'Before $$x^2$$ after.'
  const mathReceipt = await proof.update(math)
  await loadMarkdownExtension('math')
  await vi.waitFor(() => expect(proof.host.querySelector('math')).not.toBeNull())
  await paintedFrame()
  expect(requiredElement(proof.host, 'p').textContent).toContain('Before')
  expect(requiredElement(proof.host, 'p').textContent).toContain('after.')
  metric({
    family: 'highlighting-extensions',
    fixture: 'loaded-math',
    revision: mathReceipt.revision,
    field: 'combinedReadyPaintMs',
    sample: performance.now() - mathReceipt.received,
    unit: 'ms',
    sourceBytes: bytes(math),
    outputMatches: true,
    trial: 0,
    cacheState: 'real KaTeX stage; development build',
  })
}, 30_000)

test.each([1, 20, 100])(
  'records %i simultaneous real messages while the final message streams',
  async (count) => {
    const source = 'A **rendered** answer.'
    const workloads = timelineWorkloads(count, source)
    const proof = await createMarkdownBrowser()
    const messages = workloads.map((workload) => ({
      id: workload.id,
      text: workload.source,
      live: false,
    }))
    const receipt = await proof.updateMessages(messages)
    expect(proof.host.querySelectorAll('[data-chat-markdown]')).toHaveLength(count)
    expect(proof.host.querySelectorAll('strong')).toHaveLength(count)
    expect(
      Array.from(proof.host.querySelectorAll('strong'), (element) => element.textContent),
    ).toEqual(Array.from({ length: count }, () => 'rendered'))
    latency(
      'timeline-input',
      { id: `messages-${count}`, source, sourceBytes: count * bytes(source), shape: 'messages' },
      receipt,
      'simultaneousMessagesReadyPaintMs',
    )
    const streamed = messages
      .slice(0, -1)
      .concat([{ id: messages.at(-1)?.id ?? 'last', text: source + ' Tail **grows', live: true }])
    const update = await proof.updateMessages(streamed)
    expect(proof.host.querySelectorAll('[data-chat-markdown]')).toHaveLength(count)
    expect(proof.host.querySelectorAll('strong')).toHaveLength(count + 1)
    latency(
      'timeline-input',
      {
        id: `messages-${count}-stream`,
        source,
        sourceBytes: count * bytes(source) + bytes(' Tail **grows'),
        shape: 'messages',
      },
      update,
      'lastMessageUpdateToPaintMs',
    )
  },
  30_000,
)

test('records observed DOM and query cleanup across twenty message lifetimes', async () => {
  const source = 'Cycle **completed**.'
  const begin = performance.now()
  for (let trial = 0; trial < 20; trial += 1) {
    const proof = await createMarkdownBrowser()
    await proof.update(source, true)
    await proof.update(source)
    expect(requiredElement(proof.host, 'strong').textContent).toBe('completed')
    const disposal = proof.dispose()
    expect(disposal.queryObserversAfterUnmount).toBe(0)
    expect(disposal.queryEntriesAfterHarnessClear).toBe(0)
    expect(proof.host.isConnected).toBe(false)
    metric({
      family: 'resources',
      fixture: 'message-disposal',
      revision: 2,
      field: 'queryObserversAfterUnmount',
      sample: disposal.queryObserversAfterUnmount,
      unit: 'count',
      sourceBytes: bytes(source),
      outputMatches: true,
      trial,
      cacheState:
        'owned app query observers after React unmount, before harness cache clear; shared renderer caches retained',
    })
    metric({
      family: 'resources',
      fixture: 'message-disposal',
      revision: 2,
      field: 'queryEntriesBeforeHarnessClear',
      sample: disposal.queryEntriesBeforeClear,
      unit: 'count',
      sourceBytes: bytes(source),
      outputMatches: true,
      trial,
      cacheState:
        'cached entries before explicit harness queryClient.clear; retained inactive cache entries are allowed',
    })
    metric({
      family: 'resources',
      fixture: 'message-disposal',
      revision: 2,
      field: 'queryEntriesAfterHarnessClear',
      sample: disposal.queryEntriesAfterHarnessClear,
      unit: 'count',
      sourceBytes: bytes(source),
      outputMatches: true,
      trial,
      cacheState:
        'explicit harness queryClient.clear result; does not measure renderer subscriptions',
    })
  }
  metric({
    family: 'resources',
    fixture: 'message-disposal',
    revision: 40,
    field: 'retainedMessageNodes',
    sample: document.querySelectorAll('[data-markdown-proof]').length,
    unit: 'count',
    sourceBytes: bytes(source),
    outputMatches: true,
    trial: 19,
    cacheState: 'after twenty create/update/dispose cycles',
  })
  metric({
    family: 'resources',
    fixture: 'message-disposal',
    revision: 40,
    field: 'cyclesElapsedMs',
    sample: performance.now() - begin,
    unit: 'ms',
    sourceBytes: bytes(source),
    outputMatches: true,
    trial: 19,
    cacheState: 'includes fixture setup and teardown; diagnostic only',
  })
}, 30_000)

test('records actual Resource Timing entries exposed during code and math publication', async () => {
  const proof = await createMarkdownBrowser()
  const source = '```ts\nconst payload = true\n```\n\nInline $$x^2$$ result.'
  const start = performance.now()
  const receipt = await proof.update(source)
  await loadMarkdownExtension('math')
  await vi.waitFor(() => expect(proof.host.querySelector('math')).not.toBeNull())
  await paintedFrame()
  expect(requiredElement(proof.host, '[data-markdown="code-block-body"]').textContent).toBe(
    'const payload = true',
  )
  const entries = performance
    .getEntriesByType('resource')
    .filter(
      (entry): entry is PerformanceResourceTiming =>
        entry instanceof PerformanceResourceTiming && entry.startTime >= start,
    )
  const transferred = entries.reduce((sum, entry) => sum + entry.transferSize, 0)
  metric({
    family: 'payload',
    fixture: 'code-and-math',
    revision: receipt.revision,
    field: 'observedTransferBytes',
    sample: transferred,
    unit: 'bytes',
    sourceBytes: bytes(source),
    outputMatches: true,
    trial: 0,
    cacheState:
      'Resource Timing visible entries during mount; cached or cross-origin transfers may report zero',
  })
  metric({
    family: 'payload',
    fixture: 'code-and-math',
    revision: receipt.revision,
    field: 'observedResourceRequests',
    sample: entries.length,
    unit: 'count',
    sourceBytes: bytes(source),
    outputMatches: true,
    trial: 0,
    cacheState:
      'development build; loaded modules retained; does not measure total production payload',
  })
}, 30_000)

function metric(record: BrowserMetric) {
  console.info(
    'MARKDOWN_BROWSER_METRIC ' +
      JSON.stringify({ ...record, build: 'development', engine: 'remark' }),
  )
}

function latency(
  family: BenchmarkFamily,
  workload: Workload,
  receipt: MarkdownPaintReceipt,
  field: string,
) {
  metric({
    family,
    fixture: workload.id,
    revision: receipt.revision,
    field,
    sample: receipt.painted - receipt.received,
    unit: 'ms',
    sourceBytes: workload.sourceBytes,
    outputMatches: true,
    trial: 0,
    cacheState:
      'development build; loaded modules retained; synchronous commit plus two RAF checkpoints',
  })
}

function expectedForSource(source: string, live = false): SourceProjection {
  const relevantTags = new Set(PROJECTION_TAGS)
  const elements = observeHast(renderRemark(source, live)).elements.filter((element) =>
    relevantTags.has(element.tag),
  )
  const expectations = PROJECTION_TAGS.map((tag) => {
    const matches = elements.filter((element) => element.tag === tag)
    return {
      tag,
      count: matches.length,
      texts: matches.map((element) => element.text),
      attributes: matches.map((element) => semanticAttributes(element.attributes)),
    }
  })
  return {
    expectations,
    parentPaths: elements.map((element) => ({
      tag: element.tag,
      parents: (element.parents ?? []).filter((tag) => relevantTags.has(tag)),
    })),
  }
}

function expectSourceProjection(host: HTMLElement, expected: SourceProjection): void {
  expect(checkChatExpectations(host, expected.expectations)).toEqual([])
  const tags = new Set(PROJECTION_TAGS)
  const parentPaths = observeMarkdownDom(host)
    .elements.filter((element) => tags.has(element.tag))
    .map((element) => ({
      tag: element.tag,
      parents: (element.parents ?? []).filter((tag) => tags.has(tag)),
    }))
  expect(parentPaths).toEqual(expected.parentPaths)
}

function semanticAttributes(
  attributes: Readonly<Record<string, string>>,
): Readonly<Record<string, string>> {
  const names = new Set([
    'href',
    'title',
    'start',
    'checked',
    'disabled',
    'type',
    'align',
    'alt',
    'src',
    'data-incomplete',
    'data-meta',
  ])
  const selected = Object.fromEntries(
    Object.entries(attributes).filter(([name]) => names.has(name)),
  )
  if (attributes.class?.startsWith('language-')) selected.class = attributes.class
  return selected
}

function bytes(source: string) {
  return new TextEncoder().encode(source).byteLength
}
