import { deepStrictEqual } from 'node:assert/strict'
import { selectors } from '../selectors'
import { isolatedNativeScenario, nativeLog, sendPrompt } from './native-provider-verification'

/** Plan 174 P1: the session popover says where each server lives, how it connects and what it offers. */
export const mcpStatus = isolatedNativeScenario({
  name: 'mcp-status',
  description:
    'A fixture Codex reports three MCP servers (user HTTP with tools, user HTTP signed out, project stdio failing): the chat shows the failure row, the header popover lists each with its source, origin or transport, and tool count, and switching one off reopens the thread without it.',
  fixture: new URL('../fixtures/native-codex.ts', import.meta.url),
  async drive(page, { root, step }) {
    await sendPrompt(page, 'Report MCP status.')
    const messages = selectors.chatMessages(page)
    await messages.getByText('MCP_STATUS_READY', { exact: true }).waitFor({ timeout: 30_000 })
    await messages
      .getByText(/broken connection failed/)
      .first()
      .waitFor()
    await step('failure-row')

    await page.getByRole('button', { name: 'MCP servers and hooks' }).first().click()
    const popover = page.getByRole('dialog').filter({ hasText: 'MCP servers' })
    await popover.getByText('User · https://mcp.linear.app · 2 tools').waitFor({ timeout: 15_000 })
    await popover.getByText('User · https://mcp.sentry.dev').waitFor()
    await popover.getByText('Project · stdio').waitFor()
    await step('popover-facts')

    await popover.getByRole('switch', { name: 'linear in this session' }).click()
    await popover.getByTitle(/^linear · Off for this session/).waitFor({ timeout: 30_000 })
    await step('linear-off-for-session')
    const opened = (await nativeLog(root)).filter(
      (entry) => entry.event === 'thread/start' || entry.event === 'thread/resume',
    )
    deepStrictEqual(
      opened.map((entry) => [entry.event, entry.config, entry.platformMcp]),
      [
        ['thread/start', {}, true],
        ['thread/resume', { 'mcp_servers.linear.enabled': false }, true],
      ],
    )
  },
})
