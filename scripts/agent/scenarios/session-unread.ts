import { strictEqual } from 'node:assert/strict'
import type { Scenario } from './index'
import { selectors } from '../selectors'
import { dispatch, openChatWorkspace, readShell } from './chat-verification'
import { holdTurns, withConversationProvider } from './native-provider-verification'

export const sessionUnread: Scenario = {
  name: 'session-unread',
  requiresIsolatedServer: true,
  description:
    'Visit, leave, complete, mark unread, reload and acknowledge a timer wake in disposable sessions. One turn on the Codex conversation fixture finishes while the session is away.',
  async run(page, { step }) {
    const { base, worktree } = await openChatWorkspace(page)
    await withConversationProvider(page, base, 'session-unread', async (native) => {
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
          modelSelection: native.model,
        })
      }
      try {
        await selectors.sessionSearch(page).fill(prefix)
        await selectors.sessionByTitle(page, title).click()
        // Held until the page has left, so the completion lands while the session is away.
        const held = await holdTurns(native)
        await selectors
          .chatMessage(page)
          .fill(
            'Reply with exactly UNREAD_VERIFIED. Do not use tools, inspect files or change files.',
          )
        await selectors.chatSend(page).click()
        await selectors.sessionByTitle(page, parking).click()
        await page.waitForURL((url) => url.href.includes(second))
        await held.release()
        await selectors.sessionUnread(page, title).waitFor({ timeout: 30_000 })
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
        for (const sessionId of [first, second]) {
          await dispatch(page, base, { type: 'session.runtime.stop', sessionId })
          await dispatch(page, base, { type: 'session.delete', sessionId })
        }
      }
    })
  },
}
