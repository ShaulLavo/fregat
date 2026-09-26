import { act, waitFor } from '@testing-library/react'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { useLanguageCensus } from '@/features/editor/hooks/use-language-census'
import { workspacePreloadLanguages } from '@/features/editor/state/language-census'
import { createEditorWorkspaceStore } from '@/features/editor/state/workspace-state'
import { languageCensusQueryOptions } from '@/features/editor/utils/language-census-query'
import { EDITOR_SHIKI_PRELOAD_LANGUAGES } from '@/features/editor/utils/shiki-languages'
import { filesystemPath } from '@/lib/documents/utils/identity'
import { openWorkspaceRootPath } from '@/lib/file-server'
import { expect, test } from '../../../../../test/fixtures'
import { watchFilesystem } from '../../../../../test/factories/filesystem-events'
import { createTestQueryClient, renderHookWithProviders } from '../../../../../test/render'

test('the preload getter reads the current cache, workspace root and machine', async ({
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
  const { rerender, unmount } = renderHookWithProviders((owner) => useLanguageCensus(owner), {
    initialProps: { queryClient, workspaceStore },
  })
  const getter = workspacePreloadLanguages
  expect(getter()).toBe(EDITOR_SHIKI_PRELOAD_LANGUAGES)
  act(() =>
    workspaceStore.getState().switchWorkspace({ ...one.entry, name: 'one', type: 'directory' }),
  )
  await waitFor(() => expect(queryClient.getQueryData(first)?.readiness).toBe('ready'))
  expect(getter()).toEqual(['typescript'])

  act(() =>
    queryClient.setQueryData(first, { readiness: 'stale', scanRoot: null, counts: { '.tsx': 20 } }),
  )
  expect(getter()).toEqual(['tsx'])
  act(() => queryClient.setQueryData(first, { readiness: 'failed', scanRoot: null, counts: {} }))
  expect(getter()).toBe(EDITOR_SHIKI_PRELOAD_LANGUAGES)

  const two = await openWorkspaceRootPath(
    filesystemPath('two'),
    new AbortController().signal,
    client,
  )
  act(() =>
    workspaceStore.getState().switchWorkspace({ ...two.entry, name: 'two', type: 'directory' }),
  )
  await waitFor(() => expect(getter()).toEqual(['python']))
  act(() => queryClient.setQueryData(second, { readiness: 'ready', scanRoot: null, counts: {} }))
  expect(getter()).toEqual([])

  const otherMachine = createTestQueryClient()
  otherMachine.setQueryData(second, { readiness: 'ready', scanRoot: null, counts: { '.rs': 30 } })
  rerender({ queryClient: otherMachine, workspaceStore })
  expect(getter()).toEqual(['rust'])
  unmount()
  expect(getter()).toBe(EDITOR_SHIKI_PRELOAD_LANGUAGES)
  queryClient.clear()
  otherMachine.clear()
  await watchOne.stop()
  await watchTwo.stop()
})
