import { decodedAsText } from '@workspace/contracts'
import { QueryClient } from '@tanstack/react-query'
import { expect, test, vi } from 'vitest'

import { createEditorConflictStore } from '@/features/editor/state/conflict-state'
import { fileDocumentKey, filesystemPath } from '@/lib/documents/utils/identity'
import type { FileResult } from '@/lib/file-system-types'
import {
  notifyChangedFilesystemConflict,
  markDeletedFilesystemDocument,
  type WorkspaceConflictContext,
} from '@/features/workspace/state/event-conflict-adapter'
import { workspaceMutationKeys } from '@/features/workspace/utils/mutation-keys'

vi.mock('sonner', () => {
  const handlers: Array<() => unknown> = []
  return {
    toast: Object.assign(vi.fn(), {
      custom: vi.fn((render: () => unknown) => {
        handlers.push(render)
        return handlers.length
      }),
      dismiss: vi.fn(),
      error: vi.fn(),
    }),
    __handlers: handlers,
  }
})

test('a second override click while the first is writing issues one write', async () => {
  const sonner = (await import('sonner')) as unknown as { __handlers: Array<() => unknown> }
  const { context, path, remote, conflictStore, queryClient } = createContext()

  notifyChangedFilesystemConflict(path, remote, context)
  const [conflict] = Object.values(conflictStore.getState().conflicts)
  const element = sonner.__handlers[0]?.() as { props: { onOverrideRemote: () => void } }

  element.props.onOverrideRemote()
  element.props.onOverrideRemote()
  await vi.waitFor(() =>
    expect(
      queryClient
        .getMutationCache()
        .findAll({ mutationKey: workspaceMutationKeys.resolveConflict(conflict!.id) })
        .every((mutation) => mutation.state.status === 'success'),
    ).toBe(true),
  )

  expect(
    queryClient
      .getMutationCache()
      .findAll({ mutationKey: workspaceMutationKeys.resolveConflict(conflict!.id) }),
  ).toHaveLength(2)
  expect(context.forceReplaceLiveEditorDocument).toBeDefined()
  expect(conflictStore.getState().conflicts).toEqual({})
})

test('deletion marks the buffer without creating a conflict toast', () => {
  const { context, path, conflictStore } = createContext()
  const mark = vi.spyOn(context, 'setFileOrphaned')
  markDeletedFilesystemDocument(path, context)
  expect(mark).toHaveBeenCalledWith(fileDocumentKey(path), true)
  expect(conflictStore.getState().conflicts).toEqual({})
})

test('deletion updates an existing conflict so resolving it can recreate the file', () => {
  const { context, path, remote, conflictStore } = createContext()
  notifyChangedFilesystemConflict(path, remote, context)
  const original = Object.values(conflictStore.getState().conflicts)[0]!
  markDeletedFilesystemDocument(path, context)
  expect(Object.values(conflictStore.getState().conflicts)).toHaveLength(1)
  expect(conflictStore.getState().conflicts[original.id]).toMatchObject({
    id: original.id,
    eventType: 'deleted',
    remoteText: null,
    remoteVersion: null,
  })
})

function createContext() {
  const conflictStore = createEditorConflictStore()
  const queryClient = new QueryClient()
  const path = filesystemPath('repo/a.ts')
  const remote: FileResult = {
    ...decodedAsText,
    content: 'remote',
    mtimeMs: 1,
    path,
    size: 6,
    version: 'sha256:remote',
  }
  const context: WorkspaceConflictContext = {
    client: {} as WorkspaceConflictContext['client'],
    conflictStore,
    discardLiveEditorDocument: () => ({ wasDirty: false }),
    ensureUnsyncedEditorDocument: () => undefined,
    fetchFile: async () => remote,
    forceReplaceLiveEditorDocument: () => ({ wasDirty: false }),
    getLiveEditorDocument: () => null,
    queryClient,
    renameLiveEditorDocument: () => ({ wasDirty: false }),
    selectContent: () => undefined,
    setFileOrphaned: () => false,
  }

  return { context, path, remote, conflictStore, queryClient }
}
