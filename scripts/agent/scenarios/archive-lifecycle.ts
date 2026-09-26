import { ok, strictEqual } from 'node:assert/strict'
import { createSession, dispatch, openChatWorkspace, readShell } from './chat-verification'
import type { Scenario } from './index'
import { selectors } from '../selectors'

export const archiveLifecycle: Scenario = {
  name: 'archive-lifecycle',
  description:
    'Archive an isolated session, open it from archive, reload and explicitly restore it. Deletes only its own session.',
  async run(page, { step }) {
    const shell = await openChatWorkspace(page)
    const sessionId = crypto.randomUUID()
    const title = `Archive verification ${sessionId.slice(0, 8)}`
    await createSession(page, shell, sessionId, title)
    try {
      await selectors.sessionSearch(page).fill(title)
      await selectors.sessionByTitle(page, title).waitFor()
      await step('active-session')
      await selectors.sessionByTitle(page, title).click({ button: 'right' })
      await selectors.archiveSession(page).click()
      await selectors.sessionByTitle(page, title).waitFor({ state: 'hidden' })
      const archivedAt = (await readShell(page, shell.base)).sessions.find(
        (item) => item.id === sessionId,
      )?.archivedAt
      ok(archivedAt, 'Archive persisted')
      await step('archived-through-menu')

      await selectors.archivedSessions(page).click()
      await selectors.sessionByTitle(page, title).waitFor()
      await selectors.sessionByTitle(page, title).click()
      await step('archived-session-opened')
      await page.reload()
      await selectors.sessionSearch(page).fill(title)
      const archive = selectors.archivedSessions(page)
      // The address carries ?rail=archived, so the archive view comes back once boot applies it.
      await archive.and(page.locator('[aria-pressed="true"]')).waitFor()
      await selectors.sessionByTitle(page, title).waitFor()
      await step('archive-survives-reload')
      await selectors.sessionByTitle(page, title).click({ button: 'right' })
      await selectors.restoreSession(page).click()
      await selectors.sessionByTitle(page, title).waitFor({ state: 'hidden' })
      await archive.click()
      await selectors.sessionByTitle(page, title).waitFor()
      const restored = (await readShell(page, shell.base)).sessions.find(
        (item) => item.id === sessionId,
      )
      strictEqual(restored?.archivedAt, null)
      await step('explicit-restore')
    } finally {
      await dispatch(page, shell.base, { type: 'session.delete', sessionId })
    }
  },
}
