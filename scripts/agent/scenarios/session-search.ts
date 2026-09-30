import { checkoutRoot } from '../paths'
import { ok } from 'node:assert/strict'
import type { Page } from 'playwright'
import type { Scenario } from './index'
import { selectors } from '../selectors'
import { createGitFixture, fixtureGit, releaseFixture } from '../fixture-workspace'
import { connectSecondOwner, type SecondOwner } from '../second-owner'
import { collectOrchestrationBases, dispatch, readShell, typePrompt } from './chat-verification'
import {
  registerFixtureProject,
  installConversationProvider,
  withConversationProvider,
  type NativeProvider,
} from './native-provider-verification'

type SearchOwner = { readonly base: string; readonly worktreeId: string }

async function platformWorktree(page: Page, base: string) {
  const worktree = (await readShell(page, base)).worktrees.find(
    (item) => item.canonicalPath === checkoutRoot,
  )
  ok(worktree, 'The primary owner needs the Platform worktree')
  return worktree.id
}

async function searchConversation(
  page: Page,
  step: (name: string) => Promise<void>,
  crossOwner: boolean,
) {
  const bases = collectOrchestrationBases(page)
  const connected = page.waitForEvent('websocket', {
    predicate: (socket) => new URL(socket.url()).pathname.endsWith('/orchestration/rpc'),
  })
  await page.goto(page.url().replace(/\/workbench(?:\?.*)?$/, '/chat'))
  const primary = (await connected)
    .url()
    .split('?')[0]!
    .replace(/^ws/, 'http')
    .replace(/\/rpc$/, '')
  await selectors.sessionSearch(page).waitFor()
  const primaryOwner = { base: primary, worktreeId: await platformWorktree(page, primary) }
  if (!crossOwner) return searchOn(page, step, { primary: primaryOwner, searched: primaryOwner })

  // A throwaway second owner, connected as a Remote URL machine, owns the searched session.
  let second: SecondOwner | null = null
  const fixture = await createGitFixture('session-search-environments')
  let remote: SearchOwner | null = null
  let remoteProject: string | null = null
  try {
    await fixtureGit(fixture, ['commit', '--quiet', '--allow-empty', '-m', 'initial'])
    second = await connectSecondOwner(page, bases)
    const base = [...bases].find((item) => item !== primary)
    ok(base, 'The second owner must be represented in the rail')
    const worktree = await registerFixtureProject(page, base, fixture)
    remoteProject = worktree.projectId
    remote = { base, worktreeId: worktree.id }
    await searchOn(page, step, { primary: primaryOwner, searched: remote })
  } finally {
    if (remote && remoteProject)
      await dispatch(page, remote.base, {
        type: 'project.delete',
        projectId: remoteProject,
        force: true,
      })
    await releaseFixture(fixture)
    await second?.stop()
  }
}

/** Runs one fixture turn on the searched owner and finds its reply text from the shared rail. */
async function searchOn(
  page: Page,
  step: (name: string) => Promise<void>,
  owners: { readonly primary: SearchOwner; readonly searched: SearchOwner },
) {
  const crossOwner = owners.primary.base !== owners.searched.base
  const primaryNative = crossOwner
    ? await installConversationProvider(page, owners.primary.base, 'search-primary')
    : null
  try {
    await withConversationProvider(page, owners.searched.base, 'session-search', (native) =>
      findReply(page, step, { ...owners, crossOwner, native, primaryNative }),
    )
  } finally {
    await primaryNative?.remove()
  }
}

async function findReply(
  page: Page,
  step: (name: string) => Promise<void>,
  input: {
    readonly primary: SearchOwner
    readonly searched: SearchOwner
    readonly crossOwner: boolean
    readonly native: NativeProvider
    readonly primaryNative: NativeProvider | null
  },
) {
  const { primary, searched, crossOwner, native, primaryNative } = input
  const sessionId = crypto.randomUUID()
  const title = `Search verification ${sessionId.slice(0, 8)}`
  const needle = `hiddenneedle${sessionId.replaceAll('-', '')}`
  await dispatch(page, searched.base, {
    type: 'session.create',
    sessionId,
    title,
    modelSelection: native.model,
    worktreeTarget: { kind: 'current', worktreeId: searched.worktreeId },
  })
  let primaryFixture = false
  const primaryTitle = `Primary ${title}`
  try {
    if (crossOwner) {
      // Same id on both owners: the cached query must keep each match with its own owner.
      await dispatch(page, primary.base, {
        type: 'session.create',
        sessionId,
        title: primaryTitle,
        modelSelection: primaryNative?.model ?? native.model,
        worktreeTarget: { kind: 'current', worktreeId: primary.worktreeId },
      })
      primaryFixture = true
    }
    await selectors.sessionSearch(page).fill(title)
    await selectors.sessionByTitle(page, title).click()
    await typePrompt(
      page,
      `Reply with exactly ${needle}. Do not use tools, inspect files or change files.`,
    )
    await selectors.chatSend(page).click()
    await selectors
      .chatMessages(page)
      .getByText(needle, { exact: true })
      .waitFor({ timeout: 30_000 })
    if (crossOwner) {
      await selectors.sessionSearch(page).fill(primaryTitle)
      await selectors.sessionByTitle(page, primaryTitle).click()
    }
    await selectors.sessionSearch(page).fill(needle)
    await selectors.sessionByTitle(page, title).waitFor()
    await step(
      crossOwner ? 'remote-message-found-from-shared-rail' : 'message-found-without-title-match',
    )
    await selectors.sessionSearch(page).fill(`absent${sessionId}`)
    ok(
      !(await selectors.sessionByTitle(page, title).isVisible()),
      'A new query must immediately discard the previous query matches',
    )
    await selectors.sessionByTitle(page, title).waitFor({ state: 'hidden' })
    await step('new-query-does-not-reuse-old-matches')
    await selectors.sessionSearch(page).fill(needle)
    await selectors.sessionByTitle(page, title).waitFor()
    await step('cached-query-keeps-correct-owner')
  } finally {
    await dispatch(page, searched.base, { type: 'session.runtime.stop', sessionId })
    await dispatch(page, searched.base, { type: 'session.delete', sessionId })
    if (primaryFixture) await dispatch(page, primary.base, { type: 'session.delete', sessionId })
  }
}

export const sessionSearch: Scenario = {
  name: 'session-search',
  requiresIsolatedServer: true,
  description:
    'Find hidden reply text in one disposable session on the Codex conversation fixture and reject stale matches after typing a new query.',
  run: (page, { step }) => searchConversation(page, step, false),
}

export const sessionSearchEnvironments: Scenario = {
  name: 'session-search-environments',
  requiresIsolatedServer: true,
  description:
    'Search hidden reply text owned by a second throwaway server connected as a Remote URL machine, while a same-id session exists on the first; the fixture turn runs on the second owner.',
  run: (page, { step }) => searchConversation(page, step, true),
}
