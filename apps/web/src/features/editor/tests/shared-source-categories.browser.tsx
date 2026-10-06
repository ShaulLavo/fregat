import { act, waitFor } from '@testing-library/react'
import { pieceTableSnapshotsHaveSameText } from '@singapore-editor/textbuffer'
import '@singapore-editor/core/style.css'
import {
  attachmentUploadTicketSchema,
  chatAttachmentSchema,
  DEFAULT_SETTING_VALUES,
} from '@workspace/contracts'
import { expect, inject, test } from 'vitest'
import { commands } from 'vitest/browser'
import * as v from 'valibot'
import { ChatFilePreview } from '@/features/chat/components/chat-file-preview'
import { attachmentTextOptions } from '@/features/chat/utils/attachment-file'
import { getClient, serverEndpoint } from '@/lib/client'
import {
  attachmentPreviewMutationOptions,
  type AttachmentTextCapture,
  type PreviewSourceLease,
} from '@/lib/file-preview/utils/source'
import { runMutation } from '@/lib/mutations/run'
import { renderWithProviders } from '../../../../test/render'
import { retentionCountHost } from '../../../../test/factories/retention-count-policy'
import {
  parseRetentionFixtures,
  RETENTION_COUNT_PROTOCOL,
  type RetentionFixture,
} from '../../../../test/factories/retention-count-policy-protocol'

type Host = Awaited<ReturnType<typeof retentionCountHost>>
type Pair = ReturnType<Host['borrow']>
type Sample = Awaited<ReturnType<Host['sample']>>
type Point = 'baseline' | 'active' | 'released'
type Run = {
  readonly actualGo: boolean
  readonly finalHeadQualified: boolean
  readonly originalBudgetsVerified: boolean
  readonly sourceHead: string
  readonly caseBudgetMs: number
  readonly responseBudgetMs: number
  readonly cycles: 2
  readonly fixture: RetentionFixture
}
type SourceFacts = {
  readonly interests: number
  readonly rendered: boolean
  readonly viewEnded: boolean
  readonly peerAliveAfterViewClose: boolean
  readonly ownerDisposed: boolean
  readonly captureReaderMatches: boolean | null
  readonly captureBytes: number | null
  readonly captureQueryUpdatedAt: number | null
  readonly sourceEnvironment: string
  readonly sourceOrigin: string
}
type PointInput =
  | {
      readonly kind: 'sample'
      readonly point: Point
      readonly cycle: number
      readonly sourceHead: string
      readonly responseBudgetMs: number
      readonly categories: Pick<
        Sample,
        | 'point'
        | 'workerGenerations'
        | 'inspections'
        | 'treeWorker'
        | 'shikiWorker'
        | 'queriedTokenBacking'
        | 'treeOwner'
        | 'shikiOwner'
        | 'bound'
        | 'a'
        | 'b'
      >
      readonly source: SourceFacts
      readonly heldRuntimeIds: readonly string[]
      readonly nativeBufferMatches: boolean
      readonly differentSurvivorOwner: boolean
    }
  | {
      readonly kind: 'archive'
      readonly sourceHead: string
      readonly phase: 'before-cleanup' | 'after-cleanup'
      readonly failure: string | null
      readonly secondary: readonly { stage: string; error: string }[]
      readonly reached: readonly { point: Point; cycle: number }[]
      readonly conditionalPoints: { inactive: 'not-exercised'; reclaimed: 'not-exercised' }
    }
type PointReceipt = {
  readonly kind: 'observation' | 'archive'
  readonly outcome: 'observed' | 'archived' | 'incomplete'
  readonly sourceHead: string
}

declare module 'vitest' {
  interface ProvidedContext {
    sharedSourceCategoryRun: Run | undefined
  }
}
declare module 'vitest/browser' {
  interface BrowserCommands {
    categoryPoint(input: PointInput): Promise<PointReceipt>
  }
}

test('shared source categories require RuntimeGO and an existing public categoryPoint transport', async (context) => {
  if (typeof commands.categoryPoint !== 'function')
    return context.skip(
      'The shared categoryPoint command and its public Chromium transport are absent.',
    )
  const run = inject('sharedSourceCategoryRun')
  if (!run?.actualGo || !run.finalHeadQualified)
    return context.skip(
      'Delivery RuntimeGO and an accepted final source are required for shared byte categories.',
    )
  expect(run.sourceHead).toMatch(/^[a-f0-9]{40}$/u)
  expect(run.originalBudgetsVerified).toBe(true)
  expect(run.caseBudgetMs).toBe(600_000)
  expect(Number.isSafeInteger(run.responseBudgetMs) && run.responseBudgetMs > 0).toBe(true)
  expect(run.cycles).toBe(2)
  const [fixture] = parseRetentionFixtures([run.fixture])
  if (!fixture) return expect.fail('The selected existing fixture is required')
  expect(RETENTION_COUNT_PROTOCOL.workingDocumentCount).toBe(7)
  expect(DEFAULT_SETTING_VALUES['editor.inactiveAnalysisEntryLimit']).toBe(2)
  await sharedCategories(run, fixture, context.signal)
}, 600_000)

async function sharedCategories(run: Run, fixture: RetentionFixture, signal: AbortSignal) {
  let host: Host | null = null
  let pair: Pair | null = null
  let native: ReturnType<Host['createView']> | null = null
  let view: ReturnType<typeof renderWithProviders> | null = null
  let peer: PreviewSourceLease | null = null
  let upload: { client: ReturnType<typeof getClient>; id: string } | null = null
  let primary: { error: unknown } | null = null
  const secondary: { stage: string; error: string }[] = []
  const reached: { point: Point; cycle: number }[] = []
  let abortCleanup: Promise<void> | null = null
  const abort = () => {
    abortCleanup ??= attempt(secondary, 'abort-host-dispose', () => host?.dispose())
  }
  signal.addEventListener('abort', abort, { once: true })
  try {
    signal.throwIfAborted()
    host = await retentionCountHost(fixture)
    signal.throwIfAborted()
    expect([host.a, host.b, ...host.working, ...host.secondaryWorking]).toHaveLength(7)
    expect(host.expectedSource.length).toBeGreaterThanOrEqual(4096)
    const initial = host.application.getSnapshot()
    const survivor = host.b
    const originalB = survivor.buffer.getSnapshot()
    host.bSession.setSelection(0)
    host.bSession.breakTypingRun()
    host.bSession.applyText('survivor ')
    const dirtyB = host.b.buffer.getSnapshot()
    // The workload holds this pair; category observation only receives existing references.
    pair = host.borrow(host.b.analysis)
    await host.refresh(pair, host.b.analysis)
    await host.prepareViewMetadata()
    native = host.createView('b', host.b)
    expect(native.editor.getBufferSession()?.buffer).toBe(host.b.buffer)
    expect(native.attachment.state.syntaxStatus).toBe('ready')
    expect(native.attachment.state.initialHighlightStatus).toBe('painted')
    expect(native.attachment.readyPaintCaptured).toBe(true)
    host.releaseViewMetadata()
    expect(host.application.getSnapshot().editor).not.toBe(host.survivorEditor)
    expect(host.b.buffer.isDirty()).toBe(true)
    expect(host.b.buffer.canUndo()).toBe(true)
    const heldIds = [pair.structural.runtimeSessionId, pair.highlighter.runtimeSessionId]
    const observe = async (point: Point, cycle: number, source: SourceFacts) => {
      signal.throwIfAborted()
      if (!host || !pair || !native)
        return expect.fail('Setup-owned survivor references are required')
      const heldRead = pair.highlighter.read()
      expect(heldRead.kind).toBe('ready')
      const sample = await host.sample(`shared-source-${point}`, cycle, [pair])
      expect(sample.point.consistent).toBe(true)
      expect(sample.workerGenerations.afterFrameAndWorkerFences).toEqual(
        sample.workerGenerations.beforeInspectors,
      )
      expect(sample.queriedTokenBacking.storeCount).toBeGreaterThan(0)
      expect(sample.queriedTokenBacking.backingBytes).toBeGreaterThan(0)
      expect(sample.bound.passes).toBe(true)
      expect(host.b.buffer.isDirty()).toBe(true)
      expect(native.editor.getBufferSession()?.buffer).toBe(host.b.buffer)
      expect([pair.structural.runtimeSessionId, pair.highlighter.runtimeSessionId]).toEqual(heldIds)
      const {
        point: fence,
        workerGenerations,
        inspections,
        treeWorker,
        shikiWorker,
        queriedTokenBacking,
        treeOwner,
        shikiOwner,
        bound,
        a,
        b,
      } = sample
      const receipt = await commands.categoryPoint({
        kind: 'sample',
        point,
        cycle,
        sourceHead: run.sourceHead,
        responseBudgetMs: run.responseBudgetMs,
        categories: {
          point: fence,
          workerGenerations,
          inspections,
          treeWorker,
          shikiWorker,
          queriedTokenBacking,
          treeOwner,
          shikiOwner,
          bound,
          a,
          b,
        },
        source,
        heldRuntimeIds: heldIds,
        nativeBufferMatches: native.editor.getBufferSession()?.buffer === host.b.buffer,
        differentSurvivorOwner: initial.editor !== host.survivorEditor,
      })
      signal.throwIfAborted()
      expect(receipt.kind).toBe('observation')
      expect(receipt.outcome).toBe('observed')
      expect(receipt.sourceHead).toBe(run.sourceHead)
      await host.settle()
      expect([host.tree.inspect().workerGeneration, host.shiki.inspect().workerGeneration]).toEqual(
        sample.workerGenerations.afterFrameAndWorkerFences,
      )
      reached.push({ point, cycle })
    }
    const facts = (
      capture: AttachmentTextCapture | null,
      extra: Pick<SourceFacts, 'viewEnded' | 'peerAliveAfterViewClose' | 'ownerDisposed'>,
    ): SourceFacts => ({
      interests: initial.editor.documentStore.getState().previewSources.size,
      rendered: document.querySelector('[data-chat-file-preview]') !== null,
      captureReaderMatches:
        capture !== null && initial.editor.documentStore.getState().previewSources.size > 0
          ? Array.from(initial.editor.documentStore.getState().previewSources.values()).every(
              (read) =>
                read.kind === 'attachment' &&
                read.input === capture &&
                read.input.reader === capture.reader,
            )
          : null,
      captureBytes: capture?.bytes.byteLength ?? null,
      captureQueryUpdatedAt: capture
        ? (initial.queryClient.getQueryState(attachmentTextOptions(capture).queryKey)
            ?.dataUpdatedAt ?? null)
        : null,
      sourceEnvironment: initial.editor.previewSource.environmentId,
      sourceOrigin: initial.editor.previewSource.origin,
      ...extra,
    })
    await observe(
      'baseline',
      0,
      facts(null, { viewEnded: false, peerAliveAfterViewClose: false, ownerDisposed: false }),
    )
    const content = 'Shared attachment\n' + host.expectedSource.slice(0, 4096)
    const bytes = new TextEncoder().encode(content)
    const client = getClient()
    const issued = await client.attachments.uploads.post({
      type: 'file',
      name: 'shared-source.txt',
      mimeType: 'text/plain',
      sizeBytes: bytes.byteLength,
    })
    const ticket = v.parse(attachmentUploadTicketSchema, issued.data)
    upload = { client, id: ticket.attachment.id }
    const origin = serverEndpoint(initial.origin)
    const stored = await fetch(new URL(ticket.uploadPath, origin), {
      method: 'PUT',
      credentials: 'include',
      body: bytes,
    })
    expect(stored.status).toBe(200)
    const attachment = v.parse(chatAttachmentSchema, await stored.json())
    if (attachment.type !== 'file') return expect.fail('An actual staged file upload is required')
    const input = {
      attachment,
      environmentId: initial.editor.previewSource.environmentId,
      origin,
      provenance: 'staged' as const,
    }
    const options = attachmentTextOptions(input)
    let previousCapture: AttachmentTextCapture | null = null
    for (const cycle of [1, 2]) {
      signal.throwIfAborted()
      view = renderWithProviders(
        <ChatFilePreview input={input} queryClient={initial.queryClient} onClose={() => {}} />,
        { application: host.application, queryClient: initial.queryClient, command: false },
      )
      await waitFor(() =>
        expect(document.querySelector('[data-chat-file-preview]')?.textContent).toBe(content),
      )
      await waitFor(() =>
        expect(initial.editor.documentStore.getState().previewSources.size).toBe(1),
      )
      const capture = initial.queryClient.getQueryData(options.queryKey)
      if (capture?.kind !== 'attachment')
        return expect.fail('The existing producer must supply an actual immutable capture')
      expect(capture).not.toBe(previousCapture)
      expect(Object.isFrozen(capture)).toBe(true)
      expect(capture.bytes).toEqual(bytes)
      const [viewLease] = initial.editor.documentStore.getState().previewSources.keys()
      if (!viewLease) return expect.fail('The rendered caller must own a real source interest')
      const binding = await runMutation(
        initial.queryClient,
        attachmentPreviewMutationOptions(initial.editor.previewSource, initial.queryClient),
        { input: capture, expected: capture, signal },
      )
      if (!binding.lease || binding.read.kind !== 'attachment')
        return expect.fail('A real peer capture interest is required')
      peer = binding.lease
      expect(binding.read.input).toBe(capture)
      expect(binding.read.input.reader).toBe(capture.reader)
      expect(initial.editor.documentStore.getState().previewSources.size).toBe(2)
      await observe(
        'active',
        cycle,
        facts(capture, { viewEnded: false, peerAliveAfterViewClose: false, ownerDisposed: false }),
      )
      act(() => view?.unmount())
      view = null
      expect(viewLease.read().kind).toBe('released')
      expect(peer.read()).toBe(binding.read)
      expect(initial.editor.documentStore.getState().previewSources.size).toBe(1)
      const releaseOwner = cycle === 1 ? () => peer?.release() : () => initial.editor.dispose()
      act(releaseOwner)
      expect(peer.read().kind).toBe('released')
      expect(initial.editor.documentStore.getState().previewSources.size).toBe(0)
      peer = null
      await observe(
        'released',
        cycle,
        facts(capture, {
          viewEnded: true,
          peerAliveAfterViewClose: true,
          ownerDisposed: cycle === 2,
        }),
      )
      previousCapture = capture
    }
    host.bSession.undo()
    expect(
      host.observation.verifierRead(() =>
        pieceTableSnapshotsHaveSameText(survivor.buffer.getSnapshot(), originalB),
      ),
    ).toBe(true)
    host.bSession.redo()
    expect(
      host.observation.verifierRead(() =>
        pieceTableSnapshotsHaveSameText(survivor.buffer.getSnapshot(), dirtyB),
      ),
    ).toBe(true)
    await host.refresh(pair, host.b.analysis)
    expect(host.b.buffer.isDirty()).toBe(true)
    expect(native.editor.getBufferSession()?.buffer).toBe(host.b.buffer)
    expect([pair.structural.runtimeSessionId, pair.highlighter.runtimeSessionId]).toEqual(heldIds)
  } catch (error) {
    primary = { error }
    await attempt(secondary, 'before-cleanup-receipt', () =>
      commands.categoryPoint({
        kind: 'archive',
        sourceHead: run.sourceHead,
        phase: 'before-cleanup',
        failure: String(error),
        secondary,
        reached,
        conditionalPoints: { inactive: 'not-exercised', reclaimed: 'not-exercised' },
      }),
    )
  } finally {
    signal.removeEventListener('abort', abort)
    await attempt(secondary, 'preview-unmount', () => view?.unmount())
    await attempt(secondary, 'peer-release', () => peer?.release())
    await attempt(secondary, 'upload-delete', () =>
      upload ? upload.client.attachments.uploads({ id: upload.id }).delete() : undefined,
    )
    await attempt(secondary, 'native-view-dispose', () => native?.dispose())
    await attempt(secondary, 'held-pair-release', () =>
      host && pair ? host.release(pair) : undefined,
    )
    await abortCleanup
    await attempt(secondary, 'host-dispose', () => host?.dispose())
    await attempt(secondary, 'tree-worker-dispose', () => host?.tree.dispose())
    await attempt(secondary, 'shiki-worker-dispose', () => host?.shiki.dispose())
    await attempt(secondary, 'after-cleanup-receipt', () =>
      commands.categoryPoint({
        kind: 'archive',
        sourceHead: run.sourceHead,
        phase: 'after-cleanup',
        failure: primary ? String(primary.error) : null,
        secondary,
        reached,
        conditionalPoints: { inactive: 'not-exercised', reclaimed: 'not-exercised' },
      }),
    )
  }
  if (primary) throw primary.error
  if (secondary.length) expect.fail(JSON.stringify({ cleanupFailures: secondary }))
}

async function attempt(
  failures: { stage: string; error: string }[],
  stage: string,
  action: () => unknown | Promise<unknown>,
) {
  try {
    await action()
  } catch (error) {
    failures.push({ stage, error: String(error) })
  }
}
