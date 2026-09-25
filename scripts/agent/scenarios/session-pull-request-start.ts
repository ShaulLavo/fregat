import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Page } from 'playwright'

import {
  committedFixture,
  fixtureGit,
  fixtureGitOutput,
  openFixtureWorkspace,
} from '../fixture-workspace'
import { createFakeForge, createSshRemote } from '../fake-forge'
import { runPaletteCommand, selectors, settleAnimations } from '../selectors'
import { dispatch, readShell } from './chat-verification'
import { isolatedNativeScenario } from './native-provider-verification'
import { createScriptError } from '../../structured-errors'

const REMOTE = 'git@github.com:fregat/fixture.git'
const PULL_REQUEST = {
  number: 7,
  title: 'Seven fix',
  url: 'https://github.com/fregat/fixture/pull/7',
  state: 'OPEN' as const,
  isDraft: false,
  closedAt: null,
  headRefName: 'feature/seven',
  baseRefName: 'main',
  isCrossRepository: false,
}

let forge: Awaited<ReturnType<typeof createFakeForge>> | null = null
let remote: Awaited<ReturnType<typeof createSshRemote>> | null = null

/** A checkout whose GitHub origin leads to a local bare repository holding pull request 7. */
async function pullRequestCheckout() {
  const fixture = await committedFixture('pull-request-start')
  remote = await createSshRemote('fregat/fixture')
  await fixtureGit(fixture.path, ['push', '--quiet', remote.bare, 'HEAD:refs/heads/main'])
  await fixtureGit(fixture.path, ['checkout', '--quiet', '-b', 'seven'])
  await writeFile(join(fixture.path, 'a.txt'), 'seven\n')
  await fixtureGit(fixture.path, ['commit', '--quiet', '-am', 'seven'])
  await fixtureGit(fixture.path, [
    'push',
    '--quiet',
    remote.bare,
    'HEAD:refs/heads/feature/seven',
    'HEAD:refs/pull/7/head',
  ])
  await fixtureGit(fixture.path, ['checkout', '--quiet', '-'])
  await fixtureGit(fixture.path, ['branch', '--quiet', '-D', 'seven'])
  await fixtureGit(fixture.path, ['remote', 'add', 'origin', REMOTE])
  await fixtureGit(fixture.path, ['config', 'core.sshCommand', remote.ssh])
  return fixture
}

async function waitForSession(page: Page, base: string) {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const shell = await readShell(page, base)
    const session = shell.sessions.find((item) => item.title === '#7 Seven fix')
    const worktree = shell.worktrees.find((item) => item.id === session?.worktreeId)
    if (session && worktree?.lifecycle.state === 'ready') return { session, worktree }
    await Bun.sleep(100)
  }
  throw createScriptError('No session started from pull request 7')
}

export const sessionPullRequestStart = isolatedNativeScenario({
  name: 'session-pull-request-start',
  description:
    "Start a session from a GitHub pull request URL through the palette: it opens in its own worktree at the pull request's head, the header links the pull request, and a push lands on the pull request's branch.",
  fixture: new URL('../fixtures/native-checkpoint.mjs', import.meta.url),
  prepareWorktree: pullRequestCheckout,
  async prepareServer() {
    forge = await createFakeForge(null, PULL_REQUEST)
    return { pathPrefix: forge.directory }
  },
  async drive(page, { step, orchestration, projectId, providerInstanceId, worktreePath }) {
    if (!forge || !remote) throw createScriptError('The fake forge was not prepared')
    const bare = remote.bare
    let started: Awaited<ReturnType<typeof waitForSession>> | null = null
    try {
      // The dialog runs the session on the project's model; the fixture provider costs nothing.
      await dispatch(page, orchestration, {
        type: 'project.meta.update',
        projectId,
        defaultModelSelection: { providerInstanceId, model: 'gpt-5.5' },
      })
      await openFixtureWorkspace(page, worktreePath)
      await runPaletteCommand(page, 'Start session from pull request…')
      await selectors
        .dialog(page)
        .getByLabel('Pull request', { exact: true })
        .fill(PULL_REQUEST.url)
      const start = selectors.buttonNamed(page, 'Start from #7')
      await settleAnimations(selectors.dialog(page))
      await step('reference-entered')
      await start.click()
      started = await waitForSession(page, orchestration)
      await page.waitForURL((url) => url.href.includes(started?.session.id ?? '#'), {
        timeout: 20_000,
      })
      const checkout = started.worktree.canonicalPath
      const head = await fixtureGitOutput(bare, ['rev-parse', 'refs/pull/7/head'])
      if ((await fixtureGitOutput(checkout, ['rev-parse', 'HEAD'])) !== head)
        throw createScriptError("The worktree is not at the pull request's head")
      const upstream = await fixtureGitOutput(checkout, ['rev-parse', '--abbrev-ref', '@{u}'])
      if (upstream !== 'origin/feature/seven')
        throw createScriptError(`The worktree tracks ${upstream || 'nothing'}`)
      await selectors.changeRequestLink(page, 7).waitFor({ timeout: 30_000 })
      await step('session-on-pull-request')

      await writeFile(join(checkout, 'a.txt'), 'seven, revised\n')
      await fixtureGit(checkout, ['commit', '--quiet', '-am', 'revise'])
      // Nothing watches .git; a fetch rereads every git view.
      await selectors.buttonNamed(page, 'Fetch').click()
      await selectors.buttonNamed(page, 'Push 1').click({ timeout: 20_000 })
      const local = await fixtureGitOutput(checkout, ['rev-parse', 'HEAD'])
      for (let attempt = 0; attempt < 100; attempt += 1) {
        if ((await fixtureGitOutput(bare, ['rev-parse', 'refs/heads/feature/seven'])) === local)
          break
        await Bun.sleep(100)
      }
      if ((await fixtureGitOutput(bare, ['rev-parse', 'refs/heads/feature/seven'])) !== local)
        throw createScriptError("The push did not reach the pull request's branch")
      await step('pushed-to-pull-request')
    } finally {
      if (started) {
        await dispatch(page, orchestration, {
          type: 'session.delete',
          sessionId: started.session.id,
        })
        await dispatch(page, orchestration, {
          type: 'worktree.release',
          worktreeId: started.worktree.id,
        })
      }
      await forge.release()
      forge = null
      await remote.release()
      remote = null
    }
  },
})
