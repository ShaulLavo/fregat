import type { Page } from 'playwright'

import { committedFixture } from '../fixture-workspace'
import { createFakeForge } from '../fake-forge'
import { readShell } from './chat-verification'
import { isolatedNativeScenario } from './native-provider-verification'
import { createScriptError } from '../../structured-errors'

// The server's PATH is fixed when it starts, so the forge is made before the drive.
let forge: Awaited<ReturnType<typeof createFakeForge>> | null = null

async function waitForPullRequest(page: Page, base: string, id: string) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const worktree = (await readShell(page, base)).worktrees.find((item) => item.id === id)
    if (worktree?.pullRequest?.status === 'found') return worktree.pullRequest
    await Bun.sleep(100)
  }
  throw createScriptError('The worktree never recorded its pull request')
}

export const sessionPullRequestSync = isolatedNativeScenario({
  name: 'session-pull-request-sync',
  description:
    "A session in its own worktree, a forge that has an open pull request for that worktree's branch: the server finds it without a request from the page and publishes it on the worktree.",
  fixture: new URL('../fixtures/native-checkpoint.mjs', import.meta.url),
  prepareWorktree: () => committedFixture('pull-request-sync'),
  newWorktree: true,
  async prepareServer() {
    forge = await createFakeForge({
      number: 12,
      title: 'Isolated change',
      url: 'https://github.com/fregat/fixture/pull/12',
      state: 'OPEN',
      isDraft: true,
      closedAt: null,
    })
    return { pathPrefix: forge.directory }
  },
  async drive(page, { step, orchestration, worktreeId }) {
    if (!forge) throw createScriptError('The fake forge was not prepared')
    try {
      const pullRequest = await waitForPullRequest(page, orchestration, worktreeId)
      if (pullRequest.status !== 'found' || pullRequest.number !== 12 || !pullRequest.draft)
        throw createScriptError(`Unexpected pull request ${JSON.stringify(pullRequest)}`)
      const graphql = (await forge.calls()).filter((call) => call[1] === 'graphql')
      if (graphql.length === 0) throw createScriptError('The server never asked the forge')
      if (graphql.some((call) => call.some((arg) => arg.startsWith('h1='))))
        throw createScriptError(
          'The shared checkout was looked up alongside the dedicated worktree',
        )
      await step('pull-request-recorded')
    } finally {
      await forge.release()
      forge = null
    }
  },
})
