import { readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { createEditorBufferSession } from '@singapore-editor/core/document'
import { Toaster } from '@workspace/ui/components/sonner'

import {
  fileDocument,
  fileDocumentKey,
  fileResource,
  filesystemPath,
} from '@/lib/documents/utils/identity'
import { fetchFile } from '@/lib/file-server'
import { setFileSnapshotQueryData } from '@/lib/file-snapshot-query-cache'
import { fileSystemKeys } from '@/lib/query-keys'
import {
  markDeletedFilesystemDocument,
  notifyChangedFilesystemConflict,
  notifyRenamedFilesystemConflict,
  dismissFilesystemConflicts,
} from '@/features/workspace/state/event-conflict-adapter'
import { workspaceMutationKeys } from '@/features/workspace/utils/mutation-keys'
import { expect, test } from '../../../../test/fixtures'
import { createConflictCompletionFixture } from '../../../../test/factories/conflict-completion'

for (const change of [
  'none',
  'conflict',
  'destination',
  'resolution',
  'replacement',
  'root-cleanup',
  'stale-disk',
] as const) {
  test(`toast overwrite completion preserves ${change === 'none' ? 'normal resolution' : `a newer ${change}`}`, async ({
    server,
    client,
  }) => {
    const {
      commands,
      editor: { documentStore, conflictStore },
      path,
      remote,
      queryClient,
      documents,
      destination,
      context,
      entered,
      released,
      holdRefetch,
    } = await createConflictCompletionFixture(server)
    try {
      conflictStore.getState().clearConflicts()
      createEditorBufferSession(destination.buffer).applyText('local ')
      const localText = destination.buffer.materializeFullText()
      render(<Toaster />)
      act(() => notifyChangedFilesystemConflict(path, remote, context))
      fireEvent.click(await screen.findByRole('button', { name: 'Compare' }))
      const conflict = Object.values(conflictStore.getState().conflicts)[0]!
      const resolution = documentStore.getState().getLiveEditorDocument(conflict.diffDocumentKey!)!
      holdRefetch()
      if (change === 'stale-disk')
        await writeFile(join(server.root, path), 'newer disk before write')
      fireEvent.click(screen.getByRole('button', { name: 'Keep my changes' }))
      if (change === 'stale-disk') {
        await waitFor(() =>
          expect(
            queryClient.getMutationCache().find({
              mutationKey: workspaceMutationKeys.resolveConflict(conflict.id),
            })?.state.status,
          ).toBe('error'),
        )
        expect(await readFile(join(server.root, path), 'utf8')).toBe('newer disk before write')
        expect(documents.getLiveEditorDocument(fileDocumentKey(path))?.buffer).toBe(
          destination.buffer,
        )
        expect(destination.buffer.materializeFullText()).toBe(localText)
        expect(conflictStore.getState().conflicts[conflict.id]).toBe(conflict)
        expect(documents.getLiveEditorDocument(conflict.diffDocumentKey!)).toBe(resolution)
        return
      }
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
      if (change === 'resolution') {
        act(() => createEditorBufferSession(resolution.buffer).applyText('newer resolution '))
      }
      if (change === 'replacement') {
        act(() => commands.discardLiveEditorDocument(fileDocument(fileResource(path))))
        const reopened = documents.ensureLiveEditorDocument(remote)
        act(() => createEditorBufferSession(reopened.buffer).applyText('reopened '))
      }
      if (change === 'root-cleanup') act(() => dismissFilesystemConflicts(conflictStore))
      const currentConflict = conflictStore.getState().conflicts[conflict.id]
      const currentResolution = documents.getLiveEditorDocument(conflict.diffDocumentKey!)!
      const currentDestination = documents.getLiveEditorDocument(fileDocumentKey(path))!
      const currentText = currentDestination.buffer.materializeFullText()
      const destinationSnapshot = currentDestination.buffer.getSnapshot()
      const destinationRevision = currentDestination.buffer.getRevision()
      const resolutionSnapshot = resolution.buffer.getSnapshot()
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
        expect(documents.getLiveEditorDocument(conflict.diffDocumentKey!)).toBeNull()
        expect(queryClient.getQueryData(fileSystemKeys.fileSnapshot(path))).toMatchObject({
          content: localText,
        })
        await waitFor(() => expect(screen.queryByRole('button', { name: 'Compare' })).toBeNull())
        return
      }
      expect(
        documents.getLiveEditorDocument(fileDocumentKey(path))?.buffer.materializeFullText(),
      ).toBe(currentText)
      expect(documents.getLiveEditorDocument(fileDocumentKey(path))).toBe(currentDestination)
      expect(conflictStore.getState().conflicts[conflict.id]).toBe(currentConflict)
      if (change === 'root-cleanup') {
        await waitFor(() => expect(screen.queryByRole('button', { name: 'Compare' })).toBeNull())
      }
      if (change !== 'root-cleanup')
        expect(screen.getByRole('button', { name: 'Compare' })).toBeVisible()
      expect(documentStore.getState().getLiveEditorDocument(conflict.diffDocumentKey!)).toBe(
        currentResolution,
      )
      expect(currentResolution.buffer).toBe(resolution.buffer)
      expect(resolution.buffer.getSnapshot()).toBe(resolutionSnapshot)
      expect(currentDestination.buffer.getSnapshot()).toBe(destinationSnapshot)
      expect(currentDestination.buffer.getRevision()).toBe(destinationRevision)
      expect(currentDestination.buffer.isDirty()).toBe(true)
      expect(queryClient.getQueryState(fileSystemKeys.fileSnapshot(path))?.isInvalidated).toBe(true)
      expect(await readFile(join(server.root, path), 'utf8')).toBe(
        change === 'conflict' ? 'new incoming revision' : localText,
      )
      act(() => createEditorBufferSession(currentDestination.buffer).undo())
      expect(currentDestination.buffer.materializeFullText()).not.toBe(currentText)
    } finally {
      released.resolve()
    }
  })
}

for (const event of ['changed', 'deleted'] as const) {
  test(`keeping my changes after a ${event} event saves the buffer as it is when clicked`, async ({
    server,
  }) => {
    const {
      editor: { conflictStore },
      path,
      remote,
      queryClient,
      documents,
      destination,
      context,
    } = await createConflictCompletionFixture(server)
    createEditorBufferSession(destination.buffer).applyText('before toast ')
    if (event === 'deleted') await rm(join(server.root, path))
    render(<Toaster />)
    act(() => notifyChangedFilesystemConflict(path, remote, context))
    if (event === 'deleted') act(() => markDeletedFilesystemDocument(path, context))
    const conflict = Object.values(conflictStore.getState().conflicts)[0]!
    act(() => createEditorBufferSession(destination.buffer).applyText('after toast '))
    const clickedText = destination.buffer.materializeFullText()
    fireEvent.click(await screen.findByRole('button', { name: 'Keep my changes' }))
    await waitFor(() =>
      expect(
        queryClient.getMutationCache().find({
          mutationKey: workspaceMutationKeys.resolveConflict(conflict.id),
        })?.state.status,
      ).toBe('success'),
    )
    expect(await readFile(join(server.root, path), 'utf8')).toBe(clickedText)
    const kept = documents.getLiveEditorDocument(fileDocumentKey(path))!
    expect(kept.buffer.materializeFullText()).toBe(clickedText)
    expect(kept.buffer.isDirty()).toBe(false)
    expect(conflictStore.getState().conflicts).toEqual({})
  })
}

test('keeping my changes after the buffer closed leaves the disk file alone', async ({
  server,
}) => {
  const {
    commands,
    editor: { conflictStore },
    path,
    remote,
    queryClient,
    destination,
    context,
  } = await createConflictCompletionFixture(server)
  createEditorBufferSession(destination.buffer).applyText('local ')
  render(<Toaster />)
  act(() => notifyChangedFilesystemConflict(path, remote, context))
  const conflict = Object.values(conflictStore.getState().conflicts)[0]!
  act(() => commands.discardLiveEditorDocument(fileDocument(fileResource(path))))
  fireEvent.click(await screen.findByRole('button', { name: 'Keep my changes' }))
  await waitFor(() =>
    expect(
      queryClient.getMutationCache().find({
        mutationKey: workspaceMutationKeys.resolveConflict(conflict.id),
      })?.state.status,
    ).toBe('error'),
  )
  expect(await readFile(join(server.root, path), 'utf8')).toBe('remote text')
  expect(conflictStore.getState().conflicts[conflict.id]).toBe(conflict)
})

test('toast completion adopts a normal renamed resolution', async ({ server }) => {
  const {
    editor: { conflictStore },
    path,
    queryClient,
    documents,
    destination,
    context,
    entered,
    released,
    holdRefetch,
  } = await createConflictCompletionFixture(server)
  const renamedPath = filesystemPath('renamed-conflict.txt')
  try {
    createEditorBufferSession(destination.buffer).applyText('local ')
    const localText = destination.buffer.materializeFullText()
    await rename(join(server.root, path), join(server.root, renamedPath))
    render(<Toaster />)
    await act(() => notifyRenamedFilesystemConflict(path, renamedPath, context))
    fireEvent.click(await screen.findByRole('button', { name: 'Compare' }))
    const conflict = Object.values(conflictStore.getState().conflicts)[0]!
    holdRefetch()
    fireEvent.click(screen.getByRole('button', { name: 'Keep my changes' }))
    await entered.promise
    expect(await readFile(join(server.root, renamedPath), 'utf8')).toBe(localText)
    released.resolve()
    await waitFor(() =>
      expect(
        queryClient.getMutationCache().find({
          mutationKey: workspaceMutationKeys.resolveConflict(conflict.id),
        })?.state.status,
      ).toBe('success'),
    )
    expect(conflictStore.getState().conflicts).toEqual({})
    expect(documents.getLiveEditorDocument(fileDocumentKey(path))).toBeNull()
    expect(
      documents.getLiveEditorDocument(fileDocumentKey(renamedPath))?.buffer.materializeFullText(),
    ).toBe(localText)
    expect(documents.getLiveEditorDocument(fileDocumentKey(renamedPath))?.buffer.isDirty()).toBe(
      false,
    )
    expect(documents.getLiveEditorDocument(conflict.diffDocumentKey!)).toBeNull()
    expect(queryClient.getQueryData(fileSystemKeys.fileSnapshot(path))).toBeUndefined()
    expect(queryClient.getQueryData(fileSystemKeys.fileSnapshot(renamedPath))).toMatchObject({
      content: localText,
    })
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Compare' })).toBeNull())
  } finally {
    released.resolve()
  }
})

for (const change of [
  'query-destination',
  'adoption-resolution',
  'cleanup-conflict',
  'adoption-conflict',
  'undo-destination',
  'failed-refetch',
] as const) {
  test(`toast completion preserves ${change}`, async ({ server, client }) => {
    const {
      editor: { documentStore, conflictStore },
      path,
      remote,
      queryClient,
      documents,
      destination,
      context,
      entered,
      released,
      holdRefetch,
    } = await createConflictCompletionFixture(server)
    let stop = () => {}
    try {
      createEditorBufferSession(destination.buffer).applyText('local ')
      const localText = destination.buffer.materializeFullText()
      render(<Toaster />)
      act(() => notifyChangedFilesystemConflict(path, remote, context))
      fireEvent.click(await screen.findByRole('button', { name: 'Compare' }))
      const conflict = Object.values(conflictStore.getState().conflicts)[0]!
      const resolution = documents.getLiveEditorDocument(conflict.diffDocumentKey!)!
      holdRefetch()
      fireEvent.click(screen.getByRole('button', { name: 'Keep my changes' }))
      await entered.promise
      expect(await readFile(join(server.root, path), 'utf8')).toBe(localText)
      if (change === 'failed-refetch') {
        await rm(join(server.root, path))
        released.resolve()
        await waitFor(() =>
          expect(
            queryClient.getMutationCache().find({
              mutationKey: workspaceMutationKeys.resolveConflict(conflict.id),
            })?.state.status,
          ).toBe('error'),
        )
        expect(documents.getLiveEditorDocument(fileDocumentKey(path))?.buffer).toBe(
          destination.buffer,
        )
        expect(destination.buffer.materializeFullText()).toBe(localText)
        expect(documents.getLiveEditorDocument(conflict.diffDocumentKey!)).toBe(resolution)
        expect(conflictStore.getState().conflicts[conflict.id]).toBe(conflict)
        expect(screen.getByRole('button', { name: 'Compare' })).toBeVisible()
        return
      }
      let fired = false
      let newerConflict = conflict
      let newerText = localText
      const incoming = await fetchFile(path, new AbortController().signal, client)
      if (change === 'undo-destination') {
        const session = createEditorBufferSession(destination.buffer)
        act(() => {
          session.breakTypingRun()
          session.applyText('transient ')
          session.undo()
        })
        expect(destination.buffer.materializeFullText()).toBe(localText)
      }
      if (change === 'query-destination') {
        stop = queryClient.getQueryCache().subscribe((event) => {
          if (fired || event.type !== 'updated' || event.action.type !== 'success') return
          if (!event.action.manual || event.query.queryKey[2] !== path) return
          fired = true
          const session = createEditorBufferSession(destination.buffer)
          session.breakTypingRun()
          session.applyText('listener edit ')
          newerText = destination.buffer.materializeFullText()
        })
      }
      if (
        change === 'adoption-conflict' ||
        change === 'adoption-resolution' ||
        change === 'cleanup-conflict'
      ) {
        stop = documentStore.subscribe(() => {
          if (fired) return
          if (
            change === 'cleanup-conflict' &&
            documents.getLiveEditorDocument(conflict.diffDocumentKey!)
          )
            return
          if (
            change !== 'cleanup-conflict' &&
            documents.getLiveEditorDocument(fileDocumentKey(path))?.buffer.isDirty()
          )
            return
          fired = true
          if (change === 'adoption-resolution') {
            createEditorBufferSession(resolution.buffer).applyText('listener resolution ')
            newerText = resolution.buffer.materializeFullText()
            return
          }
          notifyChangedFilesystemConflict(path, incoming, context)
          newerConflict = conflictStore.getState().conflicts[conflict.id]!
        })
      }
      released.resolve()
      await waitFor(() =>
        expect(
          queryClient.getMutationCache().find({
            mutationKey: workspaceMutationKeys.resolveConflict(conflict.id),
          })?.state.status,
        ).toBe('success'),
      )
      expect(await readFile(join(server.root, path), 'utf8')).toBe(localText)
      if (change === 'undo-destination' || change === 'query-destination') {
        expect(fired).toBe(change === 'query-destination')
        expect(documents.getLiveEditorDocument(fileDocumentKey(path))?.buffer).toBe(
          destination.buffer,
        )
        expect(destination.buffer.materializeFullText()).toBe(newerText)
        expect(destination.buffer.isDirty()).toBe(true)
        expect(documents.getLiveEditorDocument(conflict.diffDocumentKey!)).toBe(resolution)
        expect(queryClient.getQueryState(fileSystemKeys.fileSnapshot(path))?.isInvalidated).toBe(
          true,
        )
      }
      if (change === 'query-destination') {
        act(() => createEditorBufferSession(destination.buffer).undo())
        expect(destination.buffer.materializeFullText()).toBe(localText)
      }
      if (change === 'adoption-resolution') {
        expect(fired).toBe(true)
        expect(documents.getLiveEditorDocument(conflict.diffDocumentKey!)?.buffer).toBe(
          resolution.buffer,
        )
        expect(resolution.buffer.materializeFullText()).toBe(newerText)
        expect(resolution.buffer.isDirty()).toBe(true)
        expect(documents.getLiveEditorDocument(conflict.diffDocumentKey!)).not.toBe(resolution)
      }
      if (change === 'adoption-conflict' || change === 'cleanup-conflict') {
        expect(fired).toBe(true)
        expect(newerConflict).not.toBe(conflict)
        expect(newerConflict.toastId).toBe(conflict.toastId)
        expect(newerConflict.remoteFile).toBe(incoming)
        expect(documents.getLiveEditorDocument(conflict.diffDocumentKey!)).toBe(
          change === 'adoption-conflict' ? resolution : null,
        )
      }
      expect(conflictStore.getState().conflicts[conflict.id]).toBe(newerConflict)
      expect(screen.getByRole('button', { name: 'Compare' })).toBeVisible()
    } finally {
      stop()
      released.resolve()
    }
  })
}
