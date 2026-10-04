import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { createEditorBufferSession } from '@singapore-editor/core/document'
import { Toaster } from '@workspace/ui/components/sonner'

import { fileDocumentKey, filesystemPath } from '@/lib/documents/utils/identity'
import { fetchFile } from '@/lib/file-server'
import { setFileSnapshotQueryData } from '@/lib/file-snapshot-query-cache'
import {
  notifyChangedFilesystemConflict,
  type WorkspaceConflictContext,
} from '@/features/workspace/state/event-conflict-adapter'
import { workspaceMutationKeys } from '@/features/workspace/utils/mutation-keys'
import { expect, test } from '../../../../test/fixtures'
import { createObservedInProcessClient } from '../../../../test/client'
import { createAddressTestRuntime } from '../../../../test/factories/address-runtime'

for (const change of ['none', 'conflict', 'destination'] as const) {
  test(`toast overwrite completion preserves ${change === 'none' ? 'normal resolution' : `a newer ${change}`}`, async ({
    server,
    client,
  }) => {
    const entered = Promise.withResolvers<void>()
    const released = Promise.withResolvers<void>()
    let holdRead = false
    let held = false
    const transport = createObservedInProcessClient(server, async (request) => {
      if (!holdRead || held || new URL(request.url).pathname !== '/fs/read') return
      held = true
      entered.resolve()
      await released.promise
    })
    const path = filesystemPath('toast-conflict.txt')
    await writeFile(join(server.root, path), 'remote text')
    const remote = await fetchFile(path, new AbortController().signal, transport)
    const { application, commands, editor } = await createAddressTestRuntime(transport)
    const { documentStore, conflictStore } = editor
    const queryClient = application.getSnapshot().queryClient
    const documents = documentStore.getState()
    const destination = documents.ensureLiveEditorDocument(remote)
    setFileSnapshotQueryData(queryClient, remote)
    const context: WorkspaceConflictContext = {
      client: transport,
      conflictStore,
      queryClient,
      discardLiveEditorDocument: commands.discardLiveEditorDocument,
      ensureUnsyncedEditorDocument: documents.ensureUnsyncedEditorDocument,
      fetchFile: (target, signal) => fetchFile(target, signal, transport),
      forceReplaceLiveEditorDocument: documents.forceReplaceLiveEditorDocument,
      getLiveEditorDocument: documents.getLiveEditorDocument,
      renameLiveEditorDocument: commands.renameLiveEditorDocument,
      selectContent: commands.selectContent,
      setFileOrphaned: documents.setFileOrphaned,
    }
    try {
      conflictStore.getState().clearConflicts()
      createEditorBufferSession(destination.buffer).applyText('local ')
      const localText = destination.buffer.materializeFullText()
      render(<Toaster />)
      act(() => notifyChangedFilesystemConflict(path, remote, context))
      fireEvent.click(await screen.findByRole('button', { name: 'Compare' }))
      const conflict = Object.values(conflictStore.getState().conflicts)[0]!
      const resolution = documentStore.getState().getLiveEditorDocument(conflict.diffDocumentKey!)!
      const resolutionSnapshot = resolution.buffer.getSnapshot()
      holdRead = true
      fireEvent.click(screen.getByRole('button', { name: 'Keep my changes' }))
      await entered.promise
      expect(await readFile(join(server.root, path), 'utf8')).toBe(localText)

      if (change === 'destination') {
        act(() => createEditorBufferSession(destination.buffer).applyText('newer '))
      }
      if (change === 'conflict') {
        await writeFile(join(server.root, path), 'new incoming revision')
        const incoming = await fetchFile(path, new AbortController().signal, client)
        setFileSnapshotQueryData(queryClient, incoming)
        act(() => notifyChangedFilesystemConflict(path, incoming, context))
      }
      const currentConflict = conflictStore.getState().conflicts[conflict.id]
      const currentDestination = documents.getLiveEditorDocument(fileDocumentKey(path))!
      const currentText = currentDestination.buffer.materializeFullText()
      const destinationSnapshot = destination.buffer.getSnapshot()
      const destinationRevision = destination.buffer.getRevision()
      released.resolve()
      await waitFor(() =>
        expect(
          queryClient.getMutationCache().find({
            mutationKey: workspaceMutationKeys.resolveConflict(conflict.id),
          })?.state.status,
        ).toBe('success'),
      )

      if (change === 'none') {
        expect(conflictStore.getState().conflicts).toEqual({})
        expect(
          documents.getLiveEditorDocument(fileDocumentKey(path))?.buffer.materializeFullText(),
        ).toBe(localText)
        expect(documents.getLiveEditorDocument(fileDocumentKey(path))?.buffer.isDirty()).toBe(false)
        await waitFor(() => expect(screen.queryByRole('button', { name: 'Compare' })).toBeNull())
        return
      }
      expect(
        documents.getLiveEditorDocument(fileDocumentKey(path))?.buffer.materializeFullText(),
      ).toBe(currentText)
      expect(documents.getLiveEditorDocument(fileDocumentKey(path))).toBe(currentDestination)
      expect(conflictStore.getState().conflicts[conflict.id]).toBe(currentConflict)
      expect(screen.getByRole('button', { name: 'Compare' })).toBeVisible()
      expect(documentStore.getState().getLiveEditorDocument(conflict.diffDocumentKey!)).toBe(
        resolution,
      )
      expect(resolution.buffer.getSnapshot()).toBe(resolutionSnapshot)
      expect(destination.buffer.getSnapshot()).toBe(destinationSnapshot)
      expect(destination.buffer.getRevision()).toBe(destinationRevision)
      expect(destination.buffer.isDirty()).toBe(true)
      expect(await readFile(join(server.root, path), 'utf8')).toBe(
        change === 'conflict' ? 'new incoming revision' : localText,
      )
    } finally {
      released.resolve()
    }
  })
}
