import { strictEqual } from 'node:assert/strict'
import { selectors } from '../selectors'
import { isolatedNativeScenario, withUserSetting } from './native-provider-verification'

/** Plan 126 INTERACTION-11: the send shortcut decides what Enter does in the real editor. */
export const chatComposerEditing = isolatedNativeScenario({
  name: 'chat-composer-editing',
  description:
    'With chat.sendShortcut set to mod-enter, Enter adds a line and Ctrl+Enter sends the two-line message. On a touch device Shift+Enter adds a line and Enter sends. A 40 KB paste folds into pasted-text.txt, and Ctrl+Shift+V pastes it inline. Restores the setting.',
  fixture: new URL('../fixtures/native-codex.mjs', import.meta.url),
  async drive(page, { step, orchestration }) {
    const composer = selectors.chatMessage(page)
    const messages = selectors.chatMessages(page)
    await withUserSetting(
      page,
      orchestration,
      { key: 'chat.sendShortcut', value: 'mod-enter' },
      async () => {
        await composer.click()
        await page.keyboard.type('first line')
        await page.keyboard.press('Enter')
        await page.keyboard.type('second line')
        strictEqual((await composer.innerText()).trim(), 'first line\nsecond line')
        await step('enter-adds-a-line')
        await page.keyboard.press('Control+Enter')
        await messages.getByText('second line', { exact: false }).waitFor({ timeout: 30_000 })
        await step('ctrl-enter-sent')
      },
    )

    // A real clipboard paste: synthesized paste events never insert text.
    const large = 'large pasted log line\n'.repeat(2_000)
    await page.evaluate((text) => navigator.clipboard.writeText(text), large)
    await composer.click()
    await composer.fill('')
    await page.keyboard.press('Control+V')
    await selectors.chatStagedFile(page, 'pasted-text.txt').waitFor({ timeout: 10_000 })
    strictEqual((await composer.innerText()).trim(), '', 'A folded paste leaves the prompt empty')
    await step('large-paste-folded')

    await page.keyboard.press('Control+Shift+V')
    await composer.getByText('large pasted log line', { exact: false }).first().waitFor()
    await step('ctrl-shift-v-pastes-inline')
    await composer.fill('')

    // Finish the fixture's approval so the next send is admitted.
    await selectors.appApprovalDecision(page, 'Decline').click()
    await selectors.appApproval(page).waitFor({ state: 'hidden', timeout: 30_000 })
    const touch = await page.context().newCDPSession(page)
    await touch.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 })
    try {
      strictEqual(
        await page.evaluate(() => matchMedia('(hover: none) and (pointer: coarse)').matches),
        true,
        'Touch emulation reports a finger pointer',
      )
      await composer.click()
      await page.keyboard.press('Control+A')
      await page.keyboard.press('Backspace')
      await page.keyboard.type('touch one')
      await page.keyboard.press('Shift+Enter')
      await page.keyboard.type('touch two')
      await page.waitForTimeout(300)
      strictEqual((await composer.innerText()).trim(), 'touch one\ntouch two')
      strictEqual(await messages.getByText('touch two', { exact: false }).count(), 0)
      await step('touch-shift-enter-adds-a-line')
      await page.keyboard.press('Enter')
      await messages.getByText('touch two', { exact: false }).waitFor({ timeout: 30_000 })
      await step('touch-enter-sends')
    } finally {
      await touch.send('Emulation.setTouchEmulationEnabled', { enabled: false })
      await touch.detach()
    }
  },
})
