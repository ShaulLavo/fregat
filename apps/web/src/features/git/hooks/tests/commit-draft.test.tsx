import { filesystemPath } from '@/lib/documents/utils/identity'
import { onlineManager } from '@tanstack/react-query'
import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import { onTestFinished } from 'vitest'

import { queryClientFor } from '@/lib/environments/state/query-clients'
import { createGitCommitHarness } from '../../../../../test/factories/git-commit'
import { expect, test } from '../../../../../test/fixtures'
import { runGit } from '../../../../../test/factories/git'

const cases = [
  { id: 0, name: 'active checkout', switchAway: false, newerDraft: false },
  { id: 1, name: 'inactive checkout', switchAway: true, newerDraft: false },
  { id: 2, name: 'inactive checkout with a newer draft', switchAway: true, newerDraft: true },
  { id: 3, name: 'active checkout with a newer draft', switchAway: false, newerDraft: true },
] as const

test.for(cases)(
  'a successful commit settles its captured draft: $name',
  async (scenario, { server }) => {
    const h = await createGitCommitHarness(server, scenario.id)
    act(() => h.ownerA.getState().setCommitMessage('Commit owned by A'))
    const queryA = queryClientFor(h.originA)
    const wasOnline = onlineManager.isOnline()
    onTestFinished(() => onlineManager.setOnline(wasOnline))
    act(() => onlineManager.setOnline(false))
    fireEvent.click(screen.getByRole('button', { name: 'Commit' }))
    await waitFor(() => expect(queryA.isMutating()).toBe(1))
    const mutation = queryA.getMutationCache().getAll().at(-1)
    await waitFor(() => expect(mutation?.state.isPaused).toBe(true))
    if (scenario.switchAway) {
      act(() => h.application.activateEnvironment(h.originB))
      await waitFor(() => expect(screen.getByTestId('active-origin')).toHaveTextContent(h.originB))
      act(() =>
        h.application
          .getSnapshot()
          .editor.gitStoreForRoot(filesystemPath('repo'))
          .getState()
          .setCommitMessage('B draft'),
      )
    }
    if (scenario.newerDraft) act(() => h.ownerA.getState().setCommitMessage('Next A commit'))
    act(() => onlineManager.setOnline(true))
    await waitFor(() => expect(mutation?.state.status).toBe('success'))
    expect(runGit(h.cwd, ['log', '-1', '--format=%s'], { cwdMode: 'option' }).stdout.trim()).toBe(
      'Commit owned by A',
    )
    if (scenario.switchAway)
      expect(
        h.application.getSnapshot().editor.gitStoreForRoot(filesystemPath('repo')).getState()
          .commitMessage,
      ).toBe('B draft')
    act(() => h.application.activateEnvironment(h.originA))
    expect(h.application.getSnapshot().editor.gitStoreForRoot(filesystemPath('repo'))).toBe(
      h.ownerA,
    )
    expect(h.ownerA.getState().commitMessage).toBe(scenario.newerDraft ? 'Next A commit' : '')
  },
)
