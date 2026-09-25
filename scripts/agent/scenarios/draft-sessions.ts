import type { Page } from 'playwright'

import { createGitFixture, fixtureGit, releaseFixture } from '../fixture-workspace'
import { selectors } from '../selectors'
import { dispatch, readShell } from './chat-verification'

/** A committed fixture repository with the given extra branches, for new-worktree drafts. */
export async function draftFixture(name: string, branches: readonly string[] = []) {
  const fixture = await createGitFixture(name)
  await fixtureGit(fixture, ['commit', '--quiet', '--allow-empty', '-m', 'initial'])
  for (const branch of branches) await fixtureGit(fixture, ['branch', branch])
  return { path: fixture, release: () => releaseFixture(fixture) }
}

/** Pins the project to the isolated provider, so no draft spends real tokens, and opens a new draft. */
export async function openIsolatedDraft(
  page: Page,
  context: {
    readonly orchestration: string
    readonly projectId: string
    readonly providerInstanceId: string
  },
) {
  await dispatch(page, context.orchestration, {
    type: 'project.meta.update',
    projectId: context.projectId,
    defaultModelSelection: { providerInstanceId: context.providerInstanceId, model: 'gpt-5.5' },
  })
  const landed = page.url()
  await selectors.chatNewSession(page).click()
  await page.waitForURL((url) => url.href !== landed, { timeout: 20_000 })
}

/** Sessions started from a draft, each on a linked worktree the server made for it. */
export async function startedSessions(
  page: Page,
  orchestration: string,
  context: { readonly count: number; readonly projectId: string; readonly sessionId: string },
) {
  for (let attempt = 0; attempt < 150; attempt += 1) {
    const shell = await readShell(page, orchestration)
    const linked = shell.sessions.filter((session) => {
      if (session.id === context.sessionId) return false
      const tree = shell.worktrees.find((entry) => entry.id === session.worktreeId)
      return tree?.projectId === context.projectId && tree.kind === 'linked'
    })
    if (linked.length >= context.count) return linked
    await Bun.sleep(200)
  }
  return []
}

/** The fixture project can only be deleted once no managed worktree is left under it. */
export async function releaseStartedSessions(
  page: Page,
  orchestration: string,
  sessions: readonly { readonly id: string; readonly worktreeId: string }[],
) {
  for (const session of sessions) {
    await dispatch(page, orchestration, { type: 'session.runtime.stop', sessionId: session.id })
    await dispatch(page, orchestration, { type: 'session.delete', sessionId: session.id })
    await dispatch(page, orchestration, {
      type: 'worktree.release',
      worktreeId: session.worktreeId,
    })
  }
}
