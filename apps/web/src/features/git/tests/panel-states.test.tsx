import { mkdir } from 'node:fs/promises'
import path from 'node:path'

import { screen, waitFor } from '@testing-library/react'

import { TestEditorStateProvider as EditorStateProvider } from '../../../../test/factories/editor-state-provider'
import { Panel } from '@/features/git/components/panel'
import { GitStoreProvider } from '@/features/git/providers/store-provider'
import { expect, test } from '../../../../test/fixtures'
import { renderWithProviders } from '../../../../test/render'
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
