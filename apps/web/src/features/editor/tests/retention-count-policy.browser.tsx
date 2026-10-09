import { createEditorBufferSession } from '@singapore-editor/core/document'
import { Editor, createEditorStructuralOperation } from '@singapore-editor/core/editor'
import { afterAll, afterEach, expect, inject, test } from 'vitest'
import { commands } from 'vitest/browser'
import '@singapore-editor/core/style.css'
import { pieceTableSnapshotsHaveSameText } from '@singapore-editor/textbuffer'
import { DEFAULT_SETTING_VALUES } from '@workspace/contracts'
import {
  delayRetentionInspectors,
  retentionCountHost,
} from '../../../../test/factories/retention-count-policy'
import {
  RETENTION_COUNT_PROTOCOL,
  type RetentionRun,
} from '../../../../test/factories/retention-count-policy-protocol'

declare module 'vitest' {
  interface ProvidedContext {
    retentionRun: RetentionRun | undefined
  }
}

declare module 'vitest/browser' {
  interface BrowserCommands {
    retentionManifest(): Promise<RetentionRun>
    retentionSample(sample: unknown): Promise<void>
    retentionScreenshot(label: string): Promise<void>
  }
}

async function record(sample: unknown) {
  const observed =
    typeof sample === 'object' && sample !== null
      ? { ...sample, observedAt: new Date().toISOString() }
      : { sample, observedAt: new Date().toISOString() }
  if (typeof commands.retentionSample === 'function') await commands.retentionSample(observed)
  else console.info('retention-count-sample', JSON.stringify(observed))
  if (
    typeof sample === 'object' &&
    sample !== null &&
    'point' in sample &&
    typeof sample.point === 'object' &&
    sample.point !== null &&
    'consistent' in sample.point
  )
    expect(sample.point.consistent).toBe(true)
}

const discoveryRun = {
  sourceHead: 'vitest-discovery-pilot',
  protocol: RETENTION_COUNT_PROTOCOL,
  cycles: 20,
  fixtures: [
    { id: 'tree-ts-pilot', provider: 'tree-sitter', language: 'typescript', sourceUnits: 4096 },
  ],
} satisfies RetentionRun
const collectedRun = inject('retentionRun') ?? discoveryRun
let runRecord: Promise<void> | null = null
const caseOutcomes: { fixture: string; status: string; errors: unknown[] }[] = []
let activeCase: { dispose(): Promise<void>; flight: Promise<void>; stopAbort(): void } | null = null

async function configuration() {
  if (typeof commands.retentionManifest === 'function') return commands.retentionManifest()
  return discoveryRun
}
async function recordRun() {
  const run = await configuration()
  expect(run).toEqual(collectedRun)
  expect(DEFAULT_SETTING_VALUES['editor.inactiveAnalysisEntryLimit']).toBe(
    run.protocol.expectedInactiveEntryLimit,
  )
  await record({
    kind: 'run',
    ...run,
    acceptance: 'headless-resource-diagnostic',
    browser: {
      userAgent: navigator.userAgent,
      crossOriginIsolated,
      devicePixelRatio,
      hardwareConcurrency: navigator.hardwareConcurrency,
    },
    limits: [
      'hardware-input-performance-unqualified',
      'active-range-prune-unqualified',
      'obsolete-abandoned-preparation-caller-matrix-unqualified',
    ],
  })
}

for (const fixture of collectedRun.fixtures) {
  test(`actual retention fixture ${fixture.id}`, async (context) => {
    let ownedHost: Host | null = null
    const dispose = async () => {
      await ownedHost?.dispose()
    }
    const abort = () => {
      void dispose().catch(() => undefined)
    }
    context.signal.addEventListener('abort', abort, { once: true })
    context.onTestFinished(async ({ task }) => {
      const outcome = {
        fixture: fixture.id,
        status: task.result?.state ?? 'fail',
        errors: task.result?.errors ?? [],
      }
      caseOutcomes.push(outcome)
      await record({ kind: 'fixture-case-complete', cycle: collectedRun.cycles, ...outcome })
    })
    const flight = runCase(fixture, (host) => {
      ownedHost = host
      if (context.signal.aborted) abort()
    })
    activeCase = {
      dispose,
      flight,
      stopAbort: () => context.signal.removeEventListener('abort', abort),
    }
    await flight
  }, 600_000)
}

test(
  'twenty actual view open/close cycles keep entries, worker sessions and packed bytes flat',
  { timeout: 120_000 },
  async (context) => {
    const host = await retentionCountHost(discoveryRun.fixtures[0]!)
    context.onTestFinished(() => host.dispose())
    const container = document.createElement('div')
    container.style.cssText = 'height: 240px; width: 600px;'
    document.body.append(container)
    context.onTestFinished(() => container.remove())
    const samples: {
      entries: number
      structuralSessions: number
      highlighterSessions: number
      tokenStoreBackingBytes: number
    }[] = []
    for (let cycle = 1; cycle <= 20; cycle++) {
      const editor = new Editor(container, {
        plugins: [
          {
            activate: (view) => [
              view.registerSyntaxProvider(host.structuralProvider),
              view.registerHighlighter(host.highlighterProvider),
            ],
          },
        ],
      })
      try {
        editor.attachSession(createEditorBufferSession(host.a.buffer), {
          analysis: host.a.analysis,
          documentId: host.a.analysis.documentId,
          languageId: 'typescript',
          structuralConfigurationTag: ['cycle'],
          highlighterConfigurationTag: ['cycle'],
        })
        await host.settle()
        expect(editor.getState().initialHighlightStatus).toBe('painted')
        expect(editor.materializeFullText()).toBe(`dirty ${host.expectedSource}`)
      } finally {
        editor.dispose()
      }
      const sample = await host.sample('actual-open-close-cycle', cycle)
      expect(sample.point.consistent).toBe(true)
      expect(sample.bound.passes).toBe(true)
      const resources = {
        entries: sample.entryCount,
        structuralSessions: sample.treeWorker?.documentCount ?? 0,
        highlighterSessions: sample.shikiWorker?.documentCount ?? 0,
        tokenStoreBackingBytes: sample.inspections.reduce(
          (sum, inspection) => sum + inspection.tokenStoreBackingBytes,
          0,
        ),
      }
      expect(resources.entries).toBeGreaterThan(0)
      expect(resources.structuralSessions).toBeGreaterThan(0)
      expect(resources.highlighterSessions).toBeGreaterThan(0)
      expect(resources.tokenStoreBackingBytes).toBeGreaterThan(0)
      samples.push(resources)
      expect(resources).toEqual(samples[0])
    }
    await context.annotate(
      JSON.stringify({ cycles: samples.length, samples }),
      'actual-open-close-retention-plateau',
    )
    expect(samples).toHaveLength(20)
    await host.dispose()
    expect(await host.tree.inspectRetention()).toBeNull()
    expect(await host.shiki.inspectRetention()).toBeNull()
  },
)

async function runCase(fixture: RetentionRun['fixtures'][number], ownHost: (host: Host) => void) {
  try {
    runRecord ??= recordRun()
    await runRecord
    await verifyFixture(fixture, collectedRun.cycles, ownHost)
  } catch (error) {
    await record({
      kind: 'failure',
      fixture: fixture.id,
      message: String(error),
      stack: error instanceof Error ? error.stack : null,
    })
    throw error
  }
}

afterEach(async () => {
  const owned = activeCase
  if (!owned) return
  try {
    const [released] = await Promise.allSettled([owned.dispose(), owned.flight])
    if (released.status === 'rejected') throw released.reason
  } finally {
    owned.stopAbort()
    activeCase = null
  }
})
afterAll(async () => {
  const failures = caseOutcomes.filter((outcome) => outcome.status !== 'pass')
  await record({
    kind: 'result',
    fixtures: collectedRun.fixtures.length,
    cycles: collectedRun.cycles,
    failures,
    cases: caseOutcomes,
  })
  expect(caseOutcomes).toHaveLength(collectedRun.fixtures.length)
  expect(failures).toEqual([])
})

async function verifyFixture(
  fixture: RetentionRun['fixtures'][number],
  cycles: number,
  ownHost: (host: Host) => void,
) {
  const host = await retentionCountHost(fixture)
  ownHost(host)
  const b = host.borrow(host.b.analysis)
  let bView: ReturnType<Host['createView']> | null = null
  try {
    await verifyText(host, host.a, `dirty ${host.expectedSource}`, 'canonical-a-ingested-dirty', 0)
    await verifyText(host, host.b, host.expectedSource, 'canonical-b-ingested', 0)
    await verifyIdleInspectors(host, b, fixture.id)
    await record({
      fixture: fixture.id,
      arm: 'cold-ready-preparation-start',
      cycle: 0,
      observation: host.observation.snapshot(),
    })
    const metadataOnly = await host.metadataOnlyControl()
    await record({
      fixture: fixture.id,
      arm: 'cold-metadata-only-negative',
      cycle: 0,
      ...metadataOnly,
    })
    expect(metadataOnly.metadataMatched).toBe(true)
    expect(metadataOnly.runtimeSessionIds).toEqual({ structural: [], highlighter: [] })
    expect(metadataOnly.acquisition?.structural).toBeNull()
    expect(metadataOnly.acquisition?.highlighter).toBeNull()
    await host.prepareViewMetadata()
    const metadata = host.metadataReceipt()
    await record({
      ...(await host.sample('cold-ready-preparation-complete', 0, [b])),
      metadata,
      coldWork: host.observation.receipt(),
    })
    for (const owner of metadata) {
      expect(owner.source.current).toBe(true)
      expect(owner.stages.state).toBe('settled')
      expect(owner.stages).toMatchObject({ structural: 'ready', highlighter: 'ready' })
      expect(owner.configuration.loaderCount).toBe(0)
    }
    bView = host.createView('b', host.b)
    await record({
      fixture: fixture.id,
      arm: 'actual-b-synchronous-attachment',
      ...bView.attachment,
    })
    assertReadyAttachment(bView.attachment)
    await verifyProviderBaseline(host, fixture)
    await host.refresh(b, host.b.analysis)
    const bIds = [b.structural.runtimeSessionId, b.highlighter.runtimeSessionId]
    await record(await host.sample('baseline-active-b', 0, [b]))
    await verifyActualViews(host, b, bView, fixture.id)
    const acquiredMetadata = host.metadataReceipt()
    host.releaseViewMetadata()
    const releasedPreparation = await host.sample('preparation-owner-release-before-pressure', 0, [
      b,
    ])
    await record({ ...releasedPreparation, acquiredMetadata, metadata: host.metadataReceipt() })
    expect(host.metadataReceipt()).toEqual([])
    expect(
      releasedPreparation.inspections
        .flatMap((inspection) => inspection.entries)
        .reduce((total, entry) => total + entry.displayDemand.preparationLeases, 0),
    ).toBe(0)
    await record({
      fixture: fixture.id,
      arm: 'actual-geometry-before-cycles',
      cycle: 0,
      geometry: host.assertGeometry(),
    })
    const bEntries = activeRuntimeIds(host.b.analysis)
    for (let cycle = 1; cycle <= cycles; cycle++) {
      await verifyCycle(host, b, bIds, cycle)
      expect(activeRuntimeIds(host.b.analysis)).toEqual(bEntries)
      await record({
        kind: RETENTION_COUNT_PROTOCOL.successfulCycleMarker,
        fixture: fixture.id,
        cycle,
      })
    }
    await verifyRangeHistory(host, b, cycles)
    await verifyGlobalEnvironments(host, b, cycles)
    await verifyPendingFailed(host, b, cycles)
    await verifyGrowthControl(host, b, cycles)
    await record({
      ...(await host.sample('post-pressure-preparation-ownership', cycles, [b])),
      metadata: host.metadataReceipt(),
    })
    host.application.getSnapshot().editor.dispose()
    await host.settle()
    expect(
      host.a.analysis.borrowStructural({
        provider: { operation: createEditorStructuralOperation(() => null) },
        languageId: fixture.language,
      }),
    ).toBeNull()
    host.bSession.setSelection(0)
    host.bSession.breakTypingRun()
    host.bSession.applyText('survivor ')
    await host.refresh(b, host.b.analysis)
    expect([b.structural.runtimeSessionId, b.highlighter.runtimeSessionId]).toEqual(bIds)
    await verifyText(
      host,
      host.b,
      `survivor ${'b '.repeat(cycles)}${host.expectedSource}`,
      'canonical-b-survivor-edit',
      cycles,
    )
    host.bSession.undo()
    await verifyText(
      host,
      host.b,
      `${'b '.repeat(cycles)}${host.expectedSource}`,
      'canonical-b-survivor-undo',
      cycles,
    )
    host.bSession.redo()
    await verifyText(
      host,
      host.b,
      `survivor ${'b '.repeat(cycles)}${host.expectedSource}`,
      'canonical-b-survivor-redo',
      cycles,
    )
    await record(await host.sample('environment-release-b-survives', cycles, [b]))
    bView.dispose()
    host.release(b)
    host.application.dispose()
    const final = await host.sample('final-document-owner-release', cycles)
    await record(final)
    expect(final.ownerCount).toBe(0)
    expect(final.treeWorker?.documentCount).toBe(0)
    expect(final.shikiWorker?.documentCount).toBe(0)
    expect(final.treeOwner.lifecycle).toBe('ready')
    expect(final.shikiOwner.lifecycle).toBe('ready')
  } finally {
    bView?.dispose()
    host.release(b)
    await host.dispose()
    await record({
      fixture: fixture.id,
      arm: 'observation-owner-release',
      cycle: cycles,
      ...host.observation.receipt(),
    })
  }
  const terminal = {
    fixture: fixture.id,
    arm: 'terminal-workers',
    cycle: cycles,
    tree: await host.tree.inspectRetention(),
    shiki: await host.shiki.inspectRetention(),
  }
  await record(terminal)
  expect(terminal.tree).toBeNull()
  expect(terminal.shiki).toBeNull()
}

type Host = Awaited<ReturnType<typeof retentionCountHost>>
type Pair = ReturnType<Host['borrow']>

async function verifyCycle(host: Host, b: Pair, bIds: readonly string[], cycle: number) {
  const a = host.borrow(host.a.analysis)
  const second = host.borrow(host.a.analysis)
  await host.refresh(a, host.a.analysis)
  expect(second.structural.runtimeSessionId).toBe(a.structural.runtimeSessionId)
  expect(second.highlighter.runtimeSessionId).toBe(a.highlighter.runtimeSessionId)
  await record(await host.sample('active-two-compatible-views', cycle, [a, second, b]))
  host.release(second)
  const ids = [a.structural.runtimeSessionId, a.highlighter.runtimeSessionId]
  host.release(a)
  const warm = await host.sample('warm-two-family-release', cycle, [b])
  await record(warm)
  expect(warm.bound.passes).toBe(true)
  expect(warm.inactiveEntries).toBe(DEFAULT_SETTING_VALUES['editor.inactiveAnalysisEntryLimit'])
  const interval = await host.observation.interval(() => host.borrow(host.a.analysis), host.settle)
  const reborrowed = interval.value
  const warmObservation = {
    fixture: warm.fixture,
    cycle,
    arm: 'synchronous-warm-attachment',
    runtimeIds: [reborrowed.structural.runtimeSessionId, reborrowed.highlighter.runtimeSessionId],
    reads: [reborrowed.structural.read().kind, reborrowed.highlighter.read().kind],
    requests: interval.requests,
    sourceReads: interval.reads,
    completion: interval.observation,
  }
  await record(warmObservation)
  expect(warmObservation.runtimeIds).toEqual(ids)
  expect(warmObservation.reads).toEqual(['ready', 'ready'])
  assertWarmInterval(interval)
  host.release(reborrowed)
  for (const document of host.working) {
    const pressure = host.borrow(document.analysis, `configuration-${cycle}`)
    await host.refresh(pressure, document.analysis)
    host.release(pressure)
    const settled = await host.sample('configuration-history-pressure', cycle, [b])
    await record(settled)
    expect(settled.bound.passes).toBe(true)
  }
  const cold = host.borrow(host.a.analysis)
  expect(cold.structural.runtimeSessionId).not.toBe(ids[0])
  expect(cold.highlighter.runtimeSessionId).not.toBe(ids[1])
  await host.refresh(cold, host.a.analysis)
  cold.structural.setDisplayDemand({
    kind: 'frame',
    snapshot: host.a.buffer.getTextSnapshot(),
    ranges: [{ startIndex: 0, endIndex: 2048 }],
  })
  const rangeStart = (cycle * 2048) % (host.a.buffer.getTextSnapshot().length - 2048)
  await cold.structural.queryRange({ startIndex: rangeStart, endIndex: rangeStart + 2048 })
  const activeRange = await host.sample('active-range-history-diagnostic', cycle, [cold, b])
  await record(activeRange)
  host.release(cold)
  expect(host.a.buffer.getRevision()).toBe(host.dirtyRevision)
  expect(host.a.buffer.isDirty()).toBe(true)
  await verifyText(
    host,
    host.a,
    `dirty ${host.expectedSource}`,
    'canonical-a-after-pressure',
    cycle,
  )
  expect(pieceTableSnapshotsHaveSameText(host.a.buffer.getSnapshot(), host.dirtySnapshot)).toBe(
    true,
  )
  host.aSession.undo()
  await verifyText(host, host.a, host.expectedSource, 'canonical-a-undo', cycle)
  expect(host.a.buffer.isDirty()).toBe(false)
  expect(pieceTableSnapshotsHaveSameText(host.a.buffer.getSnapshot(), host.savedSnapshot)).toBe(
    true,
  )
  host.aSession.redo()
  await verifyText(host, host.a, `dirty ${host.expectedSource}`, 'canonical-a-redo', cycle)
  expect(pieceTableSnapshotsHaveSameText(host.a.buffer.getSnapshot(), host.dirtySnapshot)).toBe(
    true,
  )
  host.dirtyRevision = host.a.buffer.getRevision()
  host.bSession.setSelection(0)
  host.bSession.breakTypingRun()
  host.bSession.applyText('b ')
  await verifyText(
    host,
    host.b,
    `${'b '.repeat(cycle)}${host.expectedSource}`,
    'canonical-b-edit',
    cycle,
  )
  host.bSession.undo()
  await verifyText(
    host,
    host.b,
    `${'b '.repeat(cycle - 1)}${host.expectedSource}`,
    'canonical-b-undo',
    cycle,
  )
  host.bSession.redo()
  await verifyText(
    host,
    host.b,
    `${'b '.repeat(cycle)}${host.expectedSource}`,
    'canonical-b-redo',
    cycle,
  )
  await host.refresh(b, host.b.analysis)
  expect([b.structural.runtimeSessionId, b.highlighter.runtimeSessionId]).toEqual(bIds)
  expect(b.structural.read().revision).toBe(host.b.buffer.getRevision())
  expect(b.highlighter.read().revision).toBe(host.b.buffer.getRevision())
  expect(host.b.buffer.getTextSnapshot().readRange(0, cycle * 2)).toBe('b '.repeat(cycle))
  const end = await host.sample('cycle-end', cycle, [b])
  await record(end)
  expect(end.bound.passes).toBe(true)
  expect(end.treeOwner.pendingRequests).toBe(0)
  expect(end.shikiOwner.pendingRequests).toBe(0)
  expect(end.shikiWorker?.retiredRuntimeCount).toBeLessThanOrEqual(
    end.shikiWorker?.retiredRuntimeLimit ?? 0,
  )
}

function activeRuntimeIds(analysis: Host['a']['analysis']) {
  return analysis
    .inspectRetention()
    .entries.filter((entry) => entry.leaseCount > 0)
    .map((entry) => entry.runtimeSessionId)
    .sort()
}

async function verifyText(
  host: Host,
  document: Host['a'],
  expected: string,
  arm: string,
  cycle: number,
) {
  const actual = host.observation.verifierRead(() => {
    const snapshot = document.buffer.getTextSnapshot()
    return snapshot.readRange(0, snapshot.length)
  })
  const [expectedSha256, observedSha256] = await Promise.all([
    contentHash(expected),
    contentHash(actual),
  ])
  await record({
    fixture: host.fixtureId,
    documentId: document.analysis.documentId,
    arm,
    cycle,
    expectedUnits: expected.length,
    observedUnits: actual.length,
    expectedSha256,
    observedSha256,
    provenance: 'independent-fixture-text-and-intended-edits',
  })
  expect(observedSha256).toBe(expectedSha256)
  expect(actual).toBe(expected)
}

async function contentHash(text: string) {
  const bytes = new Uint8Array(
    await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)),
  )
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
}

async function verifyIdleInspectors(host: Host, b: Pair, fixture: string) {
  await host.refresh(b, host.b.analysis)
  await Promise.all([host.tree.awaitIdleFence(), host.shiki.awaitIdleFence()])
  const before = { tree: host.tree.inspect(), shiki: host.shiki.inspect() }
  const [treeWorker, shikiWorker] = await Promise.all([
    host.tree.inspectRetention(),
    host.shiki.inspectRetention(),
  ])
  const after = { tree: host.tree.inspect(), shiki: host.shiki.inspect() }
  const beforeScheduledNegative = host.observation.snapshot().generation
  const scheduledNegative = host.observation.calibrate()
  const scheduledNegativeEvents = host.observation.changesSince(beforeScheduledNegative)
  const readNegative = await host.observation.interval(() => {
    const snapshot = host.a.buffer.getTextSnapshot()
    snapshot.readRange(0, snapshot.length)
  }, host.settle)
  await record({
    fixture,
    arm: 'idle-inspector-calibration',
    cycle: 0,
    before,
    after,
    treeWorker,
    shikiWorker,
    scheduledNegative,
    scheduledNegativeEvents,
    fullRangeReadNegative: {
      requests: readNegative.requests,
      reads: readNegative.reads,
      observation: readNegative.observation,
    },
  })
  expect(scheduledNegativeEvents.truncated).toBe(false)
  expect(scheduledNegativeEvents.events).toContainEqual({
    generation: scheduledNegative.generation,
    cause: { kind: 'schedule', key: 'verification-delayed-control' },
  })
  expect(before.tree.pendingRequests).toBe(0)
  expect(before.shiki.pendingRequests).toBe(0)
  expect(after.tree.pendingRequests).toBe(0)
  expect(after.shiki.pendingRequests).toBe(0)
  expect(after.tree.workerGeneration).toBe(before.tree.workerGeneration)
  expect(after.shiki.workerGeneration).toBe(before.shiki.workerGeneration)
  expect(readNegative.reads.reduce((sum, read) => sum + read.fullTextReads, 0)).toBeGreaterThan(0)
}

async function verifyProviderBaseline(host: Host, fixture: RetentionRun['fixtures'][number]) {
  if (fixture.provider === 'tree-sitter') {
    const lease = host.a.analysis.borrowStructural({
      provider: host.structuralProvider,
      languageId: fixture.language,
      configurationTag: ['provider-baseline'],
    })
    if (!lease) throw new TypeError('Structural provider baseline unavailable')
    await lease.refresh(host.a.buffer.getTextSnapshot())
    await lease.queryRange({ startIndex: 0, endIndex: 2048 })
    await record(await host.sample('selected-provider-baseline', 0))
    lease.dispose()
    return
  }
  const lease = host.a.analysis.borrowHighlighter({
    provider: host.highlighterProvider,
    languageId: fixture.language,
    configurationTag: ['provider-baseline'],
  })
  if (!lease) throw new TypeError('Highlighter provider baseline unavailable')
  await lease.refresh(host.a.buffer.getTextSnapshot())
  await record(await host.sample('selected-provider-baseline', 0))
  lease.dispose()
}

async function verifyRangeHistory(host: Host, b: Pair, cycles: number) {
  const active = host.borrow(host.a.analysis, 'range-history')
  try {
    await host.refresh(active, host.a.analysis)
    const snapshot = host.a.buffer.getTextSnapshot()
    active.structural.setDisplayDemand({
      kind: 'frame',
      snapshot,
      ranges: [{ startIndex: 0, endIndex: 1024 }],
    })
    for (let cycle = 1; cycle <= cycles; cycle++) {
      const startIndex = Math.floor(((snapshot.length - 1024) * cycle) / cycles)
      await active.structural.queryRange({ startIndex, endIndex: startIndex + 1024 })
      await record(await host.sample('continuously-active-range-history', cycle, [active, b]))
    }
  } finally {
    host.release(active)
  }
}

async function verifyGrowthControl(host: Host, b: Pair, cycle: number) {
  host.setLimit(Number.MAX_SAFE_INTEGER)
  await host.settle()
  for (const document of host.working) {
    const retained = host.borrow(document.analysis, 'growth-negative')
    await host.refresh(retained, document.analysis)
    host.release(retained)
  }
  const growth = await host.sample('retained-growth-negative', cycle, [b])
  await record(growth)
  expect(growth.bound.passes).toBe(false)
  host.setLimit(0)
  const trimmed = await host.sample('explicit-zero-trim', cycle, [b])
  await record(trimmed)
  expect(trimmed.inactiveEntries).toBe(0)
  expect(trimmed.activeEntries).toBeGreaterThanOrEqual(2)
}

async function verifyGlobalEnvironments(host: Host, b: Pair, cycle: number) {
  host.setLimit(0)
  await host.settle()
  host.setLimit(Number.MAX_SAFE_INTEGER)
  const left = host.working[0]
  const right = host.secondaryWorking[0]
  if (!left || !right) throw new TypeError('Two retained environment fixture owners are required')
  for (const document of [left, right]) {
    const pair = host.borrow(document.analysis, 'global-environment-pressure')
    await host.refresh(pair, document.analysis)
    host.release(pair)
  }
  const before = await host.sample('both-environments-retained-negative', cycle, [b])
  await record(before)
  expect(before.inactiveEntries).toBe(4)
  expect(
    left.analysis.inspectRetention().entries.filter((entry) => entry.leaseCount === 0),
  ).toHaveLength(2)
  expect(
    right.analysis.inspectRetention().entries.filter((entry) => entry.leaseCount === 0),
  ).toHaveLength(2)
  expect(before.ownerCount).toBe(RETENTION_COUNT_PROTOCOL.workingDocumentCount)
  expect(before.bound.passes).toBe(false)
  host.setLimit(RETENTION_COUNT_PROTOCOL.expectedInactiveEntryLimit)
  const global = await host.sample('both-environments-global-trim', cycle, [b])
  await record(global)
  expect(global.inactiveEntries).toBe(2)
  expect(global.bound.passes).toBe(true)
  expect(Array.from(host.application.enumerateRetainedEditorAnalyses())).toContain(left.analysis)
  expect(Array.from(host.application.enumerateRetainedEditorAnalyses())).toContain(right.analysis)
  expect(Array.from(host.application.enumerateRetainedEditorAnalyses())).toContain(host.b.analysis)
}

async function verifyActualViews(
  host: Host,
  b: Pair,
  bView: ReturnType<Host['createView']>,
  fixture: string,
) {
  bView.editor.setSelection(23)
  const bSelection = bView.editor.getSelections()
  const first = host.createView('a-first')
  const second = host.createView('a-second')
  try {
    await record({
      fixture,
      arm: 'actual-a-synchronous-attachments',
      attachments: [first.attachment, second.attachment],
    })
    assertReadyAttachment(first.attachment)
    assertReadyAttachment(second.attachment)
    first.editor.setSelection(10)
    second.editor.setSelection(50)
    first.editor.setScrollPosition({ top: 48 })
    second.editor.setScrollPosition({ top: 144 })
    await expect
      .poll(() =>
        host.a.analysis
          .inspectRetention()
          .entries.filter((entry) => entry.leaseCount === 2)
          .map((entry) => entry.status),
      )
      .toEqual(['ready', 'ready'])
    const ids = host.a.analysis
      .inspectRetention()
      .entries.filter((entry) => entry.leaseCount === 2)
      .map((entry) => entry.runtimeSessionId)
      .sort()
    expect(first.editor.getSelections()).not.toEqual(second.editor.getSelections())
    expect(first.editor.getScrollPosition().top).not.toBe(second.editor.getScrollPosition().top)
    expect(bView.editor.getSelections()).toEqual(bSelection)
    const delayed = delayRetentionInspectors()
    try {
      await record({
        ...(await host.sample('actual-two-editor-views', 0, [b])),
        delayedInspectors: delayed.requests(),
      })
      expect(delayed.requests()).toBe(2)
    } finally {
      delayed.restore()
    }
    if (typeof commands.retentionScreenshot === 'function')
      await commands.retentionScreenshot(`${fixture}-two-views`)
    first.dispose()
    second.dispose()
    await host.settle()
    const interval = await host.observation.interval(() => host.createView('a-warm'), host.settle)
    const warm = interval.value
    try {
      const reused = host.a.analysis
        .inspectRetention()
        .entries.filter((entry) => entry.leaseCount > 0)
        .map((entry) => entry.runtimeSessionId)
        .sort()
      await record({
        fixture,
        arm: 'actual-editor-synchronous-warm-attachment',
        cycle: 0,
        previousRuntimeIds: ids,
        runtimeIds: reused,
        requests: interval.requests,
        sourceReads: interval.reads,
        attachments: interval.attachments,
        synchronousAttachment: warm.attachment,
        completion: interval.observation,
      })
      assertReadyAttachment(warm.attachment)
      expect(reused).toEqual(ids)
      expect(interval.attachments).toEqual([{ prepared: true }])
      assertWarmInterval(interval)
      expect(bView.editor.getSelections()).toEqual(bSelection)
    } finally {
      warm.dispose()
    }
  } finally {
    first.dispose()
    second.dispose()
  }
}

function assertReadyAttachment(attachment: ReturnType<Host['createView']>['attachment']) {
  expect(attachment.state.syntaxStatus).toBe('ready')
  expect(attachment.state.initialHighlightStatus).toBe('painted')
  expect(attachment.readyPaintCaptured).toBe(true)
  expect(attachment.sourceMatchesColdSnapshot).toBe(true)
  expect(attachment.paints.map((paint) => paint.phase)).toEqual(['text', 'highlight-settled'])
  expect(attachment.paints.at(-1)).toMatchObject({ status: 'painted' })
  const acquisition = attachment.acquisition
  expect(acquisition).not.toBeNull()
  if (!acquisition) throw new TypeError('Actual public prepared acquisition is required')
  expect(acquisition.source.matchesColdSnapshot).toBe(true)
  expect(acquisition.match).toMatchObject({
    configuredTabSize: 4,
    tabSizePolicy: 'detect-indentation',
    documentConfigurationTag: ['actual-view'],
    structuralConfigurationTag: ['actual-view'],
    highlighterConfigurationTag: ['actual-view'],
    structuralConfiguration: {
      includeCaptures: false,
      includeHighlights: false,
      syntaxMode: 'range',
    },
    matchesStructuralProvider: true,
    matchesHighlighterProvider: true,
    matchesColdThemeCohort: true,
  })
  for (const transfer of [acquisition.structural, acquisition.highlighter]) {
    expect(transfer).toMatchObject({
      ready: true,
      sourceMatchesColdSnapshot: true,
      resultMatchesRead: true,
      configurationTag: ['actual-view'],
    })
  }
  expect([acquisition.structural?.runtimeSessionId]).toEqual(
    attachment.originalStageRuntimeIds?.structural,
  )
  expect([acquisition.highlighter?.runtimeSessionId]).toEqual(
    attachment.originalStageRuntimeIds?.highlighter,
  )
  expect(acquisition.match.themeCohort).toHaveLength(1)
  expect(acquisition.match.themeCohort[0]?.loader).toBeNull()
  expect(acquisition.highlighter?.providerTheme).toEqual({ kind: 'ready', theme: null })
}

function assertWarmInterval(interval: Awaited<ReturnType<Host['observation']['interval']>>) {
  const mandatory = interval.requests.filter(
    (request) => request.provenance !== 'verifier-inspector',
  )
  expect(mandatory).toEqual([])
  expect(
    interval.reads
      .filter((read) => read.provenance !== 'verifier-source-read')
      .reduce((total, read) => total + read.fullTextReads, 0),
  ).toBe(0)
}

async function verifyPendingFailed(host: Host, b: Pair, cycle: number) {
  const pending = host.borrow(host.a.analysis, 'pending-control')
  const pendingSample = host.census()
  await record({
    fixture: host.fixtureId,
    documentId: host.a.analysis.documentId,
    arm: 'pending-before-worker-fence',
    cycle,
    ...pendingSample,
    phase: 'unfenced-diagnostic',
  })
  expect(
    pendingSample.inspections
      .flatMap((inspection) => inspection.entries)
      .filter((entry) => entry.runtimeSessionId === pending.highlighter.runtimeSessionId)
      .map((entry) => entry.status),
  ).toEqual(['pending'])
  host.release(pending)
  const inactive = await host.sample('pending-work-settled-after-release', cycle, [b])
  await record(inactive)
  expect(inactive.bound.passes).toBe(true)
  const failed = host.a.analysis.borrowHighlighter({
    provider: host.failedHighlighterProvider,
    languageId: 'retention-unregistered-language',
    configurationTag: ['failed-control'],
  })
  if (!failed) throw new TypeError('Failure control session unavailable')
  try {
    await expect(failed.refresh(host.a.buffer.getTextSnapshot())).rejects.toBeDefined()
    expect(failed.read().kind).toBe('failed')
    await record(await host.sample('failed-real-worker-active-entry', cycle, [b]))
  } finally {
    failed.dispose()
  }
  const released = await host.sample('failed-real-worker-inactive-entry', cycle, [b])
  await record(released)
  expect(released.bound.passes).toBe(true)
}
