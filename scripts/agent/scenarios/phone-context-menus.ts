import { ok } from 'node:assert/strict'

import { createModifiedFileFixture, releaseFixture } from '../fixture-workspace'
import { selectors } from '../selectors'
import { longPress } from '../touch'
import { readShell } from './chat-verification'
import { createSessions, openFixtureChat, PHONE_SESSIONS } from './phone-fixture'
import type { Scenario } from './index'

export const phoneContextMenus: Scenario = {
  name: 'phone-context-menus',
  description: 'Hold a session title, archive it, and open another menu on a touch phone.',
  capture: { width: 390, height: 844, scale: 2, touch: true },
  async run(page, { step }) {
    const fixture = await createModifiedFileFixture(
      'phone-context-menus',
      'notes.md',
      ['# Notes'],
      ['# Notes', 'Changed.'],
    )
    try {
      const base = await openFixtureChat(page, fixture)
      await createSessions(page, base, fixture)
      const row = selectors.sessionByTitle(page, PHONE_SESSIONS[0]!)
      await row.waitFor()
      // Establish that this row has a working menu before testing the touch path.
      await row.click({ button: 'right' })
      await selectors.archiveSession(page).waitFor()
      await page.keyboard.press('Escape')
      await selectors.archiveSession(page).waitFor({ state: 'hidden' })
      await longPress(page, row.getByText(PHONE_SESSIONS[0]!, { exact: true }), 1_600)
      await selectors.archiveSession(page).waitFor({ timeout: 3_000 })
      ok(await selectors.phoneLevel(page, 'sessions').isVisible(), 'The hold kept the list open')
      await step('title-long-press')
      await selectors.archiveSession(page).tap()
      await row.waitFor({ state: 'hidden' })
      const archived = (await readShell(page, base)).sessions.find(
        (session) => session.title === PHONE_SESSIONS[0],
      )
      ok(archived?.archivedAt, 'Touch Archive persisted')
      await step('archived')

      const next = selectors.sessionByTitle(page, PHONE_SESSIONS[1]!)
      await longPress(page, next.getByText(PHONE_SESSIONS[1]!, { exact: true }), 1_600)
      await selectors.archiveSession(page).waitFor({ timeout: 3_000 })
      await step('second-title-long-press')
      await page.touchscreen.tap(10, 70)
      await selectors.archiveSession(page).waitFor({ state: 'hidden' })
      await next.tap()
      await selectors.phoneLevel(page, 'session').waitFor()
      await step('ordinary-tap-opens-session')
    } catch (error) {
      await step('failed')
      throw error
    } finally {
      await releaseFixture(fixture)
    }
  },
}
