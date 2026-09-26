import { strictEqual } from 'node:assert/strict'
import { selectors } from '../selectors'
import {
  draftFixture,
  openIsolatedDraft,
  releaseStartedSessions,
  startedSessions,
} from './draft-sessions'
import { isolatedNativeScenario } from './native-provider-verification'

const PROMPTS = ['Background task one.', 'Background task two.', 'Background task three.']

/** The route's draft id; the environment prefix may be normalised away. */
function draftIdIn(url: string) {
  return /\/chat\/t\/(draft-[^/?]+)/.exec(url)?.[1] ?? null
}

/** Plan 126 INTERACTION-13: Ctrl+Enter in a new draft starts the session and stays on the draft. */
export const chatBackgroundStart = isolatedNativeScenario({
  name: 'chat-background-start',
  description:
    'In a new draft set to New worktree from `release`, Ctrl+Enter three times fast: each start gets its own worktree, the user stays on an empty draft with the same workspace and base branch, and the sessions appear in the rail.',
  fixture: new URL('../fixtures/native-codex.mjs', import.meta.url),
  prepareWorktree: () => draftFixture('background-start', ['release']),
  async drive(page, { step, orchestration, sessionId, projectId, providerInstanceId }) {
    await openIsolatedDraft(page, { orchestration, projectId, providerInstanceId })
    const draftId = draftIdIn(page.url())
    const workspace = selectors.draftWorkspace(page)
    await workspace.click()
    await selectors.menuRadio(page, 'New worktree').click()
    await selectors.popupMenu(page).waitFor({ state: 'hidden' })
    await selectors.draftBaseBranch(page).click()
    await selectors.menuRadio(page, 'release').click()

    const composer = selectors.chatMessage(page)
    for (const prompt of PROMPTS) {
      await selectors.fillChatMessage(page, prompt)
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

    const started = await startedSessions(page, orchestration, {
      count: PROMPTS.length,
      projectId,
      sessionId,
    })
    strictEqual(started.length, PROMPTS.length, 'Every background start became a session')
    const worktrees = new Set(started.map((session) => session.worktreeId))
    strictEqual(worktrees.size, PROMPTS.length, 'Each start has its own worktree')
    for (const session of started) await page.getByTitle(session.title).first().waitFor()
    await step('three-sessions-in-the-rail')

    await releaseStartedSessions(page, orchestration, started)
  },
})
