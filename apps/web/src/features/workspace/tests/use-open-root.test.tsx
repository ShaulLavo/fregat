import { getClient } from '@/lib/client'
import { filesystemPath } from '@/lib/documents/utils/identity'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { symlink } from 'node:fs/promises'
import path from 'node:path'
import { onTestFinished } from 'vitest'
import type { Client } from '@/lib/client'
import {
  useOpenWorkspaceRoot,
  type OpenWorkspaceRootResult,
} from '@/features/workspace/hooks/use-open-root'
import {
  createFileContent,
  ensureFolderPath,
  fetchRecentEntries,
  fetchServerInfo,
} from '@/lib/file-server'
import { expect, test } from '../../../../test/fixtures'
import { renderApplication } from '../../../../test/render'
import { createAddressTestRuntime } from '../../../../test/factories/address-runtime'
import { createObservedInProcessClient } from '../../../../test/client'
import { waitForNavigation } from '../../../../test/address'

test('records an opened root as recent, so the project menu can order by it', async ({
  client,
}) => {
  void client
  await ensureFolderPath(filesystemPath('anubis'), getClient())
  await renderOpeners(client, ['anubis'])

  await userEvent.click(screen.getByRole('button', { name: 'Open anubis' }))

  // Recorded through the real route: the picker is no longer the only way in.
  await waitFor(async () => {
    const recents = await fetchRecentEntries(
      { limit: 10, mode: 'folder', showHidden: true },
      new AbortController().signal,
      getClient(),
    )
    expect(recents.map((entry) => entry.path)).toEqual(['anubis'])
  })
})

test('opening a folder through an alias keeps its canonical root and workspace ID', async ({
  client,
  server,
}) => {
  void client
  await ensureFolderPath(filesystemPath('actual'), getClient())
  await symlink('actual', path.join(server.root, 'alias'))
  const { store, results } = await renderOpeners(client, ['actual', 'alias'])

  await userEvent.click(screen.getByRole('button', { name: 'Open actual' }))
  await waitFor(() => expect(store.getState().rootFolder?.workspaceAddress).toBeDefined())
  const address = store.getState().rootFolder?.workspaceAddress

  await userEvent.click(screen.getByRole('button', { name: 'Open alias' }))
  await waitFor(() => expect(results).toContainEqual({ path: 'alias', result: 'already-open' }))

  expect(store.getState().rootFolder?.path).toBe('actual')
  expect(store.getState().rootFolder?.workspaceAddress).toEqual(address)
})

test('makes the latest rapid valid open the editor and index root', async ({ client, server }) => {
  void client
  await ensureFolderPath(filesystemPath('a'), getClient())
  await ensureFolderPath(filesystemPath('b'), getClient())
  await createFileContent(filesystemPath('a/only-a.ts'), 'export const a = true\n', getClient())
  await createFileContent(filesystemPath('b/only-b.ts'), 'export const b = true\n', getClient())
  const { store, results } = await renderOpeners(client, ['a', 'b'])

  await userEvent.click(screen.getByRole('button', { name: 'Open rapidly' }))

  await waitFor(() => expect(store.getState().rootFolder?.path).toBe('b'))
  await waitFor(() => expect(results).toContainEqual({ path: 'b', result: 'opened' }))
  await waitFor(async () => {
    const info = await fetchServerInfo(new AbortController().signal, getClient())
    expect(info.workspaceIndex?.scanRoot).toBe(path.join(server.root, 'b'))
  })
  expect(results).toContainEqual({ path: 'a', result: 'superseded' })
})

test('does not retarget the index when a newer folder open is rejected', async ({
  client,
  server,
}) => {
  void client
  await ensureFolderPath(filesystemPath('valid'), getClient())
  await createFileContent(filesystemPath('not-a-folder.txt'), 'file\n', getClient())
  const { store, results } = await renderOpeners(client, ['valid', 'not-a-folder.txt'])

  await userEvent.click(screen.getByRole('button', { name: 'Open valid' }))
  await waitFor(() => expect(store.getState().rootFolder?.path).toBe('valid'))
  const baseline = await fetchServerInfo(new AbortController().signal, getClient())

  await userEvent.click(screen.getByRole('button', { name: 'Open not-a-folder.txt' }))
  await waitFor(() =>
    expect(results).toContainEqual({ path: 'not-a-folder.txt', result: 'failed' }),
  )
  const afterRejectedOpen = await fetchServerInfo(new AbortController().signal, getClient())

  expect(store.getState().rootFolder?.path).toBe('valid')
  expect(afterRejectedOpen.workspaceIndex?.scanRoot).toBe(baseline.workspaceIndex?.scanRoot)
  expect(afterRejectedOpen.workspaceIndex?.scanRoot).toBe(path.join(server.root, 'valid'))
})

test('does not start a root open when the workspace mutation gate refuses it', async ({
  client,
  server,
}) => {
  await ensureFolderPath(filesystemPath('blocked'), client)
  const rootRequests: string[] = []
  const observed = createObservedInProcessClient(server, (request) => {
    if (new URL(request.url).pathname === '/fs/workspace-root') rootRequests.push(request.url)
  })
  const { store, editor, results } = await renderOpeners(observed, ['blocked'])
  const released = Promise.withResolvers<void>()
  const mutation = editor.workspaceEditService.runWorkspaceMutation([], () => released.promise)
  try {
    await userEvent.click(screen.getByRole('button', { name: 'Open blocked' }))
    await waitFor(() => expect(results).toContainEqual({ path: 'blocked', result: 'failed' }))
    expect(rootRequests).toEqual([])
    expect(store.getState().rootFolder).toBeNull()
  } finally {
    released.resolve()
    await mutation
  }
})

function OpenRootButtons({
  onResult,
  rootPaths,
}: {
  readonly onResult: (path: string, result: OpenWorkspaceRootResult) => void
  readonly rootPaths: readonly string[]
}) {
  const openWorkspaceRoot = useOpenWorkspaceRoot()

  const open = (rootPath: string) => {
    void openWorkspaceRoot(rootPath).then((result) => onResult(rootPath, result))
  }

  return (
    <>
      {rootPaths.map((rootPath) => (
        <button key={rootPath} type='button' onClick={() => open(rootPath)}>
          Open {rootPath}
        </button>
      ))}
      <button
        type='button'
        onClick={() => {
          for (const rootPath of rootPaths) open(rootPath)
        }}
      >
        Open rapidly
      </button>
    </>
  )
}

async function renderOpeners(client: Client, rootPaths: readonly string[]) {
  const { application, editor } = await createAddressTestRuntime(client)
  const results: Array<{ path: string; result: OpenWorkspaceRootResult }> = []
  const rendered = renderApplication(
    <OpenRootButtons
      onResult={(path, result) => results.push({ path, result })}
      rootPaths={rootPaths}
    />,
    application,
  )
  onTestFinished(() => rendered.unmount())
  await waitForNavigation(rendered.navigation)
  return { ...rendered, store: editor.workspaceStore, editor, results }
}
