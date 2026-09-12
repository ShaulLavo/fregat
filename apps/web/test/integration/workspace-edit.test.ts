import { lstat, mkdir, readFile, symlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import { createDocumentLogicalRevisionScope, createEditorBufferSession } from '@singapor/core'
import type {
  ApplyWorkspaceEditRequest,
  WorkspaceTextDocumentProvenance,
} from '@singapor/lsp-plugin'
import type {
  ParsedWorkspaceEdit,
  WorkspaceEditOperation,
} from '@singapor/lsp-plugin/workspace-edit'
import { createTestQueryClient } from '../render'
import {
  nodeWorkspaceEditFileSystemDriver,
  type WorkspaceEditFileSystemDriver,
} from 'server/testing'

import { fileDocumentKey, filesystemPath, tabId } from '@/lib/documents/utils/identity'
import { createEditorDocumentStore } from '@/features/editor/state/document-state'
import { FileSyncService } from '@/features/editor/state/file-sync-service'
import {
  WorkspaceEditService,
  type WorkspaceEditServicePhase,
} from '@/features/editor/state/workspace-edit-service'
import { getClient, setClient } from '@/lib/client'
import { fetchFile, fetchTree, writeFileContent } from '@/lib/file-server'
import { fileSystemKeys } from '@/lib/query-keys'
import { treeModel } from '@/lib/tree-model'

import { createInProcessClient, createRestartableInProcessClient } from '../client'
import { expect, test } from '../fixtures'
import { makeTestServer, type TestServer } from '../server'

test('applies one group across a dirty active buffer an open secondary and an unopened file', async ({
  client,
  server,
}) => {
  void client
  const harness = createHarness()
  const activePath = 'active.ts'
  const secondaryPath = 'secondary.ts'
  const unopenedPath = 'unopened.ts'
  await writeWorkspaceFiles(server.root, [
    [activePath, 'active'],
    [secondaryPath, 'secondary'],
    [unopenedPath, 'unopened'],
  ])
  const active = await openDocument(harness, activePath)
  const secondary = await openDocument(harness, secondaryPath)
  createEditorBufferSession(active.buffer).applyEdits([{ from: 6, to: 6, text: '!' }])
  const activeUri = fileUri(activePath)
  const provenance = currentProvenance(active, activeUri, 7)

  const pending = harness.service.onApplyWorkspaceEdit(
    request(
      [
        textOperation(activeUri, null, 0, 1, 'A'),
        textOperation(fileUri(secondaryPath), null, 0, 1, 'S'),
        textOperation(fileUri(unopenedPath), null, 0, 1, 'U'),
      ],
      activeUri,
      [provenance],
    ),
  )
  await waitForPhase(harness.service, 'awaiting-confirmation')

  expect(harness.service.getSnapshot().preview?.rows).toMatchObject([
    {
      afterText: 'Active!',
      beforeText: 'active!',
      path: activePath,
      targetKind: 'dirty',
    },
    {
      afterText: 'Secondary',
      beforeText: 'secondary',
      path: secondaryPath,
      targetKind: 'open',
    },
    {
      afterText: 'Unopened',
      beforeText: 'unopened',
      path: unopenedPath,
      targetKind: 'unopened',
    },
  ])
  harness.service.confirmPreview()
  await expect(pending).resolves.toEqual({ status: 'applied' })

  expect(active.buffer.materializeFullText()).toBe('Active!')
  expect(secondary.buffer.materializeFullText()).toBe('Secondary')
  expect(active.buffer.isDirty()).toBe(true)
  expect(secondary.buffer.isDirty()).toBe(true)
  expect(await readText(server.root, activePath)).toBe('active')
  expect(await readText(server.root, secondaryPath)).toBe('secondary')
  expect(await readText(server.root, unopenedPath)).toBe('Unopened')
  expect(
    harness.store.getState().hasLiveEditorDocument(fileDocumentKey(filesystemPath(unopenedPath))),
  ).toBe(false)
  expect(Object.keys(harness.store.getState().liveDocumentsByKey)).toHaveLength(2)
  expect(harness.service.getSnapshot()).toMatchObject({ canRedo: false, canUndo: true })
  expectPathsAvailable(harness, [activePath, secondaryPath, unopenedPath])
})

test('rejects live and unopened drift after preview with zero net mutation', async ({
  client,
  server,
}) => {
  void client
  const harness = createHarness()
  const livePath = 'live.ts'
  const unopenedPath = 'unopened.ts'
  const untouchedPath = 'untouched.ts'
  await writeWorkspaceFiles(server.root, [
    [livePath, 'live'],
    [unopenedPath, 'unopened'],
    [untouchedPath, 'untouched'],
  ])
  const live = await openDocument(harness, livePath)
  const unopened = await fetchFile(unopenedPath, signal())
  const liveUri = fileUri(livePath)
  const pending = harness.service.onApplyWorkspaceEdit(
    request(
      [
        textOperation(liveUri, null, 0, 1, 'L'),
        textOperation(fileUri(unopenedPath), null, 0, 1, 'U'),
        textOperation(fileUri(untouchedPath), null, 0, 1, 'T'),
      ],
      liveUri,
      [currentProvenance(live, liveUri, 3)],
    ),
  )
  await waitForPhase(harness.service, 'awaiting-confirmation')

  createEditorBufferSession(live.buffer).applyEdits([{ from: 4, to: 4, text: '!' }])
  await writeFileContent(unopenedPath, 'external change', {
    baseVersion: unopened.version,
    expectedMtimeMs: unopened.mtimeMs,
  })
  harness.service.confirmPreview()

  await expect(pending).resolves.toMatchObject({ code: 'snapshot-drift', status: 'failed' })
  expect(live.buffer.materializeFullText()).toBe('live!')
  expect(await readText(server.root, livePath)).toBe('live')
  expect(await readText(server.root, unopenedPath)).toBe('external change')
  expect(await readText(server.root, untouchedPath)).toBe('untouched')
  expect(
    harness.store.getState().hasLiveEditorDocument(fileDocumentKey(filesystemPath(unopenedPath))),
  ).toBe(false)
  expect(harness.service.getSnapshot().canUndo).toBe(false)
  await expect(harness.fileSync.discoverWorkspaceRecovery('')).resolves.toMatchObject({
    operations: [],
  })
  expectPathsAvailable(harness, [livePath, unopenedPath, untouchedPath])
})

test('rejects an unopened target that becomes a clean live document after preview', async ({
  client,
  server,
}) => {
  void client
  const harness = createHarness()
  const unopenedPath = 'late-open.ts'
  await writeWorkspaceFiles(server.root, [[unopenedPath, 'unopened']])
  const uri = fileUri(unopenedPath)
  const pending = harness.service.onApplyWorkspaceEdit(
    request([textOperation(uri, null, 0, 1, 'U')], uri),
  )
  await waitForPhase(harness.service, 'awaiting-confirmation')

  const opened = await openDocument(harness, unopenedPath)
  harness.service.confirmPreview()

  await expect(pending).resolves.toMatchObject({ code: 'snapshot-drift', status: 'failed' })
  expect(opened.buffer.materializeFullText()).toBe('unopened')
  expect(opened.buffer.isDirty()).toBe(false)
  expect(await readText(server.root, unopenedPath)).toBe('unopened')
  expect(harness.service.getSnapshot().canUndo).toBe(false)
})

test('rolls back when an unopened target becomes dirty after server prepare starts', async () => {
  const entered = deferred<void>()
  const release = deferred<void>()
  await withCustomServer(pausingPrepareDriver(entered, release), async (server) => {
    const harness = createHarness()
    const livePath = 'prepare-live.ts'
    const unopenedPath = 'prepare-unopened.ts'
    await writeWorkspaceFiles(server.root, [
      [livePath, 'live'],
      [unopenedPath, 'unopened'],
    ])
    const live = await openDocument(harness, livePath)
    const unopenedFile = await fetchFile(unopenedPath, signal())
    const liveUri = fileUri(livePath)
    const pending = harness.service.onApplyWorkspaceEdit(
      request(
        [
          textOperation(liveUri, null, 0, 1, 'L'),
          textOperation(fileUri(unopenedPath), null, 0, 1, 'U'),
        ],
        liveUri,
        [currentProvenance(live, liveUri, 4)],
      ),
    )
    await waitForPhase(harness.service, 'awaiting-confirmation')
    harness.service.confirmPreview()
    await entered.promise

    const opened = harness.store.getState().ensureLiveEditorDocument(unopenedFile)
    createEditorBufferSession(opened.buffer).applyEdits([{ from: 8, to: 8, text: '!' }])
    release.resolve()

    await expect(pending).resolves.toMatchObject({ code: 'workspace-path-stale', status: 'failed' })
    expect(live.buffer.materializeFullText()).toBe('live')
    expect(opened.buffer.materializeFullText()).toBe('unopened!')
    expect(opened.buffer.isDirty()).toBe(true)
    expect(await readText(server.root, unopenedPath)).toBe('unopened')
    expect(harness.service.getSnapshot()).toMatchObject({ canUndo: false, phase: 'stale' })
    await expect(harness.fileSync.discoverWorkspaceRecovery('')).resolves.toMatchObject({
      operations: [],
    })
    expectPathsAvailable(harness, [livePath, unopenedPath])
  })
})

test('commits and reconciles create edit rename delete options in order', async ({
  client,
  server,
}) => {
  void client
  const harness = createHarness()
  const createdPath = 'created.ts'
  const renamedPath = 'renamed.ts'
  const deletedPath = 'deleted.ts'
  await writeWorkspaceFiles(server.root, [[deletedPath, 'delete me']])
  const deletedSnapshot = await fetchFile(deletedPath, signal())
  const initialTree = await fetchTree('', signal())
  harness.queryClient.setQueryData(fileSystemKeys.fileSnapshot(deletedPath), deletedSnapshot)
  harness.queryClient.setQueryData(fileSystemKeys.tree(''), treeModel(initialTree, ''))
  const createdUri = fileUri(createdPath)
  const pending = harness.service.onApplyWorkspaceEdit(
    request(
      [
        createOperation(createdUri),
        textOperation(createdUri, null, 0, 0, 'created text'),
        renameOperation(createdUri, fileUri(renamedPath)),
        deleteOperation(fileUri(deletedPath)),
      ],
      createdUri,
    ),
  )
  await waitForPhase(harness.service, 'awaiting-confirmation')

  expect(harness.service.getSnapshot().preview?.rows.map((row) => row.kind)).toEqual([
    'create',
    'text-document',
    'rename',
    'delete',
  ])
  harness.service.confirmPreview()
  await expect(pending).resolves.toEqual({ status: 'applied' })

  expect(await pathExists(server.root, createdPath)).toBe(false)
  expect(await pathExists(server.root, deletedPath)).toBe(false)
  expect(await readText(server.root, renamedPath)).toBe('created text')
  expect(
    harness.store.getState().hasLiveEditorDocument(fileDocumentKey(filesystemPath(createdPath))),
  ).toBe(false)
  expect(
    harness.store.getState().hasLiveEditorDocument(fileDocumentKey(filesystemPath(renamedPath))),
  ).toBe(false)
  const snapshot = await fetchFile(renamedPath, signal())
  expect(snapshot).toMatchObject({ content: 'created text', path: renamedPath })
  expect(harness.queryClient.getQueryData(fileSystemKeys.fileSnapshot(renamedPath))).toMatchObject({
    content: 'created text',
    path: renamedPath,
  })
  expect(harness.queryClient.getQueryData(fileSystemKeys.fileSnapshot(deletedPath))).toBeUndefined()
  const projectedTree = harness.queryClient.getQueryData<ReturnType<typeof treeModel>>(
    fileSystemKeys.tree(''),
  )
  expect(projectedTree?.entriesByTreePath.has(renamedPath)).toBe(true)
  expect(projectedTree?.entriesByTreePath.has(deletedPath)).toBe(false)
  const tree = await fetchTree('', signal())
  expect(tree.entries.map((entry) => entry.name)).toContain('renamed.ts')
  expect(tree.entries.map((entry) => entry.name)).not.toContain('deleted.ts')
})

test('undoes and redoes an applied group only while every after stamp matches', async ({
  client,
  server,
}) => {
  void client
  const harness = createHarness()
  const livePath = 'history-live.ts'
  const unopenedPath = 'history-disk.ts'
  await writeWorkspaceFiles(server.root, [
    [livePath, 'live'],
    [unopenedPath, 'disk'],
  ])
  const unopenedSnapshot = await fetchFile(unopenedPath, signal())
  harness.queryClient.setQueryData(fileSystemKeys.fileSnapshot(unopenedPath), unopenedSnapshot)
  const live = await openDocument(harness, livePath)
  const uri = fileUri(livePath)
  const pending = harness.service.onApplyWorkspaceEdit(
    request(
      [textOperation(uri, null, 0, 1, 'L'), textOperation(fileUri(unopenedPath), null, 0, 1, 'D')],
      uri,
      [currentProvenance(live, uri, 5)],
    ),
  )
  await waitForPhase(harness.service, 'awaiting-confirmation')
  harness.service.confirmPreview()
  await expect(pending).resolves.toEqual({ status: 'applied' })

  await expect(harness.service.undo()).resolves.toBe(true)
  expect(live.buffer.materializeFullText()).toBe('live')
  expect(await readText(server.root, unopenedPath)).toBe('disk')
  expect(harness.queryClient.getQueryData(fileSystemKeys.fileSnapshot(unopenedPath))).toMatchObject(
    {
      content: 'disk',
    },
  )
  await expect(harness.service.redo()).resolves.toBe(true)
  expect(live.buffer.materializeFullText()).toBe('Live')
  expect(await readText(server.root, unopenedPath)).toBe('Disk')
  expect(harness.queryClient.getQueryData(fileSystemKeys.fileSnapshot(unopenedPath))).toMatchObject(
    {
      content: 'Disk',
    },
  )

  await writeFile(diskPath(server.root, unopenedPath), 'external history drift')
  await expect(harness.service.undo()).resolves.toBe(false)
  expect(live.buffer.materializeFullText()).toBe('Live')
  expect(await readText(server.root, unopenedPath)).toBe('external history drift')
  expect(harness.service.getSnapshot()).toMatchObject({ canRedo: false, canUndo: false })
})

test('evicts the oldest history group at the cap and releases every path', async ({
  client,
  server,
}) => {
  void client
  const harness = createHarness()
  const groups = Array.from({ length: 21 }, (_, index) => ({
    firstPath: `cap-${index}-first.ts`,
    secondPath: `cap-${index}-second.ts`,
  }))
  await writeWorkspaceFiles(
    server.root,
    groups.flatMap(({ firstPath, secondPath }) => [
      [firstPath, 'a'] as const,
      [secondPath, 'b'] as const,
    ]),
  )
  const documents: {
    readonly first: Awaited<ReturnType<typeof openDocument>>
    readonly second: Awaited<ReturnType<typeof openDocument>>
  }[] = []

  for (let index = 0; index < 21; index += 1) {
    const group = groups[index]!
    const first = await openDocument(harness, group.firstPath)
    const second = await openDocument(harness, group.secondPath)
    documents.push({ first, second })
    const firstUri = fileUri(group.firstPath)
    const secondUri = fileUri(group.secondPath)
    const pending = harness.service.onApplyWorkspaceEdit(
      request(
        [textOperation(firstUri, null, 1, 1, 'x'), textOperation(secondUri, null, 1, 1, 'y')],
        firstUri,
        [
          currentProvenance(first, firstUri, index + 1),
          currentProvenance(second, secondUri, index + 1),
        ],
      ),
    )
    await waitForPhase(harness.service, 'awaiting-confirmation')
    harness.service.confirmPreview()
    await expect(pending).resolves.toEqual({ status: 'applied' })
  }

  let undoCount = 0
  for (let index = 0; index < 21; index += 1) {
    if (!(await harness.service.undo())) break
    undoCount += 1
  }
  expect(undoCount).toBe(20)
  await expect(harness.service.undo()).resolves.toBe(false)
  expect(documents[0]?.first.buffer.materializeFullText()).toBe('ax')
  expect(documents[0]?.second.buffer.materializeFullText()).toBe('by')
  expect(documents[1]?.first.buffer.materializeFullText()).toBe('a')
  expect(documents[1]?.second.buffer.materializeFullText()).toBe('b')
  expect(harness.service.getSnapshot()).toMatchObject({ canRedo: true, canUndo: false })
  harness.service.resetForRoot()
  expect(harness.service.getSnapshot()).toMatchObject({ canRedo: false, canUndo: false })
  expectPathsAvailable(
    harness,
    groups.flatMap(({ firstPath, secondPath }) => [firstPath, secondPath]),
  )
})

test('invalidates history when the server epoch changes after restart', async () => {
  const previous = getClient()
  const firstServer = await makeTestServer()
  const connection = createRestartableInProcessClient(firstServer)
  setClient(connection.client)
  try {
    const harness = createHarness()
    const livePath = 'restart-live.ts'
    const unopenedPath = 'restart-disk.ts'
    await writeWorkspaceFiles(firstServer.root, [
      [livePath, 'live'],
      [unopenedPath, 'disk'],
    ])
    const live = await openDocument(harness, livePath)
    const liveUri = fileUri(livePath)
    const pending = harness.service.onApplyWorkspaceEdit(
      request(
        [
          textOperation(liveUri, null, 0, 1, 'L'),
          textOperation(fileUri(unopenedPath), null, 0, 1, 'D'),
        ],
        liveUri,
        [currentProvenance(live, liveUri, 3)],
      ),
    )
    await waitForPhase(harness.service, 'awaiting-confirmation')
    harness.service.confirmPreview()
    await expect(pending).resolves.toEqual({ status: 'applied' })
    expect(harness.service.getSnapshot().canUndo).toBe(true)

    const restarted = await makeTestServer()
    try {
      connection.reconnect(restarted)
      await harness.fileSync.discoverWorkspaceRecovery('')
      expect(harness.service.getSnapshot()).toMatchObject({ canRedo: false, canUndo: false })
      await expect(harness.service.undo()).resolves.toBe(false)
      expect(live.buffer.materializeFullText()).toBe('Live')
      expect(await readText(firstServer.root, unopenedPath)).toBe('Disk')
      expectPathsAvailable(harness, [livePath, unopenedPath])
    } finally {
      await restarted.cleanup()
    }
  } finally {
    setClient(previous)
    await firstServer.cleanup()
  }
})

test('compensates a later persistence failure and restores live state', async () => {
  await withCustomServer(failingSecondWriteDriver(), async (server) => {
    const harness = createHarness()
    const livePath = 'failure-live.ts'
    const firstPath = 'first.ts'
    const secondPath = 'second.ts'
    await writeWorkspaceFiles(server.root, [
      [livePath, 'live'],
      [firstPath, 'first'],
      [secondPath, 'second'],
    ])
    const live = await openDocument(harness, livePath)
    createEditorBufferSession(live.buffer).applyEdits([{ from: 4, to: 4, text: '!' }])
    const liveUri = fileUri(livePath)
    const pending = harness.service.onApplyWorkspaceEdit(
      request(
        [
          textOperation(liveUri, null, 0, 1, 'L'),
          textOperation(fileUri(firstPath), null, 0, 1, 'F'),
          textOperation(fileUri(secondPath), null, 0, 1, 'S'),
        ],
        liveUri,
        [currentProvenance(live, liveUri, 12)],
      ),
    )
    await waitForPhase(harness.service, 'awaiting-confirmation')

    harness.service.confirmPreview()
    await expect(pending).resolves.toMatchObject({ status: 'rolled-back' })
    expect(live.buffer.materializeFullText()).toBe('live!')
    expect(live.buffer.isDirty()).toBe(true)
    expect(await readText(server.root, firstPath)).toBe('first')
    expect(await readText(server.root, secondPath)).toBe('second')
    expect(harness.service.getSnapshot()).toMatchObject({ canRedo: false, canUndo: false })
    await expect(harness.fileSync.discoverWorkspaceRecovery('')).resolves.toMatchObject({
      operations: [],
    })
    expectPathsAvailable(harness, [livePath, firstPath, secondPath])
  })
})

test('surfaces exact recovery state and resumes it from a fresh service', async () => {
  const failure: PartialWriteFailure = {
    failCompensation: true,
    failSecondForward: true,
    firstRenameCount: 0,
  }
  await withCustomServer(partialWriteDriver(failure), async (server) => {
    const firstPath = 'first.ts'
    const secondPath = 'second.ts'
    await writeWorkspaceFiles(server.root, [
      [firstPath, 'first'],
      [secondPath, 'second'],
    ])
    const harness = createHarness()
    const firstUri = fileUri(firstPath)
    const pending = harness.service.onApplyWorkspaceEdit(
      request(
        [
          textOperation(firstUri, null, 0, 1, 'F'),
          textOperation(fileUri(secondPath), null, 0, 1, 'S'),
        ],
        firstUri,
      ),
    )
    await waitForPhase(harness.service, 'awaiting-confirmation')
    harness.service.confirmPreview()

    await expect(pending).resolves.toMatchObject({ status: 'recovery-required' })
    expect(harness.service.getSnapshot()).toMatchObject({
      canUndo: false,
      phase: 'recovery-required',
      recovery: { unrecoveredPaths: [firstPath] },
    })
    expect(await readText(server.root, firstPath)).toBe('First')
    expect(await readText(server.root, secondPath)).toBe('second')

    const reloaded = createHarness()
    await reloaded.service.discoverRecovery()
    expect(reloaded.service.getSnapshot()).toMatchObject({
      phase: 'recovery-required',
      recovery: { unrecoveredPaths: [firstPath] },
    })
    await expect(reloaded.service.retryRecovery()).resolves.toBe(false)
    failure.failCompensation = false
    await expect(reloaded.service.retryRecovery()).resolves.toBe(true)
    expect(await readText(server.root, firstPath)).toBe('first')
    expect(await readText(server.root, secondPath)).toBe('second')
    await expect(reloaded.fileSync.discoverWorkspaceRecovery('')).resolves.toMatchObject({
      operations: [],
    })
    expectPathsAvailable(reloaded, [firstPath, secondPath])
  })
})

test('acknowledges exact partial paths and keeps unsaved live text read only', async () => {
  await withCustomServer(partialRenameWriteDriver(), async (server) => {
    const harness = createHarness()
    const firstPath = 'first.ts'
    const renamedPath = 'renamed.ts'
    const secondPath = 'second.ts'
    await writeWorkspaceFiles(server.root, [
      [firstPath, 'first'],
      [secondPath, 'second'],
    ])
    const live = await openDocument(harness, firstPath)
    createEditorBufferSession(live.buffer).applyEdits([{ from: 5, to: 5, text: '!' }])
    const firstUri = fileUri(firstPath)
    const pending = harness.service.onApplyWorkspaceEdit(
      request(
        [
          renameOperation(firstUri, fileUri(renamedPath)),
          textOperation(fileUri(secondPath), null, 0, 1, 'S'),
        ],
        firstUri,
      ),
    )
    await waitForPhase(harness.service, 'awaiting-confirmation')
    harness.service.confirmPreview()
    await expect(pending).resolves.toMatchObject({ status: 'recovery-required' })

    expect(live.buffer.materializeFullText()).toBe('first!')
    await expect(harness.service.discardRecoveryData([secondPath])).resolves.toBe(false)
    const unrecoveredPaths = harness.service.getSnapshot().recovery!.unrecoveredPaths
    expect(unrecoveredPaths).toEqual([firstPath, renamedPath])
    await expect(harness.service.discardRecoveryData(unrecoveredPaths)).resolves.toBe(true)
    const retained = harness.store
      .getState()
      .getLiveEditorDocument(fileDocumentKey(filesystemPath(firstPath)))!
    expect(retained.buffer).toBe(live.buffer)
    expect(retained.target).toEqual({ kind: 'file', resource: { path: firstPath } })
    expect(retained.sync).toMatchObject({
      affectedPaths: [firstPath, renamedPath, secondPath],
      kind: 'recovery-conflict',
    })
    createEditorBufferSession(retained.buffer).applyEdits([{ from: 6, to: 6, text: '?' }])
    expect(retained.buffer.materializeFullText()).toBe('first!')
    await expect(harness.fileSync.save(retained)).rejects.toBeDefined()
    expect(await pathExists(server.root, firstPath)).toBe(false)
    expect(await readText(server.root, renamedPath)).toBe('first')
    expect(await readText(server.root, secondPath)).toBe('second')
    await expect(harness.fileSync.discoverWorkspaceRecovery('')).resolves.toMatchObject({
      operations: [],
    })
    expectPathsAvailable(harness, [firstPath, renamedPath, secondPath])
  })
})

test('excludes an overlapping legacy write while commit holds the transaction lease', async () => {
  const entered = deferred<void>()
  const release = deferred<void>()
  await withCustomServer(pausingCommitDriver(entered, release), async (server) => {
    const harness = createHarness()
    const filePath = 'lease.ts'
    await writeWorkspaceFiles(server.root, [[filePath, 'before']])
    const before = await fetchFile(filePath, signal())
    const uri = fileUri(filePath)
    const pending = harness.service.onApplyWorkspaceEdit(
      request([textOperation(uri, null, 0, 1, 'A')], uri),
    )
    await waitForPhase(harness.service, 'awaiting-confirmation')
    harness.service.confirmPreview()
    await entered.promise

    try {
      await expect(
        writeFileContent(filePath, 'legacy', {
          baseVersion: before.version,
          expectedMtimeMs: before.mtimeMs,
        }),
      ).rejects.toMatchObject({ code: 'WORKSPACE_EDIT_BUSY' })
    } finally {
      release.resolve()
    }

    await expect(pending).resolves.toEqual({ status: 'applied' })
    expect(await readText(server.root, filePath)).toBe('Aefore')
    const committed = await fetchFile(filePath, signal())
    await expect(
      writeFileContent(filePath, 'after lease', {
        baseVersion: committed.version,
        expectedMtimeMs: committed.mtimeMs,
      }),
    ).resolves.toMatchObject({ path: filePath })
    expect(await readText(server.root, filePath)).toBe('after lease')
  })
})

test('cancels a paused prepare and blocks root reset during commit', async () => {
  const entered = deferred<void>()
  const release = deferred<void>()
  await withCustomServer(pausingPrepareDriver(entered, release), async (server) => {
    const harness = createHarness()
    const filePath = 'paused.ts'
    await writeWorkspaceFiles(server.root, [[filePath, 'before']])
    const uri = fileUri(filePath)
    const pending = harness.service.onApplyWorkspaceEdit(
      request([textOperation(uri, null, 0, 1, 'A')], uri),
    )
    await waitForPhase(harness.service, 'awaiting-confirmation')
    const operationId = harness.service.getSnapshot().preview!.operationId
    harness.service.confirmPreview()
    await entered.promise

    expect(harness.service.canSwitchRoot()).toBe(false)
    harness.service.resetForRoot()
    expect(harness.service.getSnapshot().phase).toBe('committing')
    const aborting = harness.fileSync.abortWorkspaceMutation(operationId, 0)
    release.resolve()

    const [aborted, applyResult] = await Promise.all([aborting, pending])
    expect(aborted.state).toBe('aborted')
    expect(applyResult).toEqual({ status: 'cancelled' })
    expect(await readText(server.root, filePath)).toBe('before')
    expect(harness.service.canSwitchRoot()).toBe(true)
    await expect(harness.fileSync.discoverWorkspaceRecovery('')).resolves.toMatchObject({
      operations: [],
    })
    expectPathsAvailable(harness, [filePath])
  })
})

test('rejects unsupported scheme authority outside-root symlink and dirty destructive resource', async ({
  client,
  server,
}) => {
  void client
  const harness = createHarness()
  const directoryPath = 'directory'
  const sourcePath = 'source.ts'
  const symlinkPath = 'source-link.ts'
  const dirtyPath = 'dirty.ts'
  await mkdir(diskPath(server.root, directoryPath))
  await writeWorkspaceFiles(server.root, [
    [sourcePath, 'source'],
    [dirtyPath, 'dirty'],
  ])
  await symlink(diskPath(server.root, sourcePath), diskPath(server.root, symlinkPath))
  const dirty = await openDocument(harness, dirtyPath)
  createEditorBufferSession(dirty.buffer).applyEdits([{ from: 5, to: 5, text: '!' }])
  const cases: readonly [string, string, readonly WorkspaceEditOperation[]][] = [
    [
      'unsupported-uri',
      'untitled:unsupported.ts',
      [textOperation('untitled:unsupported.ts', null, 0, 0, 'x')],
    ],
    [
      'unsupported-uri',
      'file://server/repo/remote.ts',
      [textOperation('file://server/repo/remote.ts', null, 0, 0, 'x')],
    ],
    [
      'outside-workspace',
      'file:///../outside.ts',
      [textOperation('file:///../outside.ts', null, 0, 0, 'x')],
    ],
    [
      'symlink-target',
      fileUri(symlinkPath),
      [renameOperation(fileUri(symlinkPath), fileUri(`${symlinkPath}.renamed`))],
    ],
    [
      'unsupported-resource-type',
      fileUri(directoryPath),
      [deleteOperation(fileUri(directoryPath))],
    ],
    ['dirty-destructive-target', fileUri(dirtyPath), [deleteOperation(fileUri(dirtyPath))]],
  ]

  for (const [code, originUri, operations] of cases) {
    const result = await harness.service.onApplyWorkspaceEdit(request(operations, originUri))
    expect(result).toMatchObject({ code, status: 'failed' })
  }

  expect(await readText(server.root, sourcePath)).toBe('source')
  expect((await lstat(diskPath(server.root, symlinkPath))).isSymbolicLink()).toBe(true)
  expect((await lstat(diskPath(server.root, directoryPath))).isDirectory()).toBe(true)
  expect(dirty.buffer.materializeFullText()).toBe('dirty!')
  expect(await readText(server.root, dirtyPath)).toBe('dirty')
})

test('preserves old disk bytes for open edit then rename until explicit save', async ({
  client,
  server,
}) => {
  void client
  const harness = createHarness()
  const sourcePath = 'before.ts'
  const destinationPath = 'after.ts'
  await writeWorkspaceFiles(server.root, [[sourcePath, 'saved bytes']])
  const sourceFile = await fetchFile(sourcePath, signal())
  const live = harness.store.getState().ensureEditorView(tabId('source-tab'), sourceFile)
  const sourceUri = fileUri(sourcePath)
  const pending = harness.service.onApplyWorkspaceEdit(
    request(
      [
        textOperation(sourceUri, null, 0, 0, 'edited '),
        renameOperation(sourceUri, fileUri(destinationPath)),
      ],
      sourceUri,
      [currentProvenance(live, sourceUri, 9)],
    ),
  )
  await waitForPhase(harness.service, 'awaiting-confirmation')
  harness.service.confirmPreview()
  await expect(pending).resolves.toEqual({ status: 'applied' })

  const renamed = harness.store
    .getState()
    .getLiveEditorDocument(fileDocumentKey(filesystemPath(destinationPath)))
  expect(renamed?.buffer.materializeFullText()).toBe('edited saved bytes')
  expect(renamed?.buffer.isDirty()).toBe(true)
  expect(await pathExists(server.root, sourcePath)).toBe(false)
  expect(await readText(server.root, destinationPath)).toBe('saved bytes')
  expect(harness.store.getState().getEditorView(tabId('source-tab'))?.documentKey).toBe(
    fileDocumentKey(filesystemPath(destinationPath)),
  )

  if (renamed) await harness.fileSync.save(renamed)
  expect(await readText(server.root, destinationPath)).toBe('edited saved bytes')
  expect(
    harness.store
      .getState()
      .getLiveEditorDocument(fileDocumentKey(filesystemPath(destinationPath)))
      ?.buffer.isDirty(),
  ).toBe(false)
})

type IntegrationHarness = ReturnType<typeof createHarness>

function createHarness() {
  const store = createEditorDocumentStore()
  const queryClient = createTestQueryClient()
  const fileSync = new FileSyncService(store, queryClient)
  const service = new WorkspaceEditService({
    documentStore: store,
    fileSync,
    getRoot: () => ({ generation: 1, path: '', uriPath: '/', workspacePath: '' }),
  })
  return { fileSync, queryClient, service, store }
}

async function withCustomServer(
  workspaceEditDriver: WorkspaceEditFileSystemDriver,
  run: (server: TestServer) => Promise<void>,
): Promise<void> {
  const server = await makeTestServer({ workspaceEditDriver })
  const previous = getClient()
  setClient(createInProcessClient(server))
  try {
    await run(server)
  } finally {
    setClient(previous)
    await server.cleanup()
  }
}

function failingSecondWriteDriver(): WorkspaceEditFileSystemDriver {
  let shouldFail = true
  return {
    ...nodeWorkspaceEditFileSystemDriver,
    async rename(from, to) {
      if (!shouldFail || path.basename(to) !== 'second.ts') {
        return nodeWorkspaceEditFileSystemDriver.rename(from, to)
      }
      shouldFail = false
      const missingDestination = path.join(path.dirname(to), '.missing', path.basename(to))
      return nodeWorkspaceEditFileSystemDriver.rename(from, missingDestination)
    },
  }
}

type PartialWriteFailure = {
  failCompensation: boolean
  failSecondForward: boolean
  firstRenameCount: number
}

function partialWriteDriver(failure: PartialWriteFailure): WorkspaceEditFileSystemDriver {
  return {
    ...nodeWorkspaceEditFileSystemDriver,
    async rename(from, to) {
      const basename = path.basename(to)
      if (basename === 'second.ts' && failure.failSecondForward) {
        failure.failSecondForward = false
        return renameIntoMissingDirectory(from, to)
      }
      if (basename !== 'first.ts') return nodeWorkspaceEditFileSystemDriver.rename(from, to)
      failure.firstRenameCount += 1
      if (failure.firstRenameCount <= 1 || !failure.failCompensation) {
        return nodeWorkspaceEditFileSystemDriver.rename(from, to)
      }
      return renameIntoMissingDirectory(from, to)
    },
  }
}

function partialRenameWriteDriver(): WorkspaceEditFileSystemDriver {
  let failSecondForward = true
  let failCompensation = true
  return {
    ...nodeWorkspaceEditFileSystemDriver,
    async rename(from, to) {
      const basename = path.basename(to)
      if (basename === 'second.ts' && failSecondForward) {
        failSecondForward = false
        return renameIntoMissingDirectory(from, to)
      }
      if (basename === 'first.ts' && failCompensation) {
        failCompensation = false
        return renameIntoMissingDirectory(from, to)
      }
      return nodeWorkspaceEditFileSystemDriver.rename(from, to)
    },
  }
}

function renameIntoMissingDirectory(from: string, to: string): Promise<void> {
  const missingDestination = path.join(path.dirname(to), '.missing', path.basename(to))
  return nodeWorkspaceEditFileSystemDriver.rename(from, missingDestination)
}

function pausingCommitDriver(
  entered: Deferred<void>,
  release: Deferred<void>,
): WorkspaceEditFileSystemDriver {
  let shouldPause = true
  return {
    ...nodeWorkspaceEditFileSystemDriver,
    async writeFile(target, data, options) {
      const basename = path.basename(target)
      const isTargetWrite = basename.startsWith('.lease.ts.') && basename.endsWith('.tmp')
      if (!shouldPause || !isTargetWrite) {
        return nodeWorkspaceEditFileSystemDriver.writeFile(target, data, options)
      }
      shouldPause = false
      entered.resolve()
      await release.promise
      return nodeWorkspaceEditFileSystemDriver.writeFile(target, data, options)
    },
  }
}

function pausingPrepareDriver(
  entered: Deferred<void>,
  release: Deferred<void>,
): WorkspaceEditFileSystemDriver {
  let shouldPause = true
  return {
    ...nodeWorkspaceEditFileSystemDriver,
    async writeFile(target, data, options) {
      const isBeforeSnapshot = /^write-\d+-before$/u.test(path.basename(target))
      if (!shouldPause || !isBeforeSnapshot) {
        return nodeWorkspaceEditFileSystemDriver.writeFile(target, data, options)
      }
      shouldPause = false
      entered.resolve()
      await release.promise
      return nodeWorkspaceEditFileSystemDriver.writeFile(target, data, options)
    },
  }
}

type Deferred<T> = {
  readonly promise: Promise<T>
  readonly resolve: (value: T | PromiseLike<T>) => void
}

function deferred<T>(): Deferred<T> {
  let resolve!: Deferred<T>['resolve']
  const promise = new Promise<T>((resolver) => {
    resolve = resolver
  })
  return { promise, resolve }
}

async function openDocument(harness: IntegrationHarness, filePath: string) {
  const file = await fetchFile(filePath, signal())
  return harness.store.getState().ensureLiveEditorDocument(file)
}

function expectPathsAvailable(harness: IntegrationHarness, paths: readonly string[]): void {
  const state = harness.store.getState()
  const requests = paths.map((filePath) =>
    state.prepareWorkspaceDocumentPathReservation(filesystemPath(filePath)),
  )
  const result = state.reserveWorkspaceDocumentPaths(requests, 'integration-probe')
  expect(result.status).toBe('acquired')
  if (result.status !== 'acquired') return
  expect(state.releaseWorkspaceDocumentPaths(result.reservation).status).toBe('released')
}

function request(
  operations: readonly WorkspaceEditOperation[],
  originUri: string,
  documents: readonly WorkspaceTextDocumentProvenance[] = [],
): ApplyWorkspaceEditRequest {
  const plan: ParsedWorkspaceEdit = { annotations: new Map(), operations }
  const currentUris = new Set(documents.map((document) => document.uri))
  return {
    guard: {
      documents,
      isCurrent: (uri) => currentUris.has(uri),
    },
    label: 'Integration workspace edit',
    logicalRevisionScope: createDocumentLogicalRevisionScope(),
    originUri,
    originVersion: documents[0]?.version ?? 0,
    plan,
    serverId: 'integration-server',
    signal: signal(),
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

function createOperation(
  uri: string,
): Extract<WorkspaceEditOperation, { readonly kind: 'create' }> {
  return { ignoreIfExists: false, kind: 'create', overwrite: false, uri }
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

function deleteOperation(
  uri: string,
): Extract<WorkspaceEditOperation, { readonly kind: 'delete' }> {
  return { ignoreIfNotExists: false, kind: 'delete', recursive: false, uri }
}

function currentProvenance(
  document: {
    readonly buffer: { getTextSnapshot(): WorkspaceTextDocumentProvenance['textSnapshot'] }
  },
  uri: string,
  version: number,
): WorkspaceTextDocumentProvenance {
  return { textSnapshot: document.buffer.getTextSnapshot(), uri, version }
}

async function writeWorkspaceFiles(
  root: string,
  files: readonly (readonly [string, string])[],
): Promise<void> {
  for (const [filePath, content] of files) {
    const absolutePath = diskPath(root, filePath)
    await mkdir(path.dirname(absolutePath), { recursive: true })
    await writeFile(absolutePath, content)
  }
}

async function readText(root: string, filePath: string): Promise<string> {
  return readFile(diskPath(root, filePath), 'utf8')
}

async function pathExists(root: string, filePath: string): Promise<boolean> {
  try {
    await lstat(diskPath(root, filePath))
    return true
  } catch (error) {
    if (errorCode(error) === 'ENOENT') return false
    throw error
  }
}

function errorCode(error: unknown): string | null {
  if (!error || typeof error !== 'object' || !('code' in error)) return null
  return typeof error.code === 'string' ? error.code : null
}

function fileUri(filePath: string): string {
  return pathToFileURL(path.posix.join('/', filePath)).href
}

function diskPath(root: string, filePath: string): string {
  return path.join(root, filePath)
}

function signal(): AbortSignal {
  return new AbortController().signal
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
