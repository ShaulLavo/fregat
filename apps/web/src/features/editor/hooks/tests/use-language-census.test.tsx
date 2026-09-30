import { act, waitFor } from '@testing-library/react'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { useLanguageCensus } from '@/features/editor/hooks/use-language-census'
import {
  bindLanguageCensus,
  workspacePreloadLanguages,
  workspaceWarmLanguages,
} from '@/features/editor/state/language-census'
import { createEditorWorkspaceStore } from '@/features/editor/state/workspace-state'
import { languageCensusQueryOptions } from '@/features/editor/utils/language-census-query'
import { filesystemPath } from '@/lib/documents/utils/identity'
import { openWorkspaceRootPath } from '@/lib/file-server'
import { expect, test } from '../../../../../test/fixtures'
import { watchFilesystem } from '../../../../../test/factories/filesystem-events'
import { createTestQueryClient, renderHookWithProviders } from '../../../../../test/render'

test('the hook loads the census the preload getter reads for the bound root and machine', async ({
  client,
  server,
}) => {
  const queryClient = createTestQueryClient()
  const workspaceStore = createEditorWorkspaceStore()
  const first = languageCensusQueryOptions('one').queryKey
  const second = languageCensusQueryOptions('two').queryKey
  await mkdir(path.join(server.root, 'one'))
  await mkdir(path.join(server.root, 'two'))
  await writeFile(path.join(server.root, 'one', 'main.ts'), 'export const value = 1')
  await writeFile(path.join(server.root, 'two', 'main.py'), 'value = 1')
  const watchOne = watchFilesystem(client, 'one', [])
  const watchTwo = watchFilesystem(client, 'two', [])
  await waitFor(() => expect(watchOne.events.length).toBeGreaterThan(0))
  await waitFor(() => expect(watchTwo.events.length).toBeGreaterThan(0))
  const one = await openWorkspaceRootPath(
    filesystemPath('one'),
    new AbortController().signal,
    client,
  )
  const { unmount } = renderHookWithProviders((owner) => useLanguageCensus(owner), {
    initialProps: { queryClient, workspaceStore },
  })
  // The editor runtime binds its source on resume; this test stands in for it.
  const root = () => workspaceStore.getState().rootFolder?.path ?? null
  let unbind = bindLanguageCensus({ queryClient, root })
  const getter = workspacePreloadLanguages
  expect(getter()).toBeNull()
  expect(workspaceWarmLanguages()).toEqual([])
  act(() =>
    workspaceStore.getState().switchWorkspace({ ...one.entry, name: 'one', type: 'directory' }),
  )
  await waitFor(() => expect(queryClient.getQueryData(first)?.readiness).toBe('ready'))
  expect(getter()).toEqual(['typescript'])
  expect(workspaceWarmLanguages()).toEqual(['typescript'])

  act(() =>
    queryClient.setQueryData(first, { readiness: 'stale', scanRoot: null, counts: { '.tsx': 20 } }),
  )
  expect(getter()).toEqual(['tsx'])
  expect(workspaceWarmLanguages()).toEqual(['tsx'])
  act(() => queryClient.setQueryData(first, { readiness: 'failed', scanRoot: null, counts: {} }))
  expect(getter()).toBeNull()
  expect(workspaceWarmLanguages()).toEqual([])

  const two = await openWorkspaceRootPath(
    filesystemPath('two'),
    new AbortController().signal,
    client,
  )
  act(() =>
    workspaceStore.getState().switchWorkspace({ ...two.entry, name: 'two', type: 'directory' }),
  )
  await waitFor(() => expect(getter()).toEqual(['python']))
  expect(workspaceWarmLanguages()).toEqual(['python'])
  act(() => queryClient.setQueryData(second, { readiness: 'ready', scanRoot: null, counts: {} }))
  expect(getter()).toEqual([])

  const otherMachine = createTestQueryClient()
  otherMachine.setQueryData(second, { readiness: 'ready', scanRoot: null, counts: { '.rs': 30 } })
  unbind()
  unbind = bindLanguageCensus({ queryClient: otherMachine, root })
  expect(getter()).toEqual(['rust'])
  unbind()
  unmount()
  expect(getter()).toBeNull()
  queryClient.clear()
  otherMachine.clear()
  await watchOne.stop()
  await watchTwo.stop()
})
