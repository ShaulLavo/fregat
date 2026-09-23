import { ok, strictEqual } from 'node:assert/strict'
import type { Page } from 'playwright'
import type { Scenario } from './index'
import { selectors } from '../selectors'

export const chatFollowUp: Scenario = {
  name: 'chat-follow-up',
  description:
    'Send a follow-up during a real Codex turn, then close its runtime and resume with another message.',
  async run(page, { step }) {
    const connected = page.waitForEvent('websocket', {
      predicate: (socket) => socket.url().endsWith('/orchestration/rpc'),
    })
    await page.goto(page.url().replace(/\/workbench(?:\?.*)?$/, '/chat'))
    const rpcUrl = (await connected).url()
    await selectors.chatNewSession(page).click()
    await page.waitForTimeout(1_500)
    await selectors.chatMessage(page).click()
    await selectors
      .chatMessage(page)
      .fill(
        'This is a chat delivery verification. Do not inspect or modify any files. First send a commentary message containing exactly CHAT_FOLLOWUP_READY. Then use your shell tool to run sleep 20. After the command finishes, respond briefly and follow any further message.',
      )
    await selectors.chatSend(page).click()
    try {
      await selectors
        .chatMessages(page)
        .getByText('CHAT_FOLLOWUP_READY', { exact: true })
        .waitFor({ timeout: 90_000 })
      await step('commentary-finished-turn-running')
      await selectors
        .chatMessage(page)
        .fill('When the command finishes, reply with exactly CHAT_FOLLOWUP_ACCEPTED.')
      await selectors.chatQueue(page).click()
      await page.waitForTimeout(1_000)
      await step('follow-up-queued')
      strictEqual(
        (await selectors.chatMessage(page).innerText()).trim(),
        '',
        'The running turn rejected its follow-up',
      )
      await selectors
        .chatMessages(page)
        .getByText('CHAT_FOLLOWUP_ACCEPTED', { exact: true })
        .waitFor({ timeout: 90_000 })
      await selectors.chatSend(page).waitFor({ timeout: 30_000 })
      await step('follow-up-answered')
      await stopVerificationRuntime(page, rpcUrl)
      await step('runtime-closed-for-resume')
      await selectors.chatMessage(page).click()
      await page.keyboard.insertText('Reply with exactly CHAT_NEXT_TURN_OK.')
      await selectors.chatSend(page).click()
      await selectors
        .chatMessages(page)
        .getByText('CHAT_NEXT_TURN_OK', { exact: true })
        .waitFor({ timeout: 90_000 })
      await selectors.chatSend(page).waitFor({ timeout: 30_000 })
      await step('completed-turn-follow-up-answered')
    } finally {
      if (await selectors.chatStop(page).isVisible()) await selectors.chatStop(page).click()
    }
  },
}

async function stopVerificationRuntime(page: Page, rpcUrl: string) {
  const sessionId = new URL(page.url()).pathname.match(/\/chat\/t\/([\da-f-]{36})$/)?.[1]
  ok(sessionId, 'The verification session must have its own address before stopping its runtime')
  const commandUrl = rpcUrl.replace(/^ws/, 'http').replace(/\/rpc$/, '/commands')
  const response = await page.request.post(commandUrl, {
    headers: { Origin: new URL(page.url()).origin },
    data: {
      type: 'session.runtime.stop',
      commandId: `chat-follow-up-stop-${crypto.randomUUID()}`,
      sessionId,
    },
  })
  ok(response.ok(), `Could not close the verification runtime: ${await response.text()}`)
}
