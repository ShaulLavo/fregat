import { equal, ok } from 'node:assert/strict'
import type { Page, WebSocketRoute } from 'playwright'
import { selectors } from '../selectors'
import {
  isolatedNativeScenario,
  nativeLog,
  requestAppApproval,
} from './native-provider-verification'

const ANSWERED_ELSEWHERE = /It may already have been answered in another window\.$/

/** Plan 161 1.7: a pending approval admits it may be decided elsewhere while chat is offline. */
export const approvalReconnect = isolatedNativeScenario({
  name: 'approval-reconnect',
  description:
    'Drop the orchestration socket while an approval is pending: the panel keeps the request with its buttons disabled and says it may already be answered elsewhere; on reconnect the line goes and the approval is answered once.',
  fixture: new URL('../fixtures/native-codex.mjs', import.meta.url),
  async drive(page, { step, root }) {
    const socket = await droppableOrchestrationSocket(page)
    await page.reload()
    await selectors.chatMessage(page).waitFor()
    await requestAppApproval(page)
    await step('approval-pending-live')

    socket.drop()
    const line = selectors.appApproval(page).getByText(ANSWERED_ELSEWHERE)
    await line.waitFor({ timeout: 15_000 })
    const approve = selectors.appApprovalDecision(page, 'Approve')
    ok(await approve.isDisabled(), 'Approve is disabled while chat is offline')
    ok(await selectors.appApprovalDecision(page, 'Decline').isDisabled(), 'Decline is disabled')
    await step('socket-dropped-panel-kept')

    socket.restore()
    await line.waitFor({ state: 'hidden', timeout: 30_000 })
    await step('reconnected-line-gone')
    await approve.click()
    await selectors.appApproval(page).waitFor({ state: 'hidden', timeout: 30_000 })
    await selectors.chatMessages(page).getByText('MCP_APPROVAL_VERIFIED', { exact: true }).waitFor()
    const responses = (await nativeLog(root)).filter((entry) => entry.event === 'approval-response')
    equal(responses.length, 1, 'The approval is answered once after reconnecting')
    await step('answered-after-reconnect')
  },
})

/**
 * Proxies the page's orchestration sockets so the scenario can cut them: `drop` closes the
 * open ones and refuses new ones until `restore`.
 */
async function droppableOrchestrationSocket(page: Page) {
  const open = new Set<WebSocketRoute>()
  let dropped = false
  await page.routeWebSocket(/\/orchestration\/rpc$/, (route) => {
    if (dropped) {
      void route.close({ code: 4000, reason: 'Verification drop' })
      return
    }
    route.connectToServer()
    open.add(route)
  })
  return {
    drop() {
      dropped = true
      for (const route of open) void route.close({ code: 4000, reason: 'Verification drop' })
      open.clear()
    },
    restore() {
      dropped = false
    },
  }
}
