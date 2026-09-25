import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { BranchActions } from '@/features/git/components/branch-actions'
import { expect, test } from '../../../../../test/fixtures'
import { renderWithProviders } from '../../../../../test/render'
import { runGit } from '../../../../../test/factories/git'

// Real git and the real route. `gh` is whatever the machine has, which is the
// point of the second test: these fixtures have no GitHub remote, so the
// component has to reach the same conclusion as a user whose `gh` cannot answer.

test('offers to publish a branch that has no upstream, and pushes it', async ({
  client,
  server,
}) => {
  void client
  const { origin, repo } = await clonedRepo(server.root)
  runGit(repo, ['checkout', '-b', 'feature/login'], { cwdMode: 'option' })

  renderWithProviders(<BranchActions pullRequestTitle='Add login' rootPath='repo' />)

  // Nothing is ahead, and publishing is still the thing to offer: a plain push
  // fails on a branch with no upstream, which is every branch a session makes.
  await userEvent.click(await screen.findByRole('button', { name: 'Publish' }))

  await waitFor(
    () => {
      expect(
        runGit(origin, ['branch', '--format', '%(refname:short)'], { cwdMode: 'option' }).stdout,
      ).toContain('feature/login')
    },
    { timeout: 10_000 },
  )
})

test('never offers a pull request when GitHub could not be asked', async ({ client, server }) => {
  void client
  const { repo } = await clonedRepo(server.root)
  await writeFile(path.join(repo, 'readme.md'), 'two\n')
  runGit(repo, ['commit', '-am', 'edit'], { cwdMode: 'option' })

  renderWithProviders(<BranchActions pullRequestTitle='Add login' rootPath='repo' />)

  // The push button proves the state actually arrived, so the missing Create
  // button below is a decision rather than a component still loading.
  expect(await screen.findByRole('button', { name: 'Push 1' })).toBeVisible()
  expect(screen.queryByRole('button', { name: 'Pull request' })).toBeNull()
})

async function clonedRepo(root: string) {
  const origin = path.join(root, 'origin.git')
  await mkdir(origin, { recursive: true })
  runGit(origin, ['init', '--bare', '-b', 'main'], { cwdMode: 'option' })

  const repo = path.join(root, 'repo')
  await mkdir(repo, { recursive: true })
  runGit(repo, ['init', '-b', 'main'], { cwdMode: 'option' })
  await writeFile(path.join(repo, 'readme.md'), 'one\n')
  runGit(repo, ['add', 'readme.md'], { cwdMode: 'option' })
  runGit(repo, ['commit', '-m', 'init'], { cwdMode: 'option' })
  runGit(repo, ['remote', 'add', 'origin', origin], { cwdMode: 'option' })
  runGit(repo, ['push', '-u', 'origin', 'main'], { cwdMode: 'option' })

  return { origin, repo }
}
