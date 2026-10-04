import type { Page } from 'playwright'
import { strictEqual } from 'node:assert/strict'
import { selectors } from '../selectors'
import { isolatedNativeScenario, withUserSetting } from './native-provider-verification'

export const chatComposerSend = isolatedNativeScenario({
  name: 'chat-composer-send',
  description:
    'Enter sends a two-line message and Shift+Enter adds a line, with desktop and touch pointers.',
  fixture: new URL('../fixtures/native-codex.mjs', import.meta.url),
  async drive(page, { step, orchestration }) {
    const touch = await page.context().newCDPSession(page)
    try {
      for (const enabled of [false, true]) {
        await touch.send('Emulation.setTouchEmulationEnabled', { enabled, maxTouchPoints: 5 })
        const label = enabled ? 'touch' : 'desktop'
        await sendMultiline(page, { step, orchestration }, label)
        await selectors.appApprovalDecision(page, 'Decline').click()
        await selectors.appApproval(page).waitFor({ state: 'hidden', timeout: 30_000 })
        await selectors
          .chatMessages(page)
          .getByText('MCP_APPROVAL_VERIFIED', { exact: true })
          .nth(enabled ? 1 : 0)
          .waitFor({ timeout: 30_000 })
      }
    } finally {
      await touch.send('Emulation.setTouchEmulationEnabled', { enabled: false })
      await touch.detach()
    }
  },
})

type DriveContext = Parameters<Parameters<typeof isolatedNativeScenario>[0]['drive']>[1]

async function sendMultiline(
  page: Page,
  { step, orchestration }: Pick<DriveContext, 'step' | 'orchestration'>,
  label: string,
) {
  const composer = selectors.chatMessage(page)
  await withUserSetting(
    page,
    orchestration,
    { key: 'chat.sendShortcut', value: 'enter' },
    async () => {
      await composer.click()
      await page.keyboard.type(`${label} first`)
      await page.keyboard.press('Shift+Enter')
      await page.keyboard.type(`${label} second`)
      strictEqual((await composer.innerText()).trim(), `${label} first\n${label} second`)
      await step(`${label}-shift-enter-newline`)
      await page.keyboard.press('Enter')
      await selectors
        .chatMessages(page)
        .getByText(`${label} second`, { exact: false })
        .waitFor({ timeout: 30_000 })
      await step(`${label}-enter-sent`)
    },
  )
}
