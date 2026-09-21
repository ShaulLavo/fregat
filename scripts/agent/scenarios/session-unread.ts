import { strictEqual } from 'node:assert/strict'
import type { Scenario } from './index'
import { selectors } from '../selectors'
import { dispatch, openChatShell, readShell } from './chat-verification'

export const sessionUnread: Scenario = {
  name: 'session-unread',
  description:
    'Visit, leave, complete, mark unread, reload and acknowledge a timer wake in disposable sessions. Uses one short provider turn.',
  async run(page, { step }) {
    const { base, project, worktree } = await openChatShell(page)
    const first = crypto.randomUUID()
    const second = crypto.randomUUID()
    const prefix = `Unread verification ${first.slice(0, 8)}`
    const title = `${prefix} conversation`
    const parking = `${prefix} parking`
    for (const [sessionId, label] of [
      [first, title],
      [second, parking],
    ]) {
      await dispatch(page, base, {
        type: 'session.create',
        sessionId,
        title: label,
        worktreeTarget: { kind: 'current', worktreeId: worktree.id },
        modelSelection: project.defaultModelSelection,
      })
    }
    try {
      await selectors.sessionSearch(page).fill(prefix)
      await selectors.sessionByTitle(page, title).click()
      await selectors
        .chatMessage(page)
        .fill(
          'Reply with exactly UNREAD_VERIFIED. Do not use tools, inspect files or change files.',
        )
      await selectors.chatSend(page).click()
      await selectors.sessionByTitle(page, parking).click()
      await selectors.sessionUnread(page, title).waitFor({ timeout: 90_000 })
      await step('completion-while-away-is-unread')
      await selectors.sessionByTitle(page, title).click()
      await selectors.sessionUnread(page, title).waitFor({ state: 'hidden' })
      await step('return-clears-unread')
      await selectors.sessionByTitle(page, parking).click()
      await selectors.sessionByTitle(page, title).click({ button: 'right' })
      await selectors.markSessionUnread(page).click()
      await selectors.sessionUnread(page, title).waitFor()
      await page.waitForTimeout(400)
      await page.reload()
      await selectors.sessionSearch(page).fill(prefix)
      await selectors.sessionUnread(page, title).waitFor()
      await step('manual-unread-survives-reload')
      await selectors.sessionByTitle(page, title).click()
      await selectors.sessionUnread(page, title).waitFor({ state: 'hidden' })
      const deadline = new Date(Date.now() + 2_000).toISOString()
      await dispatch(page, base, {
        type: 'session.snooze',
        sessionId: first,
        snoozedUntil: deadline,
      })
      await selectors.sessionWoke(page, title).waitFor({ timeout: 10_000 })
      await selectors.sessionByTitle(page, parking).click()
      await selectors.sessionByTitle(page, title).click()
      await selectors.sessionWoke(page, title).waitFor()
      await step('timer-wake-survives-casual-visit')
      await selectors.sessionByTitle(page, title).click({ button: 'right' })
      await selectors.acknowledgeSessionWake(page).click()
      await selectors.sessionWoke(page, title).waitFor({ state: 'hidden' })
      strictEqual(
        (await readShell(page, base)).sessions.find((item) => item.id === first)?.snoozedUntil,
        deadline,
      )
      await step('wake-acknowledged-without-server-event')
    } finally {
      await dispatch(page, base, { type: 'session.delete', sessionId: first })
      await dispatch(page, base, { type: 'session.delete', sessionId: second })
    }
  },
}
