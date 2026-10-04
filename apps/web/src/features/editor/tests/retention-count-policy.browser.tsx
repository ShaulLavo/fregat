import { expect, test, vi } from 'vitest'
import { commands } from 'vitest/browser'
import '@singapore-editor/core/style.css'
import { pieceTableSnapshotsHaveSameText } from '@singapore-editor/textbuffer'
import { DEFAULT_SETTING_VALUES } from '@workspace/contracts'
import { retentionCountHost } from '../../../../test/factories/retention-count-policy'
import {
  RETENTION_COUNT_PROTOCOL,
  type RetentionRun,
} from '../../../../test/factories/retention-count-policy-protocol'

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
}

async function configuration() {
  if (typeof commands.retentionManifest === 'function') return commands.retentionManifest()
  return {
    sourceHead: 'vitest-discovery-pilot',
    protocol: RETENTION_COUNT_PROTOCOL,
    cycles: 2,
    fixtures: [
      { id: 'tree-ts-pilot', provider: 'tree-sitter', language: 'typescript', sourceUnits: 4096 },
    ],
  } satisfies RetentionRun
}

test('actual host global count, warm reuse, pressure, growth control and retained survivor', async () => {
  const run = await configuration()
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
  const failures: { fixture: string; message: string }[] = []
  for (const fixture of run.fixtures) {
    try {
      await verifyFixture(fixture, run.cycles)
    } catch (error) {
      const failure = {
        fixture: fixture.id,
        message: String(error),
        stack: error instanceof Error ? error.stack : null,
      }
      failures.push(failure)
      await record({ kind: 'failure', ...failure })
    }
  }
  await record({ kind: 'result', fixtures: run.fixtures.length, cycles: run.cycles, failures })
  expect(failures).toEqual([])
}, 600_000)

async function verifyFixture(fixture: RetentionRun['fixtures'][number], cycles: number) {
  const host = await retentionCountHost(fixture)
  const b = host.borrow(host.b.analysis)
  let bView: ReturnType<Host['createView']> | null = null
  try {
    await verifyIdleInspectors(host, b, fixture.id)
    bView = host.createView('b', host.b)
    await verifyProviderBaseline(host, fixture)
    await host.refresh(b, host.b.analysis)
    const bIds = [b.structural.runtimeSessionId, b.highlighter.runtimeSessionId]
    await record(await host.sample('baseline-active-b', 0, [b]))
    await verifyActualViews(host, b, bView, fixture.id)
    const bEntries = activeRuntimeIds(host.b.analysis)
    for (let cycle = 1; cycle <= cycles; cycle++) {
      await verifyCycle(host, b, bIds, cycle)
      expect(activeRuntimeIds(host.b.analysis)).toEqual(bEntries)
    }
    await verifyRangeHistory(host, b, cycles)
    await verifyPendingFailed(host, b, cycles)
    await verifyGrowthControl(host, b, cycles)
    host.application.getSnapshot().editor.dispose()
    await host.settle()
    expect(
      host.a.analysis.borrowStructural({
        provider: { createSession: () => null },
        languageId: fixture.language,
      }),
    ).toBeNull()
    host.bSession.applyText('survivor ')
    await host.refresh(b, host.b.analysis)
    expect([b.structural.runtimeSessionId, b.highlighter.runtimeSessionId]).toEqual(bIds)
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
  const snapshot = host.a.buffer.getTextSnapshot()
  const fullText = vi.spyOn(snapshot, 'materializeFullText')
  const beforePending = [host.tree.inspect().pendingRequests, host.shiki.inspect().pendingRequests]
  const reborrowed = host.borrow(host.a.analysis)
  const warmObservation = {
    fixture: warm.fixture,
    cycle,
    arm: 'synchronous-warm-attachment',
    runtimeIds: [reborrowed.structural.runtimeSessionId, reborrowed.highlighter.runtimeSessionId],
    reads: [reborrowed.structural.read().kind, reborrowed.highlighter.read().kind],
    fullTextReads: fullText.mock.calls.length,
    pendingWorkerRequestsBefore: beforePending,
    pendingWorkerRequestsAfter: [
      host.tree.inspect().pendingRequests,
      host.shiki.inspect().pendingRequests,
    ],
    synchronousReadyRead: true,
  }
  fullText.mockRestore()
  await record(warmObservation)
  expect(warmObservation.runtimeIds).toEqual(ids)
  expect(warmObservation.reads).toEqual(['ready', 'ready'])
  expect(warmObservation.fullTextReads).toBe(0)
  expect(warmObservation.pendingWorkerRequestsAfter).toEqual(beforePending)
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
  expect(pieceTableSnapshotsHaveSameText(host.a.buffer.getSnapshot(), host.dirtySnapshot)).toBe(
    true,
  )
  host.aSession.undo()
  expect(host.a.buffer.isDirty()).toBe(false)
  expect(pieceTableSnapshotsHaveSameText(host.a.buffer.getSnapshot(), host.savedSnapshot)).toBe(
    true,
  )
  host.aSession.redo()
  expect(pieceTableSnapshotsHaveSameText(host.a.buffer.getSnapshot(), host.dirtySnapshot)).toBe(
    true,
  )
  host.dirtyRevision = host.a.buffer.getRevision()
  host.bSession.setSelection(0)
  host.bSession.applyText('b ')
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
  await record({
    kind: RETENTION_COUNT_PROTOCOL.successfulCycleMarker,
    fixture: end.fixture,
    cycle,
  })
}

function activeRuntimeIds(analysis: Host['a']['analysis']) {
  return analysis
    .inspectRetention()
    .entries.filter((entry) => entry.leaseCount > 0)
    .map((entry) => entry.runtimeSessionId)
    .sort()
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
  await record({
    fixture,
    arm: 'idle-inspector-calibration',
    cycle: 0,
    before,
    after,
    treeWorker,
    shikiWorker,
  })
  expect(before.tree.pendingRequests).toBe(0)
  expect(before.shiki.pendingRequests).toBe(0)
  expect(after.tree.pendingRequests).toBe(0)
  expect(after.shiki.pendingRequests).toBe(0)
  expect(after.tree.workerGeneration).toBe(before.tree.workerGeneration)
  expect(after.shiki.workerGeneration).toBe(before.shiki.workerGeneration)
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
    await record(await host.sample('actual-two-editor-views', 0, [b]))
    if (typeof commands.retentionScreenshot === 'function')
      await commands.retentionScreenshot(`${fixture}-two-views`)
    first.dispose()
    second.dispose()
    await host.settle()
    const snapshot = host.a.buffer.getTextSnapshot()
    const materialize = vi.spyOn(snapshot, 'materializeFullText')
    const warm = host.createView('a-warm')
    try {
      const reused = host.a.analysis
        .inspectRetention()
        .entries.filter((entry) => entry.leaseCount > 0)
        .map((entry) => entry.runtimeSessionId)
        .sort()
      const reads = materialize.mock.calls.length
      materialize.mockRestore()
      await record({
        fixture,
        arm: 'actual-editor-synchronous-warm-attachment',
        cycle: 0,
        previousRuntimeIds: ids,
        runtimeIds: reused,
        fullTextReads: reads,
        attachmentReturnedSynchronously: true,
      })
      expect(reused).toEqual(ids)
      expect(reads).toBe(0)
      expect(bView.editor.getSelections()).toEqual(bSelection)
    } finally {
      materialize.mockRestore()
      warm.dispose()
    }
  } finally {
    first.dispose()
    second.dispose()
  }
}

async function verifyPendingFailed(host: Host, b: Pair, cycle: number) {
  const pending = host.borrow(host.a.analysis, 'pending-control')
  const pendingSample = host.census()
  await record({
    fixture: host.a.analysis.documentId,
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
