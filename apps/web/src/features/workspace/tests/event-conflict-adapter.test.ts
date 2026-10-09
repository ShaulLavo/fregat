import { vi } from 'vitest'
import { expect, test } from '../../../../test/fixtures'
import { createConflictCompletionFixture } from '../../../../test/factories/conflict-completion'

import { fileDocumentKey } from '@/lib/documents/utils/identity'
import {
  notifyChangedFilesystemConflict,
  markDeletedFilesystemDocument,
} from '@/features/workspace/state/event-conflict-adapter'
import { workspaceMutationKeys } from '@/features/workspace/utils/mutation-keys'

vi.mock('sonner', () => {
  const handlers: Array<() => unknown> = []
  return {
    toast: Object.assign(
      vi.fn((render: () => unknown) => {
        handlers.push(render)
        return handlers.length
      }),
      {
        dismiss: vi.fn(),
        error: vi.fn(),
      },
    ),
    __handlers: handlers,
  }
})

test('a second override click while the first is writing issues one write', async ({ server }) => {
  const sonner = (await import('sonner')) as unknown as { __handlers: Array<() => unknown> }
  const fixture = await createConflictCompletionFixture(server)
  const { context, path, remote, queryClient } = fixture
  const conflictStore = fixture.editor.conflictStore

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

test('deletion marks the buffer without creating a conflict toast', async ({ server }) => {
  const fixture = await createConflictCompletionFixture(server)
  const { context, path } = fixture
  const conflictStore = fixture.editor.conflictStore
  const mark = vi.spyOn(context, 'setFileOrphaned')
  markDeletedFilesystemDocument(path, context)
  expect(mark).toHaveBeenCalledWith(fileDocumentKey(path), true)
  expect(conflictStore.getState().conflicts).toEqual({})
})

test('deletion updates an existing conflict so resolving it can recreate the file', async ({
  server,
}) => {
  const fixture = await createConflictCompletionFixture(server)
  const { context, path, remote } = fixture
  const conflictStore = fixture.editor.conflictStore
  notifyChangedFilesystemConflict(path, remote, context)
  const original = Object.values(conflictStore.getState().conflicts)[0]!
  markDeletedFilesystemDocument(path, context)
  expect(Object.values(conflictStore.getState().conflicts)).toHaveLength(1)
  expect(conflictStore.getState().conflicts[original.id]).toMatchObject({
    id: original.id,
    eventType: 'deleted',
    remoteFile: null,
  })
})
