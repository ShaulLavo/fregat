import { equal, ok } from 'node:assert/strict'
import type { Page } from 'playwright'
import { selectors } from '../selectors'
import { readSessionDetail } from './chat-verification'
import {
  isolatedNativeScenario,
  nativeLog,
  openSecondWindow,
  requestAppApproval,
} from './native-provider-verification'

const RECEIPTS = ['Allowed once', 'Allowed for this session', 'Always allowed', 'Denied']
const REFUSAL = /^Could not send your response\./

/** Plan 161: two windows and a double click still produce one approval decision. */
export const approvalTwoTabs = isolatedNativeScenario({
  name: 'approval-two-tabs',
  description:
    'Two windows answer one approval differently at once, then one window double-clicks the next: one answer reaches the agent each time, one decided receipt per request, and no window shows a second decision.',
  fixture: new URL('../fixtures/native-codex.mjs', import.meta.url),
  async drive(page, { step, root, orchestration, sessionId }) {
    await requestAppApproval(page)
    const other = await openSecondWindow(page, orchestration)
    try {
      await selectors.appApproval(other.page).waitFor({ timeout: 30_000 })
      await step('second-window-shows-the-approval', other.page)

      await Promise.all([
        selectors.appApprovalDecision(page, 'Approve').click(),
        selectors.appApprovalDecision(other.page, 'Decline').click(),
      ])
      await step('second-window-after-the-race', other.page)
      await step('first-window-after-the-race')

      await waitForResponses(root, 1)
      const winner = await firstAnswer(root)
      await expectLoserRefusedOrClosed(page, other.page)
      await expectOneDecision(page, orchestration, sessionId, 1)
      for (const window of [page, other.page]) {
        await selectors
          .chatMessages(window)
          .getByText(/^Worked for /)
          .first()
          .click()
        equal(await receiptCount(window), 1, 'Each window shows one decided receipt')
        await selectors.chatMessages(window).getByText(winner.receipt, { exact: true }).waitFor()
      }
      await step(`receipts-first-window-${winner.window}-won`)
      await step(`receipts-second-window-${winner.window}-won`, other.page)
    } finally {
      await other.close()
    }

    await requestAppApproval(page, 'Request the approval again.')
    await selectors.appApprovalDecision(page, 'Approve').dblclick()
    await waitForResponses(root, 2)
    await page.waitForTimeout(1_000)
    equal(await responseCount(root), 2, 'A double click sends one answer')
    await expectOneDecision(page, orchestration, sessionId, 2)
    await step('double-click-answered-once')
  },
})

async function responseCount(root: string) {
  return (await nativeLog(root)).filter((entry) => entry.event === 'approval-response').length
}

async function waitForResponses(root: string, count: number) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if ((await responseCount(root)) >= count) break
    await Bun.sleep(100)
  }
  await Bun.sleep(500)
  equal(await responseCount(root), count, `Exactly ${count} answer(s) reach the agent`)
}

/** Which window's answer the agent received, and the receipt every window must show. */
async function firstAnswer(root: string) {
  const response = (await nativeLog(root)).find((entry) => entry.event === 'approval-response')
  const action = (response?.result as { action?: string } | undefined)?.action
  ok(action === 'accept' || action === 'decline', `Unexpected first answer ${action}`)
  return action === 'accept'
    ? { window: 'first', receipt: 'Allowed once' }
    : { window: 'second', receipt: 'Denied' }
}

/** A panel still open after the race carries the refusal; it never shows a success. */
async function expectLoserRefusedOrClosed(first: Page, second: Page) {
  for (const window of [first, second])
    await selectors
      .chatMessages(window)
      .getByText('MCP_APPROVAL_VERIFIED', { exact: true })
      .waitFor({ timeout: 30_000 })
  const refused = await Promise.all(
    [first, second].map((window) => window.getByText(REFUSAL).count()),
  )
  const panels = await Promise.all(
    [first, second].map((window) => selectors.appApproval(window).count()),
  )
  ok(
    panels.every((count, index) => count === 0 || (refused[index] ?? 0) > 0),
    `A panel left open must carry the refusal (panels ${panels}, refusals ${refused})`,
  )
}

/** One decided `approval.resolved` per request, read from the server's projection. */
async function expectOneDecision(
  page: Page,
  orchestration: string,
  sessionId: string,
  requests: number,
) {
  const session = await readSessionDetail(page, orchestration, sessionId)
  const decided = session.activities.filter(
    (activity) =>
      activity.kind === 'approval.resolved' &&
      typeof (activity.payload as Record<string, unknown>).decision === 'string',
  )
  const requestIds = new Set(
    decided.map((activity) => (activity.payload as Record<string, unknown>).requestId),
  )
  equal(decided.length, requests, 'One decided receipt per approval request')
  equal(requestIds.size, requests, 'No request carries two decisions')
}

async function receiptCount(page: Page) {
  const messages = selectors.chatMessages(page)
  const counts = await Promise.all(
    RECEIPTS.map((label) => messages.getByText(label, { exact: true }).count()),
  )
  return counts.reduce((sum, count) => sum + count, 0)
}
