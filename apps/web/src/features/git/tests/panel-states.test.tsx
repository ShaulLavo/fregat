import { GitChangesPanel } from '@/features/workbench/components/git-changes-panel'
import { filesystemPath } from '@/lib/documents/utils/identity'
import { registerEnvironmentQueryClient } from '@/lib/environments/state/query-clients'
import { activeServerOrigin } from '@/lib/client'
import { createObservedInProcessClient } from '../../../../test/client'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { fireEvent, screen, waitFor } from '@testing-library/react'

import { TestEditorStateProvider as EditorStateProvider } from '../../../../test/factories/editor-state-provider'
import { Panel } from '@/features/git/components/panel'
import { GitStoreProvider } from '@/features/git/providers/store-provider'
import { expect, test } from '../../../../test/fixtures'
import { renderWithProviders, createTestQueryClient } from '../../../../test/render'
import { runGit } from '../../../../test/factories/git'

// The machine-checkable form of "loading and empty are not the same picture".
// Before plan 041 both rendered a <section> with a sentence in it, so nothing
// distinguished a slow panel from one with nothing to show.
test('the git panel loading state is not its empty state', async ({ client, server }) => {
  void client
  const repo = path.join(server.root, 'repo')
  await mkdir(repo, { recursive: true })
  runGit(repo, ['init', '-b', 'main'], { cwdMode: 'option' })

  renderWithProviders(
    <EditorStateProvider>
      <GitStoreProvider rootPath='repo'>
        <Panel rootPath='repo' />
      </GitStoreProvider>
    </EditorStateProvider>,
  )

  // Synchronous: the query is always pending on first render (no seeded cache).
  expect(screen.getByRole('status')).toBeVisible()
  expect(screen.getByRole('status')).toHaveAccessibleName('Loading Git')
  // The regression gate — 'Loading Git' used to be drawn as a sentence.
  expect(screen.queryByText('Loading Git')).toBeNull()

  await waitFor(() => expect(screen.queryByRole('status', { name: 'Loading Git' })).toBeNull())

  // The settled panel must not reuse the loading affordance, and it must
  // actually have rendered - otherwise the assertion above passes on nothing.
  expect(screen.getByRole('status')).toHaveTextContent('Working tree clean')
  // The tool row is the settled panel's own chrome; the identity row lives above it.
  expect(await screen.findByRole('textbox', { name: 'Commit message' })).toBeVisible()
})

test('root switches retain the branch header and changes until the target status settles', async ({
  client,
  server,
}) => {
  void client
  for (const root of ['first', 'second']) {
    const repo = path.join(server.root, root)
    await mkdir(repo)
    runGit(repo, ['init', '-b', root], { cwdMode: 'option' })
    await writeFile(path.join(repo, `${root}.txt`), 'untracked\n')
  }
  const released = Promise.withResolvers<void>()
  const observed = createObservedInProcessClient(server, async (request) => {
    const url = new URL(request.url)
    if (url.pathname === '/git/status' && url.searchParams.get('path') === 'second') {
      await released.promise
    }
  })
  const queryClient = createTestQueryClient()
  registerEnvironmentQueryClient(queryClient, activeServerOrigin(), observed)
  const view = (root: string) => (
    <EditorStateProvider>
      <GitStoreProvider rootPath={root}>
        <GitChangesPanel rootPath={filesystemPath(root)} />
      </GitStoreProvider>
    </EditorStateProvider>
  )
  const rendered = renderWithProviders(view('first'), { queryClient })
  try {
    await screen.findByRole('textbox', { name: 'Commit message' })
    expect(screen.getByText('first', { exact: true })).toBeVisible()
    fireEvent.change(screen.getByRole('textbox', { name: 'Commit message' }), {
      target: { value: 'First root draft' },
    })
    rendered.rerender(view('second'))
    expect(screen.getByRole('textbox', { name: 'Commit message' })).toHaveValue('First root draft')
    expect(screen.getByText('first', { exact: true })).toBeVisible()
    expect(screen.getByRole('status', { name: 'Loading Git' })).toBeVisible()
    expect(screen.queryByText('second', { exact: true })).toBeNull()
    rendered.rerender(view('first'))
    expect(screen.queryByRole('status', { name: 'Loading Git' })).toBeNull()
    expect(screen.getByRole('textbox', { name: 'Commit message' })).toHaveValue('First root draft')
    rendered.rerender(view('second'))
    released.resolve()
    await screen.findByText('second', { exact: true })
    expect(screen.getByText('second', { exact: true })).toBeVisible()
    expect(screen.getByRole('textbox', { name: 'Commit message' })).toHaveValue('')
    expect(screen.queryByText('first', { exact: true })).toBeNull()
    expect(screen.queryByRole('status', { name: 'Loading Git' })).toBeNull()
    rendered.rerender(view('missing'))
    expect(screen.getByText('second', { exact: true })).toBeVisible()
    await screen.findByText('Git is unavailable')
    expect(screen.queryByRole('status', { name: 'Loading Git' })).toBeNull()
  } finally {
    released.resolve()
    rendered.unmount()
  }
})
