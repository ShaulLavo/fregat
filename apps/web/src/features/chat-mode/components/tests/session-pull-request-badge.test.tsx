import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { worktreeIdSchema, type WorktreePullRequest } from '@workspace/contracts'
import * as v from 'valibot'
import { onTestFinished, vi } from 'vitest'
import { renderRailHarness } from '../../../../../test/factories/rail-harness'
import { createWorktreeLifecycleHarness } from '../../../../../test/factories/worktree-lifecycle'
import { expect, test } from '../../../../../test/fixtures'

type Harness = Awaited<ReturnType<typeof createWorktreeLifecycleHarness>>

function found(
  number: number,
  state: 'open' | 'closed' | 'merged',
  draft = false,
): WorktreePullRequest {
  return {
    status: 'found',
    number,
    title: `Change ${number}`,
    url: `https://github.com/fregat/fixture/pull/${number}`,
    state,
    draft,
    closedAt: null,
  }
}

/** One session in its own worktree, so each row carries its own pull request. */
async function isolatedSession(harness: Harness) {
  const worktreeId = v.parse(worktreeIdSchema, crypto.randomUUID())
  await harness.create({ kind: 'new', worktreeId, baseWorktreeId: harness.worktreeId })
  await harness.worktree(worktreeId)
  return worktreeId
}

function rowOf(worktreeId: string) {
  const chip = document.querySelector(`[data-worktree-id="${worktreeId}"]`)
  const row = chip?.closest<HTMLElement>('[role="option"]')
  if (!row) throw new TypeError(`No rail row for worktree ${worktreeId}`)
  return row
}

function badgeOf(worktreeId: string) {
  return rowOf(worktreeId).querySelector<HTMLElement>('[data-pull-request-state]')
}

test('open, draft, merged and closed pull requests each show their own badge', async ({
  client,
  server,
}) => {
  const harness = await createWorktreeLifecycleHarness(client, server)
  const cases = [
    { pullRequest: found(11, 'open'), state: 'open', label: 'Pull request #11 · Open: Change 11' },
    {
      pullRequest: found(12, 'open', true),
      state: 'draft',
      label: 'Pull request #12 · Draft: Change 12',
    },
    {
      pullRequest: found(13, 'merged'),
      state: 'merged',
      label: 'Pull request #13 · Merged: Change 13',
    },
    {
      pullRequest: found(14, 'closed'),
      state: 'closed',
      label: 'Pull request #14 · Closed: Change 14',
    },
  ] as const
  const worktrees: string[] = []
  for (const item of cases) {
    const worktreeId = await isolatedSession(harness)
    await harness.syncPullRequest(worktreeId, item.pullRequest)
    worktrees.push(worktreeId)
  }
  renderRailHarness(harness)

  for (const [index, item] of cases.entries()) {
    const badge = badgeOf(worktrees[index]!)
    expect(badge).toHaveAttribute('data-pull-request-state', item.state)
    expect(badge).toHaveAttribute('title', item.label)
    expect(badge).toHaveAccessibleName(item.label)
    expect(badge).toHaveTextContent(`#${11 + index}`)
  }

  const opened = vi.spyOn(window, 'open').mockReturnValue(null)
  onTestFinished(() => opened.mockRestore())
  await userEvent.click(within(rowOf(worktrees[1]!)).getByRole('link', { name: /#12/ }))
  expect(opened).toHaveBeenCalledWith(
    'https://github.com/fregat/fixture/pull/12',
    '_blank',
    'noopener,noreferrer',
  )
})

test('a failed lookup shows unknown and no pull request shows nothing', async ({
  client,
  server,
}) => {
  const harness = await createWorktreeLifecycleHarness(client, server)
  const unknown = await isolatedSession(harness)
  const none = await isolatedSession(harness)
  const unsupported = await isolatedSession(harness)
  await harness.syncPullRequest(unknown, { status: 'unknown' })
  await harness.syncPullRequest(none, { status: 'none' })
  await harness.syncPullRequest(unsupported, { status: 'unsupported', support: 'no-forge' })
  renderRailHarness(harness)

  const badge = badgeOf(unknown)
  expect(badge).toHaveAttribute('data-pull-request-state', 'unknown')
  expect(badge).toHaveAccessibleName('Pull request unknown. The last lookup failed.')
  expect(badge).not.toHaveRole('link')
  expect(badgeOf(none)).toBeNull()
  expect(badgeOf(unsupported)).toBeNull()
  expect(screen.queryByText(/no pull request/i)).toBeNull()

  // A later answer replaces unknown on the same row.
  await harness.syncPullRequest(unknown, found(21, 'open'))
  await waitFor(() => expect(badgeOf(unknown)).toHaveAttribute('data-pull-request-state', 'open'))
})
