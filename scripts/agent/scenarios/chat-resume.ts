import { equal, ok } from 'node:assert/strict'
import type { WebSocketRoute } from 'playwright'
import type { Scenario } from './index'
import { selectors } from '../selectors'
import { openChat, readSessionDetail } from './chat-verification'
import { createMockProviderSession } from './mock-provider-session'
import { sendPrompt } from './native-provider-verification'

export const chatResume: Scenario = {
  name: 'chat-resume',
  description:
    'A finished mobile chat recovers from a suspended-page socket loss without touching the composer.',
  async run(page, { step }) {
    const orchestration = await openChat(page)
    const session = await createMockProviderSession(page, orchestration, {
      name: 'chat-resume',
      displayLabel: 'Resume fixture',
      config: {},
    })
    const sockets = new Set<WebSocketRoute>()
    let dropped = false
    await page.routeWebSocket(/\/orchestration\/rpc(?:\?|$)/, (route) => {
      if (dropped) {
        void route.close({ code: 4000, reason: 'Verification suspension' })
        return
      }
      route.connectToServer()
      sockets.add(route)
    })
    try {
      await page.reload()
      await sendPrompt(page, 'Finish this conversation before the app switch.')
      for (let attempt = 0; attempt < 100; attempt++) {
        if (
          (await readSessionDetail(page, orchestration, session.sessionId)).latestTurn?.state ===
          'completed'
        )
          break
        await page.waitForTimeout(100)
      }
      equal(
        (await readSessionDetail(page, orchestration, session.sessionId)).latestTurn?.state,
        'completed',
      )
      await selectors.chatStop(page).waitFor({ state: 'hidden' })
      await step('finished-chat')
      await page.evaluate(() => {
        Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' })
        document.dispatchEvent(new Event('visibilitychange'))
      })
      dropped = true
      for (const socket of sockets)
        await socket.close({ code: 4000, reason: 'Verification suspension' })
      sockets.clear()
      await page.waitForTimeout(1_000)
      await page.evaluate(() => {
        Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' })
        document.dispatchEvent(new Event('visibilitychange'))
      })
      const notice = page
        .getByRole('status')
        .filter({ hasText: /Reconnecting|disconnected|Syncing/ })
      await notice.waitFor({ timeout: 5_000 })
      equal(await page.getByText(/WebSocket closed|inspect the server WebSocket logs/).count(), 0)
      await step('returned-with-connection-notice')
      dropped = false
      await notice.waitFor({ state: 'hidden', timeout: 20_000 })
      ok(await selectors.chatMessage(page).isVisible())
      equal(
        (await readSessionDetail(page, orchestration, session.sessionId)).latestTurn?.state,
        'completed',
      )
      await step('recovered-without-composer-interaction')
    } catch (error) {
      await step('failure-before-cleanup')
      throw error
    } finally {
      dropped = false
      await session.cleanup()
    }
  },
}
