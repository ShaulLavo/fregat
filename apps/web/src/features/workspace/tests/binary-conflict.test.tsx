import { confirmedEnvironmentId } from '@/lib/environments/state/domain'
import { originForQueryClient } from '@/lib/environments/state/query-clients'
import { rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { act, fireEvent, waitFor } from '@testing-library/react'
import { createEditorBufferSession } from '@singapore-editor/core/document'
import { Toaster } from '@workspace/ui/components/sonner'
import { expect, test } from '../../../../test/fixtures'
import { createAddressTestRuntime } from '../../../../test/factories/address-runtime'
import { TestEditorStateProvider } from '../../../../test/factories/editor-state-provider'
import { renderWithProviders } from '../../../../test/render'
import {
  fileDocument,
  fileDocumentKey,
  fileResource,
  filesystemPath,
  tabId,
} from '@/lib/documents/utils/identity'
import { documentTab } from '@/lib/documents/utils/tabs'
import { fetchFile } from '@/lib/file-server'
import { setFileSnapshotQueryData } from '@/lib/file-snapshot-query-cache'
import { fileSystemKeys } from '@/lib/query-keys'
import type { FileSnapshot } from '@/lib/file-snapshot'
import { EditorSurfaceTabBody } from '@/features/workbench/components/editor-surface-tab-body'
import { applyWorkspaceEvents } from '@/features/workspace/hooks/use-events'
import { createWideEventScope } from '@/lib/wide-event-scope'
import {
  notifyChangedFilesystemConflict,
  notifyRenamedFilesystemConflict,
} from '@/features/workspace/state/event-conflict-adapter'

for (const event of ['changed', 'renamed'] as const) {
  for (const action of ['Compare', 'Use the disk version'] as const) {
    test(`${action} preserves binary classification after dirty text is ${event} on disk`, async ({
      server,
      client,
    }) => {
      const localPath = filesystemPath('conflict.txt')
      const remotePath = event === 'renamed' ? filesystemPath('renamed.bin') : localPath
      await writeFile(join(server.root, localPath), 'saved text\n')
      const initial = await fetchFile(localPath, new AbortController().signal, client)
      const { application, commands, editor } = await createAddressTestRuntime(client)
      const { conflictStore, documentStore } = editor
      const queryClient = application.getSnapshot().queryClient
      setFileSnapshotQueryData(queryClient, initial)
      await commands.openFileSurface(localPath)
      const view = documentStore.getState().ensureEditorView(tabId('local'), initial)
      createEditorBufferSession(view.buffer, view.view).applyText('unsaved ')
      const local = documentStore.getState().getLiveEditorDocument(fileDocumentKey(localPath))!
      const before = local.buffer.getSnapshot()
      const localText = local.buffer.materializeFullText()
      const analysis = local.analysis
      if (event === 'renamed')
        await rename(join(server.root, localPath), join(server.root, remotePath))
      await writeFile(join(server.root, remotePath), Buffer.from([0, 1, 255, 0, 7]))
      const remote = await fetchFile(remotePath, new AbortController().signal, client)
      expect(remote.seemsBinary).toBe(true)
      setFileSnapshotQueryData(queryClient, remote)
      const state = documentStore.getState()
      const storedView = state.viewsByTabId[tabId('local')]
      expect(storedView?.view).toBe(view.view)
      const context = {
        comparisonScope: {
          environmentId: confirmedEnvironmentId(originForQueryClient(queryClient)),
          rootPath: filesystemPath(''),
        },
        acquireSnapshotComparison: state.acquireSnapshotComparison,
        signal: new AbortController().signal,
        client,
        conflictStore,
        queryClient,
        discardLiveEditorDocument: commands.discardLiveEditorDocument,
        ensureUnsyncedEditorDocument: state.ensureUnsyncedEditorDocument,
        fetchFile: (path: typeof localPath, signal: AbortSignal) => fetchFile(path, signal, client),
        forceReplaceLiveEditorDocument: state.forceReplaceLiveEditorDocument,
        getLiveEditorDocument: state.getLiveEditorDocument,
        renameLiveEditorDocument: commands.renameLiveEditorDocument,
        setFileOrphaned: state.setFileOrphaned,
        selectContent: commands.selectContent,
      }
      const rendered = renderWithProviders(<Toaster />, { application, queryClient })
      await act(async () => {
        if (event === 'renamed')
          await notifyRenamedFilesystemConflict(localPath, remotePath, context)
        if (event === 'changed') notifyChangedFilesystemConflict(localPath, remote, context)
      })
      expect(Object.values(conflictStore.getState().conflicts)[0]).toMatchObject({
        remoteFile: remote,
        remoteText: null,
      })
      fireEvent.click(await rendered.findByRole('button', { name: action }))
      if (action === 'Compare') {
        expect(Object.keys(documentStore.getState().liveDocumentsByKey)).toEqual([
          fileDocumentKey(localPath),
        ])
        expect(local.buffer.getSnapshot()).toBe(before)
        expect(local.buffer.materializeFullText()).toBe(localText)
        expect(local.analysis).toBe(analysis)
        expect(documentStore.getState().viewsByTabId[tabId('local')]).toBe(storedView)
        expect(documentStore.getState().dirtyDocumentKeys.has(fileDocumentKey(localPath))).toBe(
          true,
        )
        expect(Object.values(conflictStore.getState().conflicts)).toHaveLength(1)
      }
      if (action === 'Use the disk version') {
        await waitFor(() => expect(conflictStore.getState().conflicts).toEqual({}))
        expect(documentStore.getState().liveDocumentsByKey).toEqual({})
        expect(documentStore.getState().viewsByTabId).toEqual({})
        expect(documentStore.getState().dirtyDocumentKeys.size).toBe(0)
      }
      expect(
        queryClient.getQueryData<FileSnapshot>(fileSystemKeys.fileSnapshot(remotePath)),
      ).toMatchObject(remote)
      const facts = renderWithProviders(
        <TestEditorStateProvider>
          <EditorSurfaceTabBody
            active
            content={documentTab(fileDocument(fileResource(remotePath)))}
            rootPath={filesystemPath('')}
            tabId={tabId('facts')}
          />
        </TestEditorStateProvider>,
        { application, queryClient },
      )
      await waitFor(() => expect(facts.getByRole('region', { name: 'File facts' })).toBeVisible())
      expect(facts.queryByRole('textbox', { name: 'Editor input' })).toBeNull()
    })
  }
}

test('a clean text document refreshed from binary disk bytes retires its text owner', async ({
  server,
  client,
}) => {
  const path = filesystemPath('clean.txt')
  await writeFile(join(server.root, path), 'saved text\n')
  const initial = await fetchFile(path, new AbortController().signal, client)
  const { application, commands, editor } = await createAddressTestRuntime(client)
  const { conflictStore, documentStore } = editor
  const queryClient = application.getSnapshot().queryClient
  setFileSnapshotQueryData(queryClient, initial)
  await commands.openFileSurface(path)
  documentStore.getState().ensureEditorView(tabId('clean'), initial)
  expect(documentStore.getState().dirtyDocumentKeys.size).toBe(0)
  await writeFile(join(server.root, path), Buffer.from([0, 1, 255, 0, 7]))
  const remote = await fetchFile(path, new AbortController().signal, client)
  expect(remote.seemsBinary).toBe(true)
  const state = documentStore.getState()
  const scope = createWideEventScope({ action: 'test.binary-refresh', area: 'fs' })
  try {
    await act(async () => {
      await applyWorkspaceEvents({
        acquireSnapshotComparison: state.acquireSnapshotComparison,
        conflictStore,
        discardLiveEditorDocument: commands.discardLiveEditorDocument,
        dirtyDocumentKeys: state.dirtyDocumentKeys,
        ensureUnsyncedEditorDocument: state.ensureUnsyncedEditorDocument,
        events: [{ type: 'changed', path, version: remote.version }],
        forceReplaceLiveEditorDocument: state.forceReplaceLiveEditorDocument,
        getLiveEditorDocument: state.getLiveEditorDocument,
        isOwnWorkspaceEditEvent: () => false,
        openFilePaths: [path],
        queryClient,
        renameLiveEditorDocument: commands.renameLiveEditorDocument,
        rootPath: '',
        scheduleGitInvalidation: () => undefined,
        selectContent: commands.selectContent,
        setFileOrphaned: state.setFileOrphaned,
        signal: new AbortController().signal,
        scope,
      })
    })
    expect(conflictStore.getState().conflicts).toEqual({})
    expect(documentStore.getState().liveDocumentsByKey).toEqual({})
    expect(documentStore.getState().viewsByTabId).toEqual({})
    expect(documentStore.getState().dirtyDocumentKeys.size).toBe(0)
    expect(queryClient.getQueryData<FileSnapshot>(fileSystemKeys.fileSnapshot(path))).toMatchObject(
      remote,
    )
    const facts = renderWithProviders(
      <TestEditorStateProvider>
        <EditorSurfaceTabBody
          active
          content={documentTab(fileDocument(fileResource(path)))}
          rootPath={filesystemPath('')}
          tabId={tabId('facts')}
        />
      </TestEditorStateProvider>,
      { application, queryClient },
    )
    await waitFor(() => expect(facts.getByRole('region', { name: 'File facts' })).toBeVisible())
    expect(facts.queryByRole('textbox', { name: 'Editor input' })).toBeNull()
    expect(documentStore.getState().liveDocumentsByKey).toEqual({})
  } finally {
    scope.end()
  }
})
