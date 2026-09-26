import { equal, ok } from 'node:assert/strict'

import { createModifiedFileFixture, releaseFixture } from '../fixture-workspace'
import { selectors } from '../selectors'
import { createSessions, openFixtureChat, PHONE_SESSIONS } from './phone-fixture'
import type { Scenario } from './index'

const DESK = { width: 1440, height: 1000 }
const NARROW = { width: 600, height: 900 }

/**
 * A desk window narrowed into the phone shell and widened back: the workbench renders with a
 * folder open in both modes, the session terminal survives the round trip, and the window comes
 * back in the mode it left even though the phone moved it to chat.
 */
export const shellSwitch: Scenario = {
  name: 'shell-switch',
  description:
    'A desk window narrowed into the phone shell and widened back keeps its mode and its session terminal.',
  capture: { width: DESK.width, height: DESK.height },
  async run(page, { step }) {
    const fixture = await createModifiedFileFixture('shell-switch', 'notes.md', ['one'], ['two'])
    try {
      const base = await openFixtureChat(page, fixture)
      await createSessions(page, base, fixture)
      await selectors.sessionByTitle(page, PHONE_SESSIONS[0]!).click()
      await selectors.chatToolTab(page, 'Terminal').click()
      const terminal = page.locator('[data-chat-mode] canvas').first()
      await terminal.waitFor({ timeout: 20_000 })
      await step('desk-chat-terminal')

      await selectors.workspaceMode(page, 'Workbench').click()
      await selectors.sidebarTab(page, 'Files').waitFor()
      await step('desk-workbench')

      await page.setViewportSize(NARROW)
      await selectors.phoneShell(page).waitFor()
      await step('narrowed')
      await selectors.phoneBack(page).click()
      await selectors.phoneLevel(page, 'sessions').waitFor()
      await selectors.sessionByTitle(page, PHONE_SESSIONS[1]!).click()
      await selectors.phoneLevel(page, 'session').waitFor()
      await step('phone-session')

      await page.setViewportSize(DESK)
      await selectors.windowToolbar(page).waitFor()
      await selectors.sidebarTab(page, 'Files').waitFor()
      equal(await page.locator('[data-chat-mode]').count(), 0, 'The desk is back in workbench mode')
      await step('widened')

      // Back on the first session, whose shell was parked while the phone shell showed.
      await selectors.workspaceMode(page, 'Chat').click()
      await selectors.sessionByTitle(page, PHONE_SESSIONS[0]!).click()
      // The tool pane remembers the terminal tab; pressing an open tab would fold the pane.
      if (!(await terminal.isVisible())) await selectors.chatToolTab(page, 'Terminal').click()
      await terminal.waitFor({ timeout: 20_000 })
      ok(await terminal.isVisible(), 'The session terminal is still there')
      await step('desk-chat-again')
    } catch (error) {
      await step('failed')
      throw error
    } finally {
      await releaseFixture(fixture)
    }
  },
}
