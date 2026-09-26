import { ok, strictEqual } from 'node:assert/strict'
import type { Page } from 'playwright'

import type { Scenario } from './index'
import { selectors } from '../selectors'
import {
  createSession,
  dispatch,
  openChatWorkspace,
  readShell,
  type ChatShell,
} from './chat-verification'

async function sessionState(page: Page, shell: Pick<ChatShell, 'base'>, sessionId: string) {
  const snapshot = await readShell(page, shell.base)
  const session = snapshot.sessions.find((candidate) => candidate.id === sessionId)
  ok(session, `Session ${sessionId} must still exist`)
  return session
}

async function until(
  page: Page,
  shell: Pick<ChatShell, 'base'>,
  sessionId: string,
  check: (session: Awaited<ReturnType<typeof sessionState>>) => boolean,
  message: string,
) {
  const deadline = Date.now() + 10_000
  while (Date.now() < deadline) {
    if (check(await sessionState(page, shell, sessionId))) return
    await page.waitForTimeout(100)
  }
  ok(false, message)
}

async function choose(page: Page, item: string) {
  await selectors.sessionActions(page).click()
  await selectors.menuItem(page, item).click()
}

export const sessionActionsSurfaces: Scenario = {
  name: 'session-actions-surfaces',
  description:
    'One disposable metadata session: rename from the rail row, pin and rename from the chat stage header, then rename, snooze, cancel a delete and archive from the editor sidebar chat header. No provider turn; the session is deleted at the end.',
  async run(page, { step }) {
    const shell = await openChatWorkspace(page)
    const sessionId = crypto.randomUUID()
    const title = `Actions verification ${sessionId.slice(0, 8)}`
    const renamed = `${title} renamed`
    await createSession(page, shell, sessionId, title)
    try {
      await selectors.sessionSearch(page).fill(title)
      await selectors.sessionByTitle(page, title).click({ button: 'right' })
      await selectors.menuItem(page, 'Rename').click()
      const railInput = page.getByRole('textbox', { name: 'Session title' })
      await railInput.fill(`${title} rail`)
      await railInput.press('Enter')
      await until(page, shell, sessionId, (s) => s.title === `${title} rail`, 'Rail row renames')
      await railInput.waitFor({ state: 'hidden' })
      await selectors.sessionByTitle(page, `${title} rail`).click()
      await step('rail-renamed')

      await choose(page, 'Pin')
      await until(page, shell, sessionId, (s) => Boolean(s.pinnedAt), 'Stage header pins')
      await choose(page, 'Unpin')
      await until(page, shell, sessionId, (s) => !s.pinnedAt, 'Stage header unpins')
      await step('stage-pin-unpin')

      await choose(page, 'Rename')
      const stageInput = page.getByRole('textbox', { name: 'Session title' })
      await stageInput.fill(`${title} staged`)
      await stageInput.press('Enter')
      await until(
        page,
        shell,
        sessionId,
        (s) => s.title === `${title} staged`,
        'Stage header renames',
      )
      await step('stage-renamed')

      await selectors.workspaceMode(page, 'Workbench').click()
      await selectors.sidebarTab(page, 'Chat').click()
      await selectors.chatHeaderHistory(page).click()
      await page
        .getByRole('menuitem')
        .filter({ hasText: `${title} staged` })
        .first()
        .click()
      await selectors.sessionActions(page).waitFor()
      await step('sidebar-session')

      await choose(page, 'Rename')
      const input = page.getByRole('textbox', { name: 'Session title' })
      await input.fill(renamed)
      await input.press('Enter')
      await until(page, shell, sessionId, (s) => s.title === renamed, 'Sidebar header renames')
      await step('sidebar-renamed')

      await choose(page, 'Snooze…')
      await page
        .getByRole('dialog')
        .getByRole('button', { name: /In 1 hour/ })
        .click()
      await until(page, shell, sessionId, (s) => Boolean(s.snoozedUntil), 'Sidebar header snoozes')
      await choose(page, 'Unsnooze')
      await until(page, shell, sessionId, (s) => !s.snoozedUntil, 'Sidebar header unsnoozes')
      await step('sidebar-snooze-unsnooze')

      await choose(page, 'Delete')
      await page.getByRole('dialog').getByRole('button', { name: 'Cancel' }).click()
      await page.getByRole('dialog').waitFor({ state: 'hidden' })
      strictEqual((await sessionState(page, shell, sessionId)).id, sessionId)
      await step('sidebar-delete-cancelled')

      await choose(page, 'Archive')
      await until(page, shell, sessionId, (s) => Boolean(s.archivedAt), 'Sidebar header archives')
      await step('sidebar-archived')
    } catch (error) {
      await step('failed-before-cleanup')
      throw error
    } finally {
      await dispatch(page, shell.base, { type: 'session.delete', sessionId })
    }
  },
}
