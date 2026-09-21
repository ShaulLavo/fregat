import { filesystemPath } from '@/lib/documents/utils/identity'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createObservedInProcessClient } from '../../../../test/client'
import { createWorkspaceTextChanges } from '../../../../test/factories/workspace-text-changes'
import { fetchFile } from '@/lib/file-server'
import { testDocumentKey } from '../../../../test/factories/document-targets'
import type {
  ParsedWorkspaceEdit,
  WorkspaceEditOperation,
  WorkspaceTextDocumentProvenance,
} from '@singapore-editor/lsp-plugin/workspace-edit'
import type { LanguageServerDocumentSyncController } from '@singapore-editor/lsp-plugin/document-sync-controller'
import type { ApplyWorkspaceEditRequest } from '@singapore-editor/lsp-plugin'
import {
  createDocumentLogicalRevisionScope,
  createEditorBufferSession,
} from '@singapore-editor/core/document'
import { QueryClient } from '@tanstack/react-query'
import type {
  WorkspaceEditPrepareRequest,
  WorkspaceEditRecoverRequest,
  WorkspaceEditRecoveryListResult,
  WorkspaceEditReleaseRequest,
  WorkspaceEditResult,
  WorkspaceEditStatusResult,
  WorkspaceEditTransitionRequest,
} from '@workspace/contracts'

import { createEditorDocumentStore } from '@/features/editor/state/document-state'
import { EditorSaveService } from '@/features/editor/state/save-service'
import { SettingsSyncService } from '@/features/settings/state/sync-service'
import { createTestQueryClient } from '../../../../test/render'
import {
  FileSyncService,
  type WorkspaceMutationTransition,
  type WorkspaceMutationTransport,
} from '@/features/editor/state/file-sync-service'
import {
  WorkspaceEditService,
  type WorkspaceEditOperationEventPort,
  type WorkspaceEditPathInspection,
  type WorkspaceEditRoot,
  type WorkspaceEditServicePhase,
} from '@/features/editor/state/workspace-edit-service'
import { createClientInvariantError } from '@/lib/structured-errors'
import { filesystemResource } from '@/lib/documents/utils/capabilities'
import { fileSystemKeys } from '@/lib/query-keys'
import type { TreeModel } from '@/lib/tree-model'
import type { DocumentRef } from '@/lib/documents/utils/types'
import type { FileResult, TreeEntry } from '@/lib/file-system-types'
import { expect, test } from '../../../../test/fixtures'

const ROOT = filesystemPath('/repo')
const SERVER_EPOCH = '20000000-0000-4000-8000-000000000063'
const OPERATION_ID = '10000000-0000-4000-8000-000000000063'

type Harness = ReturnType<typeof createHarness>

type HarnessOptions = {
  readonly abortPrepare?: boolean
  readonly beforeRead?: () => Promise<void>
  readonly failFinalize?: boolean
  readonly failReleaseAttempts?: number
  readonly partialUndo?: boolean
  readonly partialRollback?: boolean
  readonly root?: WorkspaceEditRoot
}

type RejectionCase = {
  readonly expectedCode: string
  readonly name: string
  readonly operations: (harness: Harness) => readonly WorkspaceEditOperation[]
  readonly setup?: (harness: Harness) => void
}

test.describe('WorkspaceEditService', () => {
  test.for([
    {
      name: 'rename source',
      path: 'source.ts',
      operation: renameOperation('file:///source.ts', 'file:///renamed.ts'),
    },
    {
      name: 'rename destination',
      path: 'destination.ts',
      operation: {
        ...renameOperation('file:///source.ts', 'file:///destination.ts'),
        ignoreIfExists: true,
      },
    },
    {
      name: 'create target',
      path: 'destination.ts',
      operation: {
        kind: 'create',
        uri: 'file:///destination.ts',
        overwrite: false,
        ignoreIfExists: true,
      } satisfies WorkspaceEditOperation,
    },
    {
      name: 'delete target',
      path: 'source.ts',
      operation: deleteOperation('file:///source.ts'),
    },
  ])('rejects known $name drift before the host captures its stamp', async (entry, { server }) => {
    await Promise.all([
      writeFile(join(server.root, 'origin.ts'), 'origin'),
      writeFile(join(server.root, 'source.ts'), 'source'),
      writeFile(join(server.root, 'destination.ts'), 'destination'),
    ])
    const started = Promise.withResolvers<void>()
    const gate = Promise.withResolvers<void>()
    const client = createObservedInProcessClient(server, async (request) => {
      if (new URL(request.url).pathname !== '/fs/stat') return
      started.resolve()
      await gate.promise
    })
    const { service, store } = createWorkspaceTextChanges(client)
    const signal = new AbortController().signal
    const originFile = await fetchFile(filesystemPath('origin.ts'), signal, client)
    const targetFile = await fetchFile(filesystemPath(entry.path), signal, client)
    const origin = store.getState().ensureLiveEditorDocument(originFile)
    const target = store.getState().ensureLiveEditorDocument(targetFile)
    const targetRevision = target.buffer.getRevision()
    const originUri = 'file:///origin.ts'
    const targetUri = `file:///${entry.path}`
    const application = request([entry.operation], {
      originUri,
      documents: [
        currentProvenance(origin.buffer.getTextSnapshot(), originUri, 1),
        currentProvenance(target.buffer.getTextSnapshot(), targetUri, 1),
      ],
    })
    const unsubscribe = service.subscribe(() => {
      const snapshot = service.getSnapshot()
      if (snapshot.phase !== 'awaiting-confirmation' || !snapshot.preview) return
      service.confirmPreview(snapshot.preview.operationId)
    })
    const pending = service.onApplyWorkspaceEdit({
      ...application,
      guard: {
        documents: application.guard.documents,
        isCurrent: (uri) => uri === originUri || target.buffer.getRevision() === targetRevision,
      },
    })
    await started.promise
    createEditorBufferSession(target.buffer).applyText(' newer')
    if (entry.name !== 'rename source') target.buffer.undo()
    gate.resolve()
    const result = await pending
    unsubscribe()

    expect(result).toMatchObject({ status: 'failed', code: 'version-mismatch' })
    expect(service.getSnapshot().preview).toBeNull()
    expect(await readFile(join(server.root, 'source.ts'), 'utf8')).toBe('source')
    expect(await readFile(join(server.root, 'destination.ts'), 'utf8')).toBe('destination')
    expect(target.buffer.materializeFullText()).toBe(
      entry.name === 'rename source' ? 'source newer' : targetFile.content,
    )
  })

  test('rejects origin drift at the final local-only commit boundary', async () => {
    const harness = createHarness()
    const origin = addLiveDocument(harness, '/repo/origin.ts', 'origin')
    const target = addLiveDocument(harness, '/repo/target.ts', 'target')
    const originUri = fileUri(origin.target)
    const targetUri = fileUri(target.target)
    const originSnapshot = origin.buffer.getTextSnapshot()
    const targetSnapshot = target.buffer.getTextSnapshot()
    const original = request([textOperation(targetUri, 7, 0, 1, 'T')], {
      originUri,
      documents: [
        currentProvenance(originSnapshot, originUri, 7),
        currentProvenance(targetSnapshot, targetUri, 7),
      ],
    })
    const pending = harness.service.onApplyWorkspaceEdit({
      ...original,
      guard: {
        documents: original.guard.documents,
        isCurrent: (uri) =>
          uri === originUri
            ? origin.buffer.getTextSnapshot() === originSnapshot
            : target.buffer.getTextSnapshot() === targetSnapshot,
      },
    })
    await waitForPhase(harness.service, 'awaiting-confirmation')
    const unsubscribe = harness.service.subscribe(() => {
      if (harness.service.getSnapshot().phase !== 'committing') return
      unsubscribe()
      queueMicrotask(() =>
        queueMicrotask(() => createEditorBufferSession(origin.buffer).applyText('!')),
      )
    })
    harness.service.confirmPreview(harness.service.getSnapshot().preview!.operationId)
    expect(await pending).toMatchObject({ status: 'failed', code: 'version-mismatch' })
    unsubscribe()
    expect(origin.buffer.materializeFullText()).toBe('origin!')
    expect(target.buffer.materializeFullText()).toBe('target')
    expect(harness.transport.prepares).toEqual([])
  })

  test('applies one active-buffer edit as one Editor undo transaction without preview', async () => {
    const harness = createHarness()
    const document = addLiveDocument(harness, '/repo/active.ts', 'alpha')
    const uri = fileUri(document.target)
    const provenance = currentProvenance(document.buffer.getTextSnapshot(), uri, 7)
    const phases: WorkspaceEditServicePhase[] = []
    harness.service.subscribe(() => phases.push(harness.service.getSnapshot().phase))

    const result = await harness.service.onApplyWorkspaceEdit(
      request([textOperation(uri, 7, 0, 1, 'A')], {
        documents: [provenance],
        originUri: uri,
      }),
    )

    expect(result).toEqual({ status: 'applied' })
    expect(document.buffer.materializeFullText()).toBe('Alpha')
    expect(document.buffer.canUndo()).toBe(true)
    expect(harness.service.getSnapshot()).toMatchObject({
      canUndo: false,
      phase: 'applied',
      preview: null,
    })
    expect(phases).not.toContain('awaiting-confirmation')
    expect(harness.transport.prepares).toEqual([])
    expect(harness.operationEvents).toMatchObject([
      {
        counts: {
          affectedPathCount: 1,
          dirtyTargetCount: 0,
          openTargetCount: 1,
          operationCount: 1,
          unopenedTargetCount: 0,
        },
        phases: ['committing', 'finalizing'],
        settlements: [{ outcome: 'applied' }],
      },
    ])

    document.buffer.undo()
    expect(document.buffer.materializeFullText()).toBe('alpha')
  })

  test('previews active dirty another open and unopened targets from their correct sources then cancels', async () => {
    const harness = createHarness()
    const active = addLiveDocument(harness, '/repo/active.ts', 'active')
    const secondary = addLiveDocument(harness, '/repo/secondary.ts', 'secondary')
    addDiskFile(harness, '/repo/unopened.ts', 'unopened', 30)
    createEditorBufferSession(active.buffer).applyText('!')
    const activeUri = fileUri(active.target)
    const secondaryUri = fileUri(secondary.target)
    const unopenedUri = fileUri('/repo/unopened.ts')
    const provenance = currentProvenance(active.buffer.getTextSnapshot(), activeUri, 4)

    const pending = harness.service.onApplyWorkspaceEdit(
      request(
        [
          textOperation(activeUri, null, 0, 1, 'A'),
          textOperation(secondaryUri, null, 0, 1, 'S'),
          textOperation(unopenedUri, null, 0, 1, 'U'),
        ],
        { documents: [provenance], originUri: activeUri },
      ),
    )
    await waitForPhase(harness.service, 'awaiting-confirmation')

    expect(harness.service.getSnapshot().preview?.rows).toMatchObject([
      {
        afterText: 'Active!',
        beforeText: 'active!',
        path: '/repo/active.ts',
        targetKind: 'dirty',
      },
      {
        afterText: 'Secondary',
        beforeText: 'secondary',
        path: '/repo/secondary.ts',
        targetKind: 'open',
      },
      {
        afterText: 'Unopened',
        beforeText: 'unopened',
        path: '/repo/unopened.ts',
        targetKind: 'unopened',
      },
    ])
    expect(harness.service.getSnapshot()).toMatchObject({ canCancel: true })

    harness.service.cancelPreview(harness.service.getSnapshot().preview!.operationId)
    await expect(pending).resolves.toEqual({ status: 'cancelled' })
    expect(active.buffer.materializeFullText()).toBe('active!')
    expect(secondary.buffer.materializeFullText()).toBe('secondary')
    expect(
      harness.store.getState().hasLiveEditorDocument(testDocumentKey('/repo/unopened.ts')),
    ).toBe(false)
    expect(harness.transport.prepares).toEqual([])
    expect(harness.operationEvents[0]).toMatchObject({
      phases: ['preview'],
      settlements: [{ outcome: 'cancelled' }],
    })
  })

  test('accepts a null-version dirty target only with an identical current lane snapshot', async () => {
    const harness = createHarness()
    const document = addLiveDocument(harness, '/repo/dirty.ts', 'dirty')
    createEditorBufferSession(document.buffer).applyText('!')
    const uri = fileUri(document.target)
    const provenance = currentProvenance(document.buffer.getTextSnapshot(), uri, 11)

    const result = await harness.service.onApplyWorkspaceEdit(
      request([textOperation(uri, null, 0, 1, 'D')], {
        documents: [provenance],
        originUri: uri,
      }),
    )

    expect(result).toEqual({ status: 'applied' })
    expect(document.buffer.materializeFullText()).toBe('Dirty!')
  })

  test.each([
    { current: true, name: 'absent' },
    { current: false, name: 'stale' },
  ])(
    'rejects a null-version dirty target when owning lane provenance is $name',
    async ({ current }) => {
      const harness = createHarness()
      const document = addLiveDocument(harness, '/repo/dirty.ts', 'dirty')
      createEditorBufferSession(document.buffer).applyText('!')
      const uri = fileUri(document.target)
      const documents = current
        ? []
        : [currentProvenance(document.buffer.getTextSnapshot(), uri, 11)]

      const result = await harness.service.onApplyWorkspaceEdit(
        request([textOperation(uri, null, 0, 1, 'D')], {
          currentUris: current ? [uri] : [],
          documents,
          originUri: uri,
        }),
      )

      expect(result).toMatchObject({ code: 'version-mismatch', status: 'failed' })
      expect(document.buffer.materializeFullText()).toBe('dirty!')
      expect(harness.service.getSnapshot().preview).toBeNull()
      expect(harness.transport.prepares).toEqual([])
    },
  )

  test('persists an unopened target without creating a live document or tab', async () => {
    const harness = createHarness()
    addDiskFile(harness, '/repo/unopened.ts', 'unopened', 80)
    const uri = fileUri('/repo/unopened.ts')
    const pending = harness.service.onApplyWorkspaceEdit(
      request([textOperation(uri, null, 0, 1, 'U')], { originUri: uri }),
    )
    await waitForPhase(harness.service, 'awaiting-confirmation')

    harness.service.confirmPreview(harness.service.getSnapshot().preview!.operationId)
    await expect(pending).resolves.toEqual({ status: 'applied' })

    expect(harness.transport.prepares).toHaveLength(1)
    expect(harness.transport.prepares[0]?.operations).toEqual([
      {
        expected: { kind: 'snapshot', mtimeMs: 80, version: 'test:80:8' },
        index: 0,
        kind: 'write',
        path: 'unopened.ts',
        text: 'Unopened',
      },
    ])
    expect(
      harness.store.getState().hasLiveEditorDocument(testDocumentKey('/repo/unopened.ts')),
    ).toBe(false)
    expect(harness.store.getState().viewsByTabId).toEqual({})
    expect(harness.service.getSnapshot()).toMatchObject({ canUndo: true, phase: 'applied' })
  })

  test('maps the LSP URI namespace to document paths and prepares the server workspace path', async () => {
    const harness = createHarness({
      root: {
        generation: 1,
        path: filesystemPath('client/project'),
        uriPath: filesystemPath('/lsp/project'),
        workspacePath: filesystemPath('project'),
      },
    })
    addDiskFile(harness, 'client/project/unopened.ts', 'unopened', 81)
    const uri = 'file:///lsp/project/unopened.ts'
    const canMutateWorkspace = harness.service.canMutateWorkspace
    expect(canMutateWorkspace()).toBe(true)

    const pending = harness.service.onApplyWorkspaceEdit(
      request([textOperation(uri, null, 0, 1, 'U')], { originUri: uri }),
    )
    await waitForPhase(harness.service, 'awaiting-confirmation')

    expect(canMutateWorkspace()).toBe(false)
    expect(harness.service.getSnapshot().preview?.rows[0]).toMatchObject({
      path: 'client/project/unopened.ts',
      targetKind: 'unopened',
    })
    harness.service.confirmPreview(harness.service.getSnapshot().preview!.operationId)
    await expect(pending).resolves.toEqual({ status: 'applied' })

    expect(canMutateWorkspace()).toBe(true)
    expect(harness.transport.prepares[0]).toMatchObject({
      operations: [{ path: 'unopened.ts' }],
      workspace: 'project',
    })
    expect(
      harness.store.getState().hasLiveEditorDocument(testDocumentKey('client/project/unopened.ts')),
    ).toBe(false)
  })

  test('rejects live drift after preview with zero server mutation', async () => {
    const harness = createHarness()
    const live = addLiveDocument(harness, '/repo/live.ts', 'live')
    addDiskFile(harness, '/repo/unopened.ts', 'unopened', 90)
    const liveUri = fileUri(live.target)
    const unopenedUri = fileUri('/repo/unopened.ts')
    const provenance = currentProvenance(live.buffer.getTextSnapshot(), liveUri, 3)
    const pending = harness.service.onApplyWorkspaceEdit(
      request(
        [textOperation(liveUri, null, 0, 1, 'L'), textOperation(unopenedUri, null, 0, 1, 'U')],
        { documents: [provenance], originUri: liveUri },
      ),
    )
    await waitForPhase(harness.service, 'awaiting-confirmation')

    createEditorBufferSession(live.buffer).applyText('!')
    harness.service.confirmPreview(harness.service.getSnapshot().preview!.operationId)
    const result = await pending

    expect(result).toMatchObject({ code: 'snapshot-drift', status: 'failed' })
    expect(live.buffer.materializeFullText()).toBe('live!')
    expect(harness.transport.prepares).toEqual([])
    expect(
      harness.store.getState().hasLiveEditorDocument(testDocumentKey('/repo/unopened.ts')),
    ).toBe(false)
  })

  test('creates one Platform group for multiple live buffers and undoes and redoes it atomically', async () => {
    const harness = createHarness()
    const first = addLiveDocument(harness, '/repo/first.ts', 'first')
    const second = addLiveDocument(harness, '/repo/second.ts', 'second')
    const firstUri = fileUri(first.target)
    const secondUri = fileUri(second.target)
    const provenance = currentProvenance(first.buffer.getTextSnapshot(), firstUri, 5)
    const pending = harness.service.onApplyWorkspaceEdit(
      request(
        [textOperation(firstUri, null, 0, 1, 'F'), textOperation(secondUri, null, 0, 1, 'S')],
        { documents: [provenance], originUri: firstUri },
      ),
    )
    await waitForPhase(harness.service, 'awaiting-confirmation')

    harness.service.confirmPreview(harness.service.getSnapshot().preview!.operationId)
    await expect(pending).resolves.toEqual({ status: 'applied' })
    expect(first.buffer.materializeFullText()).toBe('First')
    expect(second.buffer.materializeFullText()).toBe('Second')
    expect(first.buffer.canUndo()).toBe(false)
    expect(second.buffer.canUndo()).toBe(false)
    expect(harness.service.hasHistoryBarrier(first.buffer)).toBe(true)
    expect(harness.service.hasHistoryBarrier(second.buffer)).toBe(true)
    expect(harness.service.getSnapshot()).toMatchObject({ canRedo: false, canUndo: true })
    expect(harness.transport.prepares).toEqual([])

    await expect(harness.service.undo()).resolves.toBe(true)
    expect(first.buffer.materializeFullText()).toBe('first')
    expect(second.buffer.materializeFullText()).toBe('second')
    expect(harness.service.hasHistoryBarrier(first.buffer)).toBe(false)
    expect(harness.service.getSnapshot()).toMatchObject({ canRedo: true, canUndo: false })

    await expect(harness.service.redo()).resolves.toBe(true)
    expect(first.buffer.materializeFullText()).toBe('First')
    expect(second.buffer.materializeFullText()).toBe('Second')
    expect(harness.service.getSnapshot()).toMatchObject({ canRedo: false, canUndo: true })
  })

  test('undoes a group after a refetch superseded its query projection', async () => {
    const harness = createHarness()
    const live = addLiveDocument(harness, '/repo/live.ts', 'live')
    addDiskFile(harness, '/repo/unopened.ts', 'unopened', 80)
    const treeKey = fileSystemKeys.tree(ROOT)
    harness.queryClient.setQueryData<TreeModel>(treeKey, emptyTreeModel())
    const liveUri = fileUri(live.target)
    const provenance = currentProvenance(live.buffer.getTextSnapshot(), liveUri, 5)
    const pending = harness.service.onApplyWorkspaceEdit(
      request(
        [
          textOperation(liveUri, null, 0, 1, 'L'),
          textOperation(fileUri('/repo/unopened.ts'), null, 0, 1, 'U'),
        ],
        { documents: [provenance], originUri: liveUri },
      ),
    )
    await waitForPhase(harness.service, 'awaiting-confirmation')
    harness.service.confirmPreview(harness.service.getSnapshot().preview!.operationId)
    await expect(pending).resolves.toEqual({ status: 'applied' })
    expect(harness.transport.prepares).toHaveLength(1)
    expect(live.buffer.materializeFullText()).toBe('Live')

    // The watcher echo of the write: the tree query refetches and replaces the projected data.
    harness.queryClient.setQueryData<TreeModel>(treeKey, emptyTreeModel())
    const unopenedKey = fileSystemKeys.fileSnapshot('/repo/unopened.ts')
    const cachedUnopened = () =>
      harness.queryClient.getQueryData<FileResult>(unopenedKey)?.content ?? null

    // Disk follows the server through every transition; the cache must follow disk each time,
    // not only on the transition that discarded the projection.
    addDiskFile(harness, '/repo/unopened.ts', 'unopened', 81)
    await expect(harness.service.undo()).resolves.toBe(true)
    expect(live.buffer.materializeFullText()).toBe('live')
    expect(cachedUnopened()).toBe('unopened')
    expect(harness.service.getSnapshot()).toMatchObject({ canRedo: true, canUndo: false })

    addDiskFile(harness, '/repo/unopened.ts', 'Unopened', 82)
    await expect(harness.service.redo()).resolves.toBe(true)
    expect(live.buffer.materializeFullText()).toBe('Live')
    expect(cachedUnopened()).toBe('Unopened')

    addDiskFile(harness, '/repo/unopened.ts', 'unopened', 83)
    await expect(harness.service.undo()).resolves.toBe(true)
    expect(cachedUnopened()).toBe('unopened')
  })

  const rejectionCases: readonly RejectionCase[] = [
    {
      expectedCode: 'unsupported-uri',
      name: 'unsupported scheme',
      operations: () => [textOperation('https://example.com/repo/a.ts', null, 0, 0, 'x')],
    },
    {
      expectedCode: 'unsupported-uri',
      name: 'remote authority',
      operations: () => [textOperation('file://server/repo/a.ts', null, 0, 0, 'x')],
    },
    {
      expectedCode: 'outside-workspace',
      name: 'outside-root path',
      operations: () => [textOperation('file:///outside/a.ts', null, 0, 0, 'x')],
    },
    {
      expectedCode: 'symlink-target',
      name: 'symlink component',
      operations: () => [textOperation('file:///repo/link/a.ts', null, 0, 0, 'x')],
      setup: (harness) => {
        harness.inspections.set('/repo/link', existingInspection('/repo/link', 'symlink', 1))
      },
    },
    {
      expectedCode: 'ambiguous-resource-alias',
      name: 'distinct URI alias',
      operations: () => [
        textOperation('file:///repo/%61.ts', null, 0, 0, 'x'),
        textOperation('file:///repo/a.ts', null, 0, 0, 'y'),
      ],
      setup: (harness) => {
        addLiveDocument(harness, '/repo/a.ts', 'a')
      },
    },
    {
      expectedCode: 'unsupported-resource-type',
      name: 'directory resource',
      operations: () => [deleteOperation('file:///repo/directory')],
      setup: (harness) => {
        harness.inspections.set(
          '/repo/directory',
          existingInspection('/repo/directory', 'directory', 1),
        )
      },
    },
    {
      expectedCode: 'dirty-destructive-target',
      name: 'dirty destructive resource',
      operations: () => [deleteOperation('file:///repo/dirty.ts')],
      setup: (harness) => {
        const document = addLiveDocument(harness, '/repo/dirty.ts', 'dirty')
        createEditorBufferSession(document.buffer).applyText('!')
      },
    },
  ]

  test.each(rejectionCases)('rejects $name before preview', async (testCase) => {
    const harness = createHarness()
    testCase.setup?.(harness)

    const result = await harness.service.onApplyWorkspaceEdit(
      request(testCase.operations(harness), { originUri: fileUri('/repo/origin.ts') }),
    )

    expect(result).toMatchObject({ code: testCase.expectedCode, status: 'failed' })
    expect(harness.service.getSnapshot().preview).toBeNull()
    expect(harness.transport.prepares).toEqual([])
    expect(harness.operationEvents[0]?.settlements).toEqual([{ outcome: testCase.expectedCode }])
  })

  test('rejects a noncanonical case spelling before preview', async () => {
    const harness = createHarness()
    harness.inspections.set(
      '/repo/A.ts',
      existingInspection('/repo/A.ts', 'file', 1, 'case-version', '/repo/a.ts'),
    )

    const result = await harness.service.onApplyWorkspaceEdit(
      request([textOperation(fileUri('/repo/A.ts'), null, 0, 0, 'x')], {
        originUri: fileUri('/repo/A.ts'),
      }),
    )

    expect(result).toMatchObject({ code: 'ambiguous-resource-alias', status: 'failed' })
    expect(harness.service.getSnapshot().preview).toBeNull()
    expect(harness.transport.prepares).toEqual([])
  })

  test('accepts distinct case-sensitive canonical spellings as distinct targets', async () => {
    const harness = createHarness()
    addDiskFile(harness, '/repo/a.ts', 'lower', 1)
    addDiskFile(harness, '/repo/A.ts', 'upper', 2)

    const pending = harness.service.onApplyWorkspaceEdit(
      request(
        [
          textOperation(fileUri('/repo/a.ts'), null, 0, 0, 'x'),
          textOperation(fileUri('/repo/A.ts'), null, 0, 0, 'y'),
        ],
        { originUri: fileUri('/repo/a.ts') },
      ),
    )
    await waitForPhase(harness.service, 'awaiting-confirmation')

    expect(harness.service.getSnapshot().preview?.rows.map((row) => row.path)).toEqual([
      '/repo/a.ts',
      '/repo/A.ts',
    ])
    harness.service.cancelPreview(harness.service.getSnapshot().preview!.operationId)
    await expect(pending).resolves.toEqual({ status: 'cancelled' })
  })

  test('restores live text and reports rolled back when finalize fails after persistence commit', async () => {
    const harness = createHarness({ failFinalize: true })
    const live = addLiveDocument(harness, '/repo/live.ts', 'live')
    addDiskFile(harness, '/repo/unopened.ts', 'unopened', 100)
    const liveUri = fileUri(live.target)
    const unopenedUri = fileUri('/repo/unopened.ts')
    const provenance = currentProvenance(live.buffer.getTextSnapshot(), liveUri, 6)
    const pending = harness.service.onApplyWorkspaceEdit(
      request(
        [textOperation(liveUri, null, 0, 1, 'L'), textOperation(unopenedUri, null, 0, 1, 'U')],
        { documents: [provenance], originUri: liveUri },
      ),
    )
    await waitForPhase(harness.service, 'awaiting-confirmation')

    harness.service.confirmPreview(harness.service.getSnapshot().preview!.operationId)
    const result = await pending

    expect(result).toMatchObject({ code: 'workspace-edit-rolled-back', status: 'rolled-back' })
    expect(live.buffer.materializeFullText()).toBe('live')
    expect(harness.service.getSnapshot()).toMatchObject({ canUndo: false, phase: 'rolled-back' })
    expect(harness.transport.transitionNames).toContain('rollback')
    expect(harness.transport.releases).toHaveLength(1)
    expect(harness.service.isOwnEvent(OPERATION_ID)).toBe(false)
  })

  test('enters recovery-required with exact paths when persistence compensation is partial', async () => {
    const harness = createHarness({ failFinalize: true, partialRollback: true })
    const live = addLiveDocument(harness, '/repo/live.ts', 'live')
    addDiskFile(harness, '/repo/unopened.ts', 'unopened', 110)
    const liveUri = fileUri(live.target)
    const unopenedUri = fileUri('/repo/unopened.ts')
    const provenance = currentProvenance(live.buffer.getTextSnapshot(), liveUri, 8)
    const pending = harness.service.onApplyWorkspaceEdit(
      request(
        [textOperation(liveUri, null, 0, 1, 'L'), textOperation(unopenedUri, null, 0, 1, 'U')],
        { documents: [provenance], originUri: liveUri },
      ),
    )
    await waitForPhase(harness.service, 'awaiting-confirmation')

    harness.service.confirmPreview(harness.service.getSnapshot().preview!.operationId)
    const result = await pending

    expect(result).toMatchObject({
      affectedPaths: ['unopened.ts'],
      code: 'workspace-edit-recovery-required',
      status: 'recovery-required',
    })
    expect(live.buffer.materializeFullText()).toBe('live')
    expect(harness.service.getSnapshot()).toMatchObject({
      canUndo: false,
      phase: 'recovery-required',
      recovery: {
        affectedPaths: ['unopened.ts'],
        operationId: OPERATION_ID,
        unrecoveredPaths: ['unopened.ts'],
      },
    })
    createEditorBufferSession(live.buffer).applyText(' editable')
    expect(live.buffer.materializeFullText()).toBe('live editable')
    expect(harness.operationEvents[0]).toMatchObject({
      phases: ['preview', 'committing', 'finalizing', 'rolling-back'],
      settlements: [
        {
          outcome: 'recovery-required',
          recoveryPaths: ['unopened.ts'],
          rollbackOutcome: 'partial',
        },
      ],
    })
  })

  test('retains failed stable-journal cleanup and retries it explicitly', async () => {
    const harness = createHarness({ failReleaseAttempts: 2 })
    addDiskFile(harness, '/repo/unopened.ts', 'unopened', 101)
    const pending = harness.service.onApplyWorkspaceEdit(
      request([textOperation(fileUri('/repo/unopened.ts'), null, 0, 1, 'U')], {
        originUri: fileUri('/repo/unopened.ts'),
      }),
    )
    await waitForPhase(harness.service, 'awaiting-confirmation')
    harness.service.confirmPreview(harness.service.getSnapshot().preview!.operationId)
    await expect(pending).resolves.toEqual({ status: 'applied' })

    await expect(harness.service.runWorkspaceMutation('all', async () => true)).resolves.toBe(true)

    expect(harness.service.canUndoWorkspaceEdit()).toBe(false)
    expect(harness.service.isOwnEvent(OPERATION_ID)).toBe(true)
    expect(harness.transport.releases).toHaveLength(2)

    await harness.service.runWorkspaceMutation([], async () => true)

    expect(harness.transport.releases).toHaveLength(3)
    expect(harness.service.isOwnEvent(OPERATION_ID)).toBe(false)
  })

  test('acknowledged partial discard leaves affected buffers read-only with no sync base', async () => {
    const harness = createHarness({ failFinalize: true, partialRollback: true })
    const source = addLiveDocument(harness, '/repo/before.ts', 'saved')
    createEditorBufferSession(source.buffer).applyText(' unsaved')
    const beforeText = source.buffer.materializeFullText()
    const pending = harness.service.onApplyWorkspaceEdit(
      request([renameOperation(fileUri('/repo/before.ts'), fileUri('/repo/after.ts'))], {
        originUri: fileUri('/repo/before.ts'),
      }),
    )
    await waitForPhase(harness.service, 'awaiting-confirmation')

    harness.service.confirmPreview(harness.service.getSnapshot().preview!.operationId)
    await expect(pending).resolves.toMatchObject({ status: 'recovery-required' })
    expect(
      harness.store.getState().getLiveEditorDocument(testDocumentKey('/repo/before.ts'))?.buffer,
    ).toBe(source.buffer)
    createEditorBufferSession(source.buffer).applyText(' blocked-before-discard')
    expect(source.buffer.materializeFullText()).toBe(beforeText)

    await expect(
      harness.service.discardRecoveryData(['after.ts', 'before.ts'].map(filesystemPath)),
    ).resolves.toBe(true)

    const conflicted = harness.store
      .getState()
      .getLiveEditorDocument(testDocumentKey('/repo/before.ts'))!
    expect(conflicted.buffer.materializeFullText()).toBe(beforeText)
    expect(conflicted.buffer.isDirty()).toBe(true)
    expect(conflicted.sync).toEqual({
      affectedPaths: ['/repo/after.ts', '/repo/before.ts'],
      kind: 'recovery-conflict',
      operationId: OPERATION_ID,
    })
    createEditorBufferSession(conflicted.buffer).applyText(' blocked')
    expect(conflicted.buffer.materializeFullText()).toBe(beforeText)
    await expect(
      new EditorSaveService(
        harness.store,
        createTestQueryClient(),
        harness.fileSync,
        new SettingsSyncService(harness.store, createTestQueryClient()),
        null,
      ).save(testDocumentKey('/repo/before.ts')),
    ).resolves.toBe(false)
    expect(harness.service.canSwitchRoot()).toBe(false)
    const pathRequest = harness.store
      .getState()
      .prepareWorkspaceDocumentPathReservation(filesystemPath('/repo/after.ts'))
    const reserved = harness.store
      .getState()
      .reserveWorkspaceDocumentPaths([pathRequest], 'after-discard')
    expect(reserved.status).toBe('acquired')
    if (reserved.status === 'acquired') {
      harness.store.getState().releaseWorkspaceDocumentPaths(reserved.reservation)
    }
  })

  test('keeps affected buffers frozen through retry then restores their prior sync and editability', async () => {
    const harness = createHarness({ failFinalize: true, partialRollback: true })
    const source = addLiveDocument(harness, '/repo/before.ts', 'saved')
    createEditorBufferSession(source.buffer).applyText(' unsaved')
    const beforeText = source.buffer.materializeFullText()
    const pending = harness.service.onApplyWorkspaceEdit(
      request([renameOperation(fileUri('/repo/before.ts'), fileUri('/repo/after.ts'))], {
        originUri: fileUri('/repo/before.ts'),
      }),
    )
    await waitForPhase(harness.service, 'awaiting-confirmation')
    harness.service.confirmPreview(harness.service.getSnapshot().preview!.operationId)
    await expect(pending).resolves.toMatchObject({ status: 'recovery-required' })

    createEditorBufferSession(source.buffer).applyText(' blocked')
    expect(source.buffer.materializeFullText()).toBe(beforeText)

    await expect(harness.service.retryRecovery()).resolves.toBe(true)
    const recovered = harness.store
      .getState()
      .getLiveEditorDocument(testDocumentKey('/repo/before.ts'))!
    expect(recovered.sync.kind).toBe('file')
    createEditorBufferSession(recovered.buffer).applyText(' editable')
    expect(recovered.buffer.materializeFullText()).toBe(`${beforeText} editable`)
    expect(harness.service.getSnapshot()).toMatchObject({ phase: 'recovered', recovery: null })
  })

  test('syncs edit-before-rename on the old URI before projecting the new URI', async () => {
    const harness = createHarness()
    const source = addLiveDocument(harness, '/repo/before.ts', 'saved')
    const events: string[] = []
    source.buffer.subscribe(() => events.push('change'))
    harness.onUriTransition = () => events.push('uri')
    const sourceUri = fileUri(source.target)
    const destinationUri = fileUri('/repo/after.ts')
    const provenance = currentProvenance(source.buffer.getTextSnapshot(), sourceUri, 4)
    const pending = harness.service.onApplyWorkspaceEdit(
      request(
        [textOperation(sourceUri, null, 0, 1, 'S'), renameOperation(sourceUri, destinationUri)],
        { documents: [provenance], originUri: sourceUri },
      ),
    )
    await waitForPhase(harness.service, 'awaiting-confirmation')

    harness.service.confirmPreview(harness.service.getSnapshot().preview!.operationId)
    await expect(pending).resolves.toEqual({ status: 'applied' })

    expect(events).toEqual(['change', 'uri'])
    expect(harness.uriTransitions).toHaveLength(1)
    expect(harness.uriTransitions[0]).toMatchObject({
      fromUri: sourceUri,
      toUri: destinationUri,
    })
    expect(harness.uriTransitions[0]?.textSnapshot.materializeFullText()).toBe('Saved')
    expect(
      harness.store.getState().getLiveEditorDocument(testDocumentKey('/repo/after.ts'))?.buffer,
    ).toBe(source.buffer)
  })

  test('projects rename-before-edit before the new URI change', async () => {
    const harness = createHarness()
    const source = addLiveDocument(harness, '/repo/before.ts', 'saved')
    const events: string[] = []
    source.buffer.subscribe(() => events.push('change'))
    harness.onUriTransition = () => events.push('uri')
    const sourceUri = fileUri(source.target)
    const destinationUri = fileUri('/repo/after.ts')
    const pending = harness.service.onApplyWorkspaceEdit(
      request(
        [
          renameOperation(sourceUri, destinationUri),
          textOperation(destinationUri, null, 0, 1, 'S'),
        ],
        { originUri: sourceUri },
      ),
    )
    await waitForPhase(harness.service, 'awaiting-confirmation')

    harness.service.confirmPreview(harness.service.getSnapshot().preview!.operationId)
    await expect(pending).resolves.toEqual({ status: 'applied' })

    expect(events).toEqual(['uri', 'change'])
    expect(harness.uriTransitions[0]?.textSnapshot.materializeFullText()).toBe('saved')
    expect(source.buffer.materializeFullText()).toBe('Saved')
  })

  test('uses content snapshot versions for resource-only persistence guards', async () => {
    const harness = createHarness()
    addDiskFile(harness, '/repo/before.ts', 'content', 30)
    harness.inspections.set(
      '/repo/before.ts',
      existingInspection('/repo/before.ts', 'file', 30, 'stat-metadata-version'),
    )
    const pending = harness.service.onApplyWorkspaceEdit(
      request([renameOperation(fileUri('/repo/before.ts'), fileUri('/repo/after.ts'))], {
        originUri: fileUri('/repo/before.ts'),
      }),
    )
    await waitForPhase(harness.service, 'awaiting-confirmation')

    harness.service.confirmPreview(harness.service.getSnapshot().preview!.operationId)
    await expect(pending).resolves.toEqual({ status: 'applied' })
    expect(harness.transport.prepares[0]?.operations).toMatchObject([
      {
        kind: 'rename',
        source: { kind: 'snapshot', mtimeMs: 30, version: 'test:30:7' },
      },
    ])
  })

  test('evicts intersecting history while retaining older disjoint groups', async () => {
    const intersecting = createHarness()
    const first = addLiveDocument(intersecting, '/repo/first.ts', 'first')
    const second = addLiveDocument(intersecting, '/repo/second.ts', 'second')
    await applyTwoBufferGroup(intersecting, first, second)

    await expect(applyImmediateEdit(intersecting, first, 'F', 20)).resolves.toEqual({
      status: 'applied',
    })
    expect(intersecting.service.canUndoWorkspaceEdit()).toBe(false)

    const disjoint = createHarness()
    const groupFirst = addLiveDocument(disjoint, '/repo/group-first.ts', 'first')
    const groupSecond = addLiveDocument(disjoint, '/repo/group-second.ts', 'second')
    const separate = addLiveDocument(disjoint, '/repo/separate.ts', 'separate')
    await applyTwoBufferGroup(disjoint, groupFirst, groupSecond)

    await expect(applyImmediateEdit(disjoint, separate, 'S', 21)).resolves.toEqual({
      status: 'applied',
    })
    expect(disjoint.service.canUndoWorkspaceEdit()).toBe(true)
    await expect(disjoint.service.undo()).resolves.toBe(true)
    expect(groupFirst.buffer.materializeFullText()).toBe('first')
    expect(groupSecond.buffer.materializeFullText()).toBe('second')
    expect(separate.buffer.materializeFullText()).toBe('Separate')
  })

  test('clears every redo group after a new forward workspace mutation', async () => {
    const harness = createHarness()
    const first = addLiveDocument(harness, '/repo/first.ts', 'first')
    const second = addLiveDocument(harness, '/repo/second.ts', 'second')
    const separate = addLiveDocument(harness, '/repo/separate.ts', 'separate')
    await applyTwoBufferGroup(harness, first, second)
    await expect(harness.service.undo()).resolves.toBe(true)
    expect(harness.service.canRedoWorkspaceEdit()).toBe(true)

    await expect(applyImmediateEdit(harness, separate, 'S', 22)).resolves.toEqual({
      status: 'applied',
    })
    expect(harness.service.canRedoWorkspaceEdit()).toBe(false)
  })

  test('clears workspace history when the observed server epoch changes', async () => {
    const harness = createHarness()
    const first = addLiveDocument(harness, '/repo/first.ts', 'first')
    const second = addLiveDocument(harness, '/repo/second.ts', 'second')
    await applyTwoBufferGroup(harness, first, second)
    expect(harness.service.canUndoWorkspaceEdit()).toBe(true)

    harness.transport.restartServer('20000000-0000-4000-8000-000000000064')
    await harness.fileSync.statusWorkspaceMutation('missing-after-restart')

    expect(harness.service.canUndoWorkspaceEdit()).toBe(false)
    expect(harness.service.canRedoWorkspaceEdit()).toBe(false)
  })

  test('treats an aborted prepare result as cancelled without recovery state', async () => {
    const harness = createHarness({ abortPrepare: true })
    addDiskFile(harness, '/repo/a.ts', 'a', 10)
    const pending = harness.service.onApplyWorkspaceEdit(
      request([textOperation(fileUri('/repo/a.ts'), null, 0, 1, 'A')], {
        originUri: fileUri('/repo/a.ts'),
      }),
    )
    await waitForPhase(harness.service, 'awaiting-confirmation')

    harness.service.confirmPreview(harness.service.getSnapshot().preview!.operationId)

    await expect(pending).resolves.toEqual({ status: 'cancelled' })
    expect(harness.service.getSnapshot()).toMatchObject({ phase: 'cancelled', recovery: null })
    expect(harness.service.canUndoWorkspaceEdit()).toBe(false)
  })

  test('retains inverse locks and operation ownership when undo compensation is partial', async () => {
    const harness = createHarness({ partialUndo: true })
    const source = addLiveDocument(harness, '/repo/before.ts', 'saved')
    const pending = harness.service.onApplyWorkspaceEdit(
      request([renameOperation(fileUri('/repo/before.ts'), fileUri('/repo/after.ts'))], {
        originUri: fileUri('/repo/before.ts'),
      }),
    )
    await waitForPhase(harness.service, 'awaiting-confirmation')
    harness.service.confirmPreview(harness.service.getSnapshot().preview!.operationId)
    await expect(pending).resolves.toEqual({ status: 'applied' })

    await expect(harness.service.undo()).resolves.toBe(false)

    expect(harness.service.getSnapshot()).toMatchObject({
      canRedo: false,
      canUndo: false,
      phase: 'recovery-required',
      recovery: {
        affectedPaths: ['after.ts', 'before.ts'],
        operationId: OPERATION_ID,
        unrecoveredPaths: ['after.ts', 'before.ts'],
      },
    })
    expect(harness.service.isOwnEvent(OPERATION_ID)).toBe(true)
    expect(
      harness.store.getState().getLiveEditorDocument(testDocumentKey('/repo/after.ts'))?.buffer,
    ).toBe(source.buffer)
    createEditorBufferSession(source.buffer).applyText(' blocked')
    expect(source.buffer.materializeFullText()).toBe('saved')
    expect(harness.service.acquireWorkspaceMutationReservation()).toBeNull()

    await expect(harness.service.retryRecovery()).resolves.toBe(true)

    expect(
      harness.store.getState().getLiveEditorDocument(testDocumentKey('/repo/after.ts'))?.buffer,
    ).toBe(source.buffer)
    createEditorBufferSession(source.buffer).applyText(' editable')
    expect(source.buffer.materializeFullText()).toBe('saved editable')
    expect(harness.service.getSnapshot()).toMatchObject({
      canRedo: false,
      canUndo: false,
      phase: 'recovered',
      recovery: null,
    })
    expect(harness.transport.releases).toHaveLength(1)
    expect(harness.service.isOwnEvent(OPERATION_ID)).toBe(false)
  })

  test('external workspace mutation reservation blocks transactions and releases idempotently', async () => {
    const harness = createHarness()
    const first = addLiveDocument(harness, '/repo/first.ts', 'first')
    const second = addLiveDocument(harness, '/repo/second.ts', 'second')
    await applyTwoBufferGroup(harness, first, second)
    const reservation = harness.service.acquireWorkspaceMutationReservation()
    if (!reservation) throw new RangeError('expected workspace mutation reservation')

    expect(harness.service.canMutateWorkspace()).toBe(false)
    await expect(harness.service.undo()).resolves.toBe(false)
    await expect(applyImmediateEdit(harness, first, 'F', 23)).resolves.toMatchObject({
      code: 'workspace-edit-busy',
      status: 'failed',
    })
    expect(harness.operationEvents.at(-1)?.settlements).toEqual([
      { outcome: 'workspace-edit-busy' },
    ])

    expect(harness.service.releaseWorkspaceMutationReservation(reservation)).toBe(true)
    expect(harness.service.releaseWorkspaceMutationReservation(reservation)).toBe(true)
    expect(harness.service.canMutateWorkspace()).toBe(true)
    await expect(harness.service.undo()).resolves.toBe(true)
  })

  test('a newer root-switch reservation supersedes only an older root switch', () => {
    const harness = createHarness()
    const first = harness.service.acquireRootSwitchReservation()
    if (!first) throw new RangeError('expected first root-switch reservation')
    expect(harness.service.canSwitchRoot()).toBe(true)

    const second = harness.service.acquireRootSwitchReservation()
    if (!second) throw new RangeError('expected superseding root-switch reservation')
    expect(second).not.toBe(first)
    expect(harness.service.releaseRootSwitchReservation(first)).toBe(true)
    expect(harness.service.canMutateWorkspace()).toBe(false)
    expect(harness.service.releaseRootSwitchReservation(second)).toBe(true)
    expect(harness.service.canMutateWorkspace()).toBe(true)

    const ordinary = harness.service.acquireWorkspaceMutationReservation()
    if (!ordinary) throw new RangeError('expected ordinary mutation reservation')
    expect(harness.service.acquireRootSwitchReservation()).toBeNull()
    expect(harness.service.releaseWorkspaceMutationReservation(ordinary)).toBe(true)
  })

  test('runs an external mutation under the gate and always releases it', async () => {
    const harness = createHarness()
    await expect(harness.service.runWorkspaceMutation('all', async () => 'saved')).resolves.toBe(
      'saved',
    )
    expect(harness.service.canMutateWorkspace()).toBe(true)

    const held = harness.service.acquireWorkspaceMutationReservation()
    if (!held) throw new RangeError('expected held mutation reservation')
    await expect(
      harness.service.runWorkspaceMutation('all', async () => 'unreachable'),
    ).rejects.toMatchObject({ code: 'workspace-edit-busy' })
    expect(harness.service.releaseWorkspaceMutationReservation(held)).toBe(true)

    await expect(
      harness.service.runWorkspaceMutation('all', async () => {
        throw new TypeError('injected mutation failure')
      }),
    ).rejects.toThrow('injected mutation failure')
    expect(harness.service.canMutateWorkspace()).toBe(true)
  })

  test('invalidates only reported partial-success paths when an external batch rejects', async () => {
    const harness = createHarness()
    const first = addLiveDocument(harness, '/repo/first.ts', 'first')
    const second = addLiveDocument(harness, '/repo/second.ts', 'second')
    await applyTwoBufferGroup(harness, first, second)

    await expect(
      harness.service.runWorkspaceMutation(
        [filesystemPath('/repo/unrelated.ts')],
        async (reportAffectedPaths) => {
          reportAffectedPaths([filesystemPath('/repo/first.ts')])
          throw new TypeError('later batch leg failed')
        },
      ),
    ).rejects.toThrow('later batch leg failed')

    expect(harness.service.canUndoWorkspaceEdit()).toBe(false)
    expect(harness.service.canMutateWorkspace()).toBe(true)
  })

  test('retains history after a failed external mutation that reports no changed path', async () => {
    const harness = createHarness()
    const first = addLiveDocument(harness, '/repo/first.ts', 'first')
    const second = addLiveDocument(harness, '/repo/second.ts', 'second')
    await applyTwoBufferGroup(harness, first, second)

    await expect(
      harness.service.runWorkspaceMutation('all', async () => {
        throw new TypeError('mutation failed before writing')
      }),
    ).rejects.toThrow('mutation failed before writing')

    expect(harness.service.canUndoWorkspaceEdit()).toBe(true)
  })

  test('uses reported successful paths instead of a conservative declared scope', async () => {
    const harness = createHarness()
    const first = addLiveDocument(harness, '/repo/first.ts', 'first')
    const second = addLiveDocument(harness, '/repo/second.ts', 'second')
    await applyTwoBufferGroup(harness, first, second)

    await harness.service.runWorkspaceMutation('all', async (reportAffectedPaths) => {
      reportAffectedPaths([filesystemPath('/repo/separate.ts')])
      return true
    })

    expect(harness.service.canUndoWorkspaceEdit()).toBe(true)
  })

  test('ordinary typing immediately invalidates intersecting history but retains disjoint groups', async () => {
    const intersecting = createHarness()
    const first = addLiveDocument(intersecting, '/repo/first.ts', 'first')
    const second = addLiveDocument(intersecting, '/repo/second.ts', 'second')
    await applyTwoBufferGroup(intersecting, first, second)

    createEditorBufferSession(first.buffer).applyText(' changed')
    expect(intersecting.service.canUndoWorkspaceEdit()).toBe(false)

    const disjoint = createHarness()
    const groupFirst = addLiveDocument(disjoint, '/repo/group-first.ts', 'first')
    const groupSecond = addLiveDocument(disjoint, '/repo/group-second.ts', 'second')
    const separate = addLiveDocument(disjoint, '/repo/separate.ts', 'separate')
    await applyTwoBufferGroup(disjoint, groupFirst, groupSecond)

    createEditorBufferSession(separate.buffer).applyText(' changed')
    expect(disjoint.service.canUndoWorkspaceEdit()).toBe(true)
  })

  test('ordinary forward mutation clears redo and only intersecting undo groups', async () => {
    const harness = createHarness()
    const first = addLiveDocument(harness, '/repo/first.ts', 'first')
    const second = addLiveDocument(harness, '/repo/second.ts', 'second')
    await applyTwoBufferGroup(harness, first, second)
    await expect(harness.service.undo()).resolves.toBe(true)

    await expect(
      harness.service.runWorkspaceMutation(
        [filesystemPath('/repo/separate.ts')],
        async () => 'mutated',
      ),
    ).resolves.toBe('mutated')

    expect(harness.service.canRedoWorkspaceEdit()).toBe(false)
  })

  test('ordinary invalidation follows newer transitive path dependencies', async () => {
    const harness = createHarness()
    const firstA = addLiveDocument(harness, '/repo/first-a.ts', 'first-a')
    const firstB = addLiveDocument(harness, '/repo/first-b.ts', 'first-b')
    const secondA = addLiveDocument(harness, '/repo/second-a.ts', 'second-a')
    const secondB = addLiveDocument(harness, '/repo/second-b.ts', 'second-b')
    const disjointA = addLiveDocument(harness, '/repo/disjoint-a.ts', 'disjoint-a')
    const disjointB = addLiveDocument(harness, '/repo/disjoint-b.ts', 'disjoint-b')
    await applyTwoBufferGroup(harness, firstA, firstB)
    await applyTwoBufferGroup(harness, secondA, secondB)
    await applyTwoBufferGroup(harness, disjointA, disjointB)
    const groups = mutableUndoGroups(harness.service)
    groups[0]!.affectedPaths = ['/chain/a', '/chain/b']
    groups[1]!.affectedPaths = ['/chain/b', '/chain/c']
    groups[2]!.affectedPaths = ['/disjoint']

    await harness.service.runWorkspaceMutation([filesystemPath('/chain/a')], async () => true)

    expect(harness.service.canUndoWorkspaceEdit()).toBe(true)
    await expect(harness.service.undo()).resolves.toBe(true)
    expect(disjointA.buffer.materializeFullText()).toBe('disjoint-a')
    expect(disjointB.buffer.materializeFullText()).toBe('disjoint-b')
  })

  test('stale inverse invalidation walks older transitive dependencies and retains disjoint history', async () => {
    const harness = createHarness()
    const disjointA = addLiveDocument(harness, '/repo/disjoint-a.ts', 'disjoint-a')
    const disjointB = addLiveDocument(harness, '/repo/disjoint-b.ts', 'disjoint-b')
    const firstA = addLiveDocument(harness, '/repo/first-a.ts', 'first-a')
    const firstB = addLiveDocument(harness, '/repo/first-b.ts', 'first-b')
    const secondA = addLiveDocument(harness, '/repo/second-a.ts', 'second-a')
    const secondB = addLiveDocument(harness, '/repo/second-b.ts', 'second-b')
    const thirdA = addLiveDocument(harness, '/repo/third-a.ts', 'third-a')
    const thirdB = addLiveDocument(harness, '/repo/third-b.ts', 'third-b')
    await applyTwoBufferGroup(harness, disjointA, disjointB)
    await applyTwoBufferGroup(harness, firstA, firstB)
    await applyTwoBufferGroup(harness, secondA, secondB)
    await applyTwoBufferGroup(harness, thirdA, thirdB)
    const groups = mutableUndoGroups(harness.service)
    groups[0]!.affectedPaths = ['/disjoint']
    groups[1]!.affectedPaths = ['/chain/a', '/chain/b']
    groups[2]!.affectedPaths = ['/chain/b', '/chain/c']
    groups[3]!.affectedPaths = ['/chain/c', '/chain/d']
    const staleTarget = groups[3]!.receipts.keys().next().value
    if (!staleTarget) throw new RangeError('expected history target')
    staleTarget.currentPath = '/repo/missing-history-target.ts'

    await expect(harness.service.undo()).resolves.toBe(false)

    expect(harness.service.canUndoWorkspaceEdit()).toBe(true)
    await expect(harness.service.undo()).resolves.toBe(true)
    expect(disjointA.buffer.materializeFullText()).toBe('disjoint-a')
    expect(disjointB.buffer.materializeFullText()).toBe('disjoint-b')
  })
  test('LSP unknown clean live source requires preview and retains unknown provenance', async () => {
    const harness = createHarness()
    const origin = addLiveDocument(harness, '/repo/origin.ts', 'origin')
    const target = addLiveDocument(harness, '/repo/unknown.ts', 'target')
    const originUri = fileUri(origin.target)
    const application = request([textOperation(fileUri(target.target), null, 0, 1, 'T')], {
      documents: [currentProvenance(origin.buffer.getTextSnapshot(), originUri, 1)],
      originUri,
    })

    const pending = harness.service.onApplyWorkspaceEdit(application)
    await waitForPhase(harness.service, 'awaiting-confirmation')
    expect(target.buffer.materializeFullText()).toBe('target')
    expect(application.guard.documents.map((document) => document.uri)).toEqual([originUri])
    expect(harness.service.getSnapshot().preview?.rows[0]).toMatchObject({ targetKind: 'open' })

    harness.service.confirmPreview(harness.service.getSnapshot().preview!.operationId)
    await expect(pending).resolves.toEqual({ status: 'applied' })
    expect(target.buffer.materializeFullText()).toBe('Target')
    expect(origin.buffer.materializeFullText()).toBe('origin')
    expect(harness.transport.prepares).toEqual([])
  })

  test('LSP unknown dirty secondary source rejects despite a current known origin', async () => {
    const harness = createHarness()
    const origin = addLiveDocument(harness, '/repo/origin.ts', 'origin')
    const target = addLiveDocument(harness, '/repo/unknown.ts', 'target')
    createEditorBufferSession(target.buffer).applyText(' newer')
    const originUri = fileUri(origin.target)

    const result = await harness.service.onApplyWorkspaceEdit(
      request([textOperation(fileUri(target.target), null, 0, 1, 'T')], {
        documents: [currentProvenance(origin.buffer.getTextSnapshot(), originUri, 1)],
        originUri,
      }),
    )

    expect(result).toMatchObject({ code: 'version-mismatch', status: 'failed' })
    expect(target.buffer.materializeFullText()).toBe('target newer')
    expect(harness.transport.prepares).toEqual([])
  })

  test('LSP unknown clean source drifting after preview stays untouched', async () => {
    const harness = createHarness()
    const origin = addLiveDocument(harness, '/repo/origin.ts', 'origin')
    const target = addLiveDocument(harness, '/repo/unknown.ts', 'target')
    const originUri = fileUri(origin.target)
    const pending = harness.service.onApplyWorkspaceEdit(
      request([textOperation(fileUri(target.target), null, 0, 1, 'T')], {
        documents: [currentProvenance(origin.buffer.getTextSnapshot(), originUri, 1)],
        originUri,
      }),
    )
    await waitForPhase(harness.service, 'awaiting-confirmation')
    createEditorBufferSession(target.buffer).applyText(' newer')

    harness.service.confirmPreview(harness.service.getSnapshot().preview!.operationId)
    await expect(pending).resolves.toMatchObject({ code: 'snapshot-drift', status: 'failed' })
    expect(target.buffer.materializeFullText()).toBe('target newer')
    expect(harness.transport.prepares).toEqual([])
  })

  test('LSP unknown closed source opened during preparation rejects ownership drift', async () => {
    const reading = Promise.withResolvers<void>()
    const release = Promise.withResolvers<void>()
    const harness = createHarness({
      beforeRead: () => {
        reading.resolve()
        return release.promise
      },
    })
    const origin = addLiveDocument(harness, '/repo/origin.ts', 'origin')
    const file = addDiskFile(harness, '/repo/unknown.ts', 'target', 90)
    const originUri = fileUri(origin.target)
    const application = request([textOperation(fileUri(file.path), null, 0, 1, 'T')], {
      documents: [currentProvenance(origin.buffer.getTextSnapshot(), originUri, 1)],
      originUri,
    })

    const pending = harness.service.onApplyWorkspaceEdit(application)
    await reading.promise
    const opened = harness.store.getState().ensureLiveEditorDocument(file)
    release.resolve()

    await expect(pending).resolves.toMatchObject({ code: 'snapshot-drift', status: 'failed' })
    expect(opened.buffer.materializeFullText()).toBe('target')
    expect(application.guard.documents.map((document) => document.uri)).toEqual([originUri])
    expect(harness.transport.prepares).toEqual([])
    expect(harness.service.getSnapshot().preview).toBeNull()
  })

  test.each([true, false])(
    'LSP checks origin-only drift and ignores unrelated catalog drift: %s',
    async (driftOrigin) => {
      const harness = createHarness()
      const origin = addLiveDocument(harness, '/repo/origin.ts', 'origin')
      const unrelated = addLiveDocument(harness, '/repo/unrelated.ts', 'unrelated')
      const target = addLiveDocument(harness, '/repo/target.ts', 'target')
      const originUri = fileUri(origin.target)
      const unrelatedUri = fileUri(unrelated.target)
      const originSnapshot = origin.buffer.getTextSnapshot()
      const unrelatedSnapshot = unrelated.buffer.getTextSnapshot()
      const application = request([textOperation(fileUri(target.target), null, 0, 1, 'T')], {
        documents: [
          currentProvenance(originSnapshot, originUri, 1),
          currentProvenance(unrelatedSnapshot, unrelatedUri, 2),
        ],
        originUri,
      })
      const pending = harness.service.onApplyWorkspaceEdit({
        ...application,
        guard: {
          documents: application.guard.documents,
          isCurrent: (uri) => {
            if (uri === originUri) return origin.buffer.getTextSnapshot() === originSnapshot
            if (uri === unrelatedUri)
              return unrelated.buffer.getTextSnapshot() === unrelatedSnapshot
            return false
          },
        },
      })
      await waitForPhase(harness.service, 'awaiting-confirmation')
      createEditorBufferSession(driftOrigin ? origin.buffer : unrelated.buffer).applyText(' newer')

      harness.service.confirmPreview(harness.service.getSnapshot().preview!.operationId)
      const result = await pending
      if (driftOrigin) expect(result).toMatchObject({ code: 'version-mismatch', status: 'failed' })
      else expect(result).toEqual({ status: 'applied' })
      expect(target.buffer.materializeFullText()).toBe(driftOrigin ? 'target' : 'Target')
      expect(harness.transport.prepares).toEqual([])
    },
  )
})

function createHarness(options: HarnessOptions = {}) {
  const store = createEditorDocumentStore()
  const files = new Map<string, FileResult>()
  const inspections = new Map<string, WorkspaceEditPathInspection>()
  const transport = new RecordingWorkspaceMutationTransport(options)
  const uriTransitions: Array<
    Parameters<LanguageServerDocumentSyncController['transitionDocumentUri']>[0]
  > = []
  const operationEvents: CapturedWorkspaceOperationEvent[] = []
  let onUriTransition: () => void = () => undefined
  const queryClient = new QueryClient()
  const fileSync = new FileSyncService(store, queryClient, {
    readFileContent: async (path, signal) => {
      await options.beforeRead?.()
      signal.throwIfAborted()
      const file = files.get(path)
      if (file) return file
      throw { code: 'NOT_FOUND', message: `Missing test file: ${path}` }
    },
    workspaceMutations: transport,
    writeFileContent: async (path, content) => treeEntry(path, content, 1),
  })
  const service = new WorkspaceEditService({
    owner: { environmentId: null, machine: null },
    createOperationId: () => OPERATION_ID,
    createOperationEvent: (eventOptions) => {
      const event = new CapturedWorkspaceOperationEvent(
        eventOptions.operationId,
        eventOptions.source,
      )
      operationEvents.push(event)
      return event
    },
    documentStore: store,
    documentSyncController: {
      transitionDocumentUri: (transition) => {
        uriTransitions.push(transition)
        onUriTransition()
      },
    },
    fileSync,
    getRoot: () => options.root ?? { generation: 1, path: ROOT },
    inspectPath: async (path, signal) => {
      signal.throwIfAborted()
      const explicit = inspections.get(path)
      if (explicit) return explicit
      const file = files.get(path)
      if (!file) return { exists: false, path }
      return existingInspection(path, 'file', file.mtimeMs, file.version)
    },
  })
  return {
    fileSync,
    files,
    inspections,
    operationEvents,
    queryClient,
    service,
    store,
    transport,
    uriTransitions,
    set onUriTransition(listener: () => void) {
      onUriTransition = listener
    },
  }
}

class CapturedWorkspaceOperationEvent implements WorkspaceEditOperationEventPort {
  counts: Parameters<WorkspaceEditOperationEventPort['setPrepared']>[0] | null = null
  readonly phases: Parameters<WorkspaceEditOperationEventPort['transition']>[0][] = []
  readonly settlements: Parameters<WorkspaceEditOperationEventPort['end']>[0][] = []

  constructor(
    readonly operationId: string,
    readonly source: string,
  ) {}

  end(settlement: Parameters<WorkspaceEditOperationEventPort['end']>[0]): void {
    this.settlements.push(settlement)
  }

  setPrepared(counts: Parameters<WorkspaceEditOperationEventPort['setPrepared']>[0]): void {
    this.counts = counts
  }

  transition(phase: Parameters<WorkspaceEditOperationEventPort['transition']>[0]): void {
    this.phases.push(phase)
  }
}

type MutableTestHistoryGroup = {
  affectedPaths: readonly string[]
  readonly receipts: Map<{ currentPath: string }, unknown>
}

function mutableUndoGroups(service: WorkspaceEditService): MutableTestHistoryGroup[] {
  return (service as unknown as { undoStack: MutableTestHistoryGroup[] }).undoStack
}

class RecordingWorkspaceMutationTransport implements WorkspaceMutationTransport {
  readonly prepares: WorkspaceEditPrepareRequest[] = []
  readonly releases: WorkspaceEditReleaseRequest[] = []
  readonly transitionNames: WorkspaceMutationTransition[] = []
  private readonly currentByOperationId = new Map<string, WorkspaceEditResult>()
  private releaseFailuresRemaining: number
  private serverEpoch = SERVER_EPOCH

  constructor(private readonly options: HarnessOptions) {
    this.releaseFailuresRemaining = options.failReleaseAttempts ?? 0
  }

  async prepare(request: WorkspaceEditPrepareRequest): Promise<WorkspaceEditResult> {
    this.prepares.push(request)
    const result = workspaceResult(
      request.operationId,
      1,
      this.options.abortPrepare ? 'aborted' : 'prepared',
      requestAffectedPaths(request),
      {},
      this.serverEpoch,
    )
    this.currentByOperationId.set(request.operationId, result)
    return result
  }

  async transition(
    transition: WorkspaceMutationTransition,
    request: WorkspaceEditTransitionRequest,
  ): Promise<WorkspaceEditResult> {
    this.transitionNames.push(transition)
    if (transition === 'finalize' && this.options.failFinalize) {
      throw new TypeError('injected finalize response failure')
    }
    const current = this.requiredCurrent(request.operationId)
    const affectedPaths = current.affectedPaths
    if (transition === 'undo' && this.options.partialUndo) {
      const partial = workspaceResult(
        request.operationId,
        request.expectedGeneration + 1,
        'partial',
        affectedPaths,
        { recoveryTarget: 'finalized', unrecoveredPaths: affectedPaths },
        this.serverEpoch,
      )
      this.currentByOperationId.set(request.operationId, partial)
      return partial
    }
    if (transition === 'rollback' && this.options.partialRollback) {
      const partial = workspaceResult(
        request.operationId,
        request.expectedGeneration + 1,
        'partial',
        affectedPaths,
        { recoveryTarget: 'rolled-back', unrecoveredPaths: affectedPaths },
        this.serverEpoch,
      )
      this.currentByOperationId.set(request.operationId, partial)
      return partial
    }

    const result = workspaceResult(
      request.operationId,
      request.expectedGeneration + 1,
      transitionState(transition, current.state),
      affectedPaths,
      {},
      this.serverEpoch,
    )
    this.currentByOperationId.set(request.operationId, result)
    return result
  }

  async recover(request: WorkspaceEditRecoverRequest): Promise<WorkspaceEditResult> {
    const current = this.requiredCurrent(request.operationId)
    const result = workspaceResult(
      request.operationId,
      request.expectedGeneration + 1,
      request.recoveryTarget,
      current.affectedPaths,
      {},
      this.serverEpoch,
    )
    this.currentByOperationId.set(request.operationId, result)
    return result
  }

  async release(request: WorkspaceEditReleaseRequest): Promise<WorkspaceEditResult> {
    this.releases.push(request)
    if (this.releaseFailuresRemaining > 0) {
      this.releaseFailuresRemaining -= 1
      throw new TypeError('injected release failure')
    }
    const current = this.requiredCurrent(request.operationId)
    const result = workspaceResult(
      request.operationId,
      request.expectedGeneration + 1,
      'released',
      current.affectedPaths,
      {},
      this.serverEpoch,
    )
    this.currentByOperationId.set(request.operationId, result)
    return result
  }

  async status(operationId: string): Promise<WorkspaceEditStatusResult> {
    const current = this.currentByOperationId.get(operationId)
    if (current) return { found: true, result: current }
    return { found: false, operationId, serverEpoch: this.serverEpoch }
  }

  async recovery(): Promise<WorkspaceEditRecoveryListResult> {
    return { operations: [], serverEpoch: this.serverEpoch }
  }

  restartServer(serverEpoch: string): void {
    this.currentByOperationId.clear()
    this.serverEpoch = serverEpoch
  }

  private requiredCurrent(operationId: string): WorkspaceEditResult {
    const current = this.currentByOperationId.get(operationId)
    if (current) return current
    throw new RangeError(`Missing test workspace operation: ${operationId}`)
  }
}

function transitionState(
  transition: WorkspaceMutationTransition,
  current: WorkspaceEditResult['state'],
): WorkspaceEditResult['state'] {
  if (transition === 'abort') return 'aborted'
  if (transition === 'commit') return 'committed'
  if (transition === 'rollback') return 'rolled-back'
  if (transition === 'undo') return 'undo-committed'
  if (transition === 'redo') return 'redo-committed'
  if (current === 'undo-committed') return 'undone'
  if (current === 'redo-committed') return 'redone'
  return 'finalized'
}

function request(
  operations: readonly WorkspaceEditOperation[],
  options: {
    readonly currentUris?: readonly string[]
    readonly documents?: readonly WorkspaceTextDocumentProvenance[]
    readonly originUri: string
  },
): ApplyWorkspaceEditRequest {
  const documents = options.documents ?? []
  const currentUris = new Set(
    options.currentUris ?? [options.originUri, ...documents.map((entry) => entry.uri)],
  )
  const plan: ParsedWorkspaceEdit = { annotations: new Map(), operations }
  return {
    guard: {
      documents,
      isCurrent: (uri) => currentUris.has(uri),
    },
    label: 'Apply test workspace edit',
    logicalRevisionScope: createDocumentLogicalRevisionScope(),
    originUri: options.originUri,
    originVersion: documents[0]?.version ?? 1,
    plan,
    serverId: 'test-server',
    signal: new AbortController().signal,
    source: 'code-action',
  }
}

function textOperation(
  uri: string,
  version: number | null,
  start: number,
  end: number,
  newText: string,
): Extract<WorkspaceEditOperation, { readonly kind: 'text-document' }> {
  return {
    edits: [
      {
        newText,
        range: {
          end: { character: end, line: 0 },
          start: { character: start, line: 0 },
        },
      },
    ],
    kind: 'text-document',
    uri,
    version,
  }
}

function deleteOperation(
  uri: string,
): Extract<WorkspaceEditOperation, { readonly kind: 'delete' }> {
  return {
    ignoreIfNotExists: false,
    kind: 'delete',
    recursive: false,
    uri,
  }
}

function renameOperation(
  oldUri: string,
  newUri: string,
): Extract<WorkspaceEditOperation, { readonly kind: 'rename' }> {
  return {
    ignoreIfExists: false,
    kind: 'rename',
    newUri,
    oldUri,
    overwrite: false,
  }
}

function currentProvenance(
  textSnapshot: WorkspaceTextDocumentProvenance['textSnapshot'],
  uri: string,
  version: number,
): WorkspaceTextDocumentProvenance {
  return { textSnapshot, uri, version }
}

async function applyTwoBufferGroup(
  harness: Harness,
  first: ReturnType<typeof addLiveDocument>,
  second: ReturnType<typeof addLiveDocument>,
): Promise<void> {
  const firstUri = fileUri(first.target)
  const secondUri = fileUri(second.target)
  const pending = harness.service.onApplyWorkspaceEdit(
    request([textOperation(firstUri, null, 0, 1, 'F'), textOperation(secondUri, null, 0, 1, 'S')], {
      documents: [currentProvenance(first.buffer.getTextSnapshot(), firstUri, 10)],
      originUri: firstUri,
    }),
  )
  await waitForPhase(harness.service, 'awaiting-confirmation')
  harness.service.confirmPreview(harness.service.getSnapshot().preview!.operationId)
  await expect(pending).resolves.toEqual({ status: 'applied' })
}

function applyImmediateEdit(
  harness: Harness,
  document: ReturnType<typeof addLiveDocument>,
  newText: string,
  version: number,
) {
  const uri = fileUri(document.target)
  return harness.service.onApplyWorkspaceEdit(
    request([textOperation(uri, version, 0, 1, newText)], {
      documents: [currentProvenance(document.buffer.getTextSnapshot(), uri, version)],
      originUri: uri,
    }),
  )
}

function addLiveDocument(harness: Harness, path: string, content: string) {
  const file = addDiskFile(harness, path, content, 10)
  return harness.store.getState().ensureLiveEditorDocument(file)
}

function addDiskFile(harness: Harness, path: string, content: string, mtimeMs: number): FileResult {
  const file = fileResult(path, content, mtimeMs)
  harness.files.set(path, file)
  return file
}

function fileResult(path: string, content: string, mtimeMs: number): FileResult {
  return {
    content,
    mtimeMs,
    path: filesystemPath(path),
    size: new TextEncoder().encode(content).byteLength,
    version: `test:${mtimeMs}:${content.length}`,
  }
}

function treeEntry(path: string, content: string, mtimeMs: number): TreeEntry {
  return {
    birthtimeMs: mtimeMs,
    mtimeMs,
    name: path.split('/').at(-1) ?? path,
    path: filesystemPath(path),
    size: content.length,
    type: 'file',
    version: `test:${mtimeMs}:${content.length}`,
  }
}

function existingInspection(
  path: string,
  type: Extract<WorkspaceEditPathInspection, { readonly exists: true }>['type'],
  mtimeMs: number,
  version = `test:${mtimeMs}:0`,
  canonicalPath = path,
): WorkspaceEditPathInspection {
  return {
    canonicalPath: filesystemPath(canonicalPath),
    exists: true,
    mtimeMs,
    path: filesystemPath(path),
    type,
    version,
  }
}

function fileUri(target: string | DocumentRef): string {
  if (typeof target === 'string') return `file://${target}`
  const resource = filesystemResource(target)
  if (!resource)
    throw createClientInvariantError('Expected a file document in the workspace edit fixture')
  return `file://${resource.path}`
}

function requestAffectedPaths(request: WorkspaceEditPrepareRequest): readonly string[] {
  const paths = new Set<string>()
  for (const operation of request.operations) {
    if (operation.kind === 'rename') {
      paths.add(operation.oldPath)
      paths.add(operation.newPath)
      continue
    }
    paths.add(operation.path)
  }
  return Array.from(paths).sort()
}

function emptyTreeModel(): TreeModel {
  return {
    entriesByTreePath: new Map(),
    errorByDirectoryPath: new Map(),
    loadedDirectoryPaths: new Set(),
    loadingDirectoryPaths: new Set(),
    paths: [],
  }
}

function workspaceResult(
  operationId: string,
  generation: number,
  state: WorkspaceEditResult['state'],
  affectedPaths: readonly string[],
  recovery: {
    readonly recoveryTarget?: WorkspaceEditResult['recoveryTarget']
    readonly unrecoveredPaths?: readonly string[]
  } = {},
  serverEpoch = SERVER_EPOCH,
): WorkspaceEditResult {
  return {
    affectedPaths,
    entries: [],
    eventPublication: state === 'finalized' ? 'published' : 'pending',
    generation,
    operationId,
    ...(recovery.recoveryTarget ? { recoveryTarget: recovery.recoveryTarget } : {}),
    rolledBackPaths: [],
    serverEpoch,
    state,
    unrecoveredPaths: recovery.unrecoveredPaths ?? [],
  }
}

async function waitForPhase(
  service: WorkspaceEditService,
  phase: WorkspaceEditServicePhase,
): Promise<void> {
  if (service.getSnapshot().phase === phase) return
  await new Promise<void>((resolve) => {
    const unsubscribe = service.subscribe(() => {
      if (service.getSnapshot().phase !== phase) return
      unsubscribe()
      resolve()
    })
  })
}
