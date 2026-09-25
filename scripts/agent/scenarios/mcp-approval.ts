import { deepStrictEqual } from 'node:assert/strict'
import { selectors } from '../selectors'
import {
  isolatedNativeScenario,
  nativeLog,
  requestAppApproval,
} from './native-provider-verification'

export const mcpApproval = isolatedNativeScenario({
  name: 'mcp-approval',
  description:
    'Approve native app access after reload, verify the exact reply, and remove the isolated provider/session.',
  fixture: new URL('../fixtures/native-codex.mjs', import.meta.url),
  async drive(page, { step, root }) {
    await requestAppApproval(page)
    await step('native-app-access-request')
    await page.reload()
    await selectors.appApproval(page).waitFor({ timeout: 30_000 })
    await selectors
      .appApprovalDecision(page, 'Always allow Verification App')
      .click({ trial: true })
    await step('advertised-choices-after-reload')
    await selectors.appApprovalDecision(page, 'Always allow Verification App').click()
    await selectors.appApproval(page).waitFor({ state: 'hidden', timeout: 30_000 })
    await selectors.chatMessages(page).getByText('MCP_APPROVAL_VERIFIED', { exact: true }).waitFor()
    const entries = await nativeLog(root)
    deepStrictEqual(
      entries.filter((entry) => entry.event === 'approval-response'),
      [
        {
          event: 'approval-response',
          id: 991,
          result: {
            action: 'accept',
            content: { approval: 'always' },
            _meta: { persist: 'always' },
          },
        },
      ],
    )
    await step('native-reply-and-completion')
  },
})
