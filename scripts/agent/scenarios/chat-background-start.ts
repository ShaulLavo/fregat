import { strictEqual } from 'node:assert/strict'
import type { Page } from 'playwright'

import { createGitFixture, fixtureGit, releaseFixture } from '../fixture-workspace'
import { selectors } from '../selectors'
import { dispatch, readShell } from './chat-verification'
import { isolatedNativeScenario } from './native-provider-verification'

const PROMPTS = ['Background task one.', 'Background task two.', 'Background task three.']

async function prepareFixture() {
  const fixture = await createGitFixture('background-start')
  await fixtureGit(fixture, ['commit', '--quiet', '--allow-empty', '-m', 'initial'])
  await fixtureGit(fixture, ['branch', 'release'])
  return { path: fixture, release: () => releaseFixture(fixture) }
}

/** The route's draft id; the environment prefix may be normalised away. */
function draftIdIn(url: string) {
  return /\/chat\/t\/(draft-[^/?]+)/.exec(url)?.[1] ?? null
}

/** Sessions started from the draft, each on a linked worktree the server made for it. */
async function startedSessions(
  page: Page,
  orchestration: string,
  context: { readonly projectId: string; readonly sessionId: string },
) {
  for (let attempt = 0; attempt < 150; attempt += 1) {
    const shell = await readShell(page, orchestration)
    const linked = shell.sessions.filter((session) => {
      if (session.id === context.sessionId) return false
      const tree = shell.worktrees.find((entry) => entry.id === session.worktreeId)
      return tree?.projectId === context.projectId && tree.kind === 'linked'
    })
    if (linked.length >= PROMPTS.length) return linked
    await Bun.sleep(200)
  }
  return []
}

/** Plan 126 INTERACTION-13: Ctrl+Enter in a new draft starts the session and stays on the draft. */
export const chatBackgroundStart = isolatedNativeScenario({
  name: 'chat-background-start',
  description:
    'In a new draft set to New worktree from `release`, Ctrl+Enter three times fast: each start gets its own worktree, the user stays on an empty draft with the same workspace and base branch, and the sessions appear in the rail.',
  fixture: new URL('../fixtures/native-codex.mjs', import.meta.url),
  prepareWorktree: prepareFixture,
  async drive(page, { step, orchestration, sessionId, projectId, providerInstanceId }) {
    await dispatch(page, orchestration, {
      type: 'project.meta.update',
      projectId,
      defaultModelSelection: { providerInstanceId, model: 'gpt-5.5' },
    })
    const landed = page.url()
    await selectors.chatNewSession(page).click()
    await page.waitForURL((url) => url.href !== landed, { timeout: 20_000 })
    const draftId = draftIdIn(page.url())
    const workspace = selectors.draftWorkspace(page)
    await workspace.click()
    await selectors.menuRadio(page, 'New worktree').click()
    await selectors.popupMenu(page).waitFor({ state: 'hidden' })
    await selectors.draftBaseBranch(page).click()
    await selectors.menuRadio(page, 'release').click()

    const composer = selectors.chatMessage(page)
    for (const prompt of PROMPTS) {
      await composer.fill(prompt)
      await composer.press('Control+Enter')
      await page.waitForFunction(
        (text) => !document.querySelector('[aria-label="Message"]')?.textContent?.includes(text),
        prompt,
      )
    }
    strictEqual(draftIdIn(page.url()), draftId, 'Background starts keep the user on the draft')
    strictEqual((await workspace.innerText()).trim(), 'New worktree')
    strictEqual((await selectors.draftBaseBranch(page).innerText()).trim(), 'From release')
    await step('fresh-draft-after-three-starts')

    const started = await startedSessions(page, orchestration, { projectId, sessionId })
    strictEqual(started.length, PROMPTS.length, 'Every background start became a session')
    const worktrees = new Set(started.map((session) => session.worktreeId))
    strictEqual(worktrees.size, PROMPTS.length, 'Each start has its own worktree')
    for (const session of started) await page.getByTitle(session.title).first().waitFor()
    await step('three-sessions-in-the-rail')

    // The fixture project can only be deleted once no managed worktree is left under it.
    for (const session of started) {
      await dispatch(page, orchestration, { type: 'session.runtime.stop', sessionId: session.id })
      await dispatch(page, orchestration, { type: 'session.delete', sessionId: session.id })
      await dispatch(page, orchestration, {
        type: 'worktree.release',
        worktreeId: session.worktreeId,
      })
    }
  },
})
