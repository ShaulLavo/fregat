import { chmod, copyFile, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { createGitFixture, fixtureGit, releaseFixture } from '../fixture-workspace'
import { readShell } from './chat-verification'
import { isolatedNativeScenario } from './native-provider-verification'
import { createScriptError } from '../../structured-errors'

// The server's PATH is fixed when it starts, so the forge directory is made before the drive.
let forgeDirectory: string | null = null

const OPEN = {
  number: 12,
  title: 'Isolated change',
  url: 'https://github.com/fregat/fixture/pull/12',
  state: 'OPEN',
  isDraft: true,
}

async function prepareFixture() {
  const fixture = await createGitFixture('pull-request-sync')
  await fixtureGit(fixture, ['commit', '--quiet', '-m', 'fixture'])
  return { path: fixture, release: () => releaseFixture(fixture) }
}

async function waitForPullRequest(page: Parameters<typeof readShell>[0], base: string, id: string) {
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
  prepareWorktree: prepareFixture,
  newWorktree: true,
  async prepareServer() {
    forgeDirectory = await mkdtemp('/work/tmp/fregat-fake-gh-')
    await copyFile(new URL('../fixtures/fake-gh.mjs', import.meta.url), join(forgeDirectory, 'gh'))
    await chmod(join(forgeDirectory, 'gh'), 0o755)
    await writeFile(join(forgeDirectory, 'forge.json'), JSON.stringify({ branches: { '*': OPEN } }))
    return { pathPrefix: forgeDirectory }
  },
  async drive(page, { step, orchestration, worktreeId }) {
    const directory = forgeDirectory
    if (!directory) throw createScriptError('The fake forge was not prepared')
    try {
      const pullRequest = await waitForPullRequest(page, orchestration, worktreeId)
      if (pullRequest.status !== 'found' || pullRequest.number !== 12 || !pullRequest.draft)
        throw createScriptError(`Unexpected pull request ${JSON.stringify(pullRequest)}`)
      const calls = (await readFile(join(directory, 'calls.jsonl'), 'utf8')).trim().split('\n')
      const graphql = calls.filter((call) => call.includes('"graphql"'))
      if (graphql.length === 0) throw createScriptError('The server never asked the forge')
      if (graphql.some((call) => call.includes('h1=')))
        throw createScriptError(
          'The shared checkout was looked up alongside the dedicated worktree',
        )
      await step('pull-request-recorded')
    } finally {
      await rm(directory, { recursive: true, force: true })
      forgeDirectory = null
    }
  },
})
