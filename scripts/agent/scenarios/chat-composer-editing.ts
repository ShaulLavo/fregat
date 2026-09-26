import { match, strictEqual } from 'node:assert/strict'
import type { Page } from 'playwright'
import { selectors } from '../selectors'
import { isolatedNativeScenario, withUserSetting } from './native-provider-verification'

/**
 * The composer on our own editor, against the fixture Codex binary only. Enter under both send
 * shortcuts, mention chips from the menu and by hand, the caret stepping over a chip and one
 * Backspace deleting it, an IME commit, pastes, and a send, at desktop and phone width.
 */
export const chatComposerEditing = isolatedNativeScenario({
  name: 'chat-composer-editing',
  description:
    'Composer on the Editor: mod-enter keeps Enter for new lines, a menu-picked and a hand-typed @mention become chips, the caret steps over a chip and one Backspace deletes it, an IME commit lands, a large paste folds (Ctrl+Shift+V keeps it inline), a pasted mention becomes a chip, and a two-line message with a chip sends on Ctrl+Enter; then the same composer at phone width. Fixture provider only.',
  fixture: new URL('../fixtures/native-codex.mjs', import.meta.url),
  async drive(page, { step, orchestration }) {
    const composer = selectors.chatComposer(page)
    const messages = selectors.chatMessages(page)
    const chips = composer.locator('[data-chat-input-mention]')
    await selectors.fillChatMessage(page, '')
    await page.keyboard.type('see @package.j', { delay: 30 })
    await page
      .getByRole('option', { name: /package\.json/ })
      .first()
      .waitFor()
    await page.keyboard.press('Enter')
    await chips.first().waitFor()
    match(await selectors.chatPromptText(page), /^see @\S*package\.json$/)
    await step('mention-from-menu')

    // End, then two steps left: the first reaches the chip's end, the second its start.
    await page.keyboard.press('End')
    await page.keyboard.press('ArrowLeft')
    await page.keyboard.press('ArrowLeft')
    await page.keyboard.type('Z')
    match(await selectors.chatPromptText(page), /^see Z@\S*package\.json$/)
    await page.keyboard.press('Backspace')
    await chips.first().waitFor()
    await step('caret-steps-over-chip')

    await page.keyboard.press('End')
    await page.keyboard.press('ArrowLeft')
    await page.keyboard.press('Backspace')
    strictEqual(await selectors.chatPromptText(page), 'see')
    strictEqual(await chips.count(), 0, 'One Backspace takes the whole chip')
    await step('backspace-deletes-chip')

    await selectors.fillChatMessage(page, '')
    await page.keyboard.type('look at @README.md', { delay: 30 })
    await page.keyboard.press('Escape')
    strictEqual(await chips.count(), 0, 'A mention being typed stays text')
    await page.keyboard.type(' now')
    await chips.first().waitFor()
    await step('hand-typed-mention-chips')

    await selectors.fillChatMessage(page, 'say ')
    await imeCommit(page, 'にほん', '日本')
    strictEqual(await selectors.chatPromptText(page), 'say 日本')
    await step('ime-commit')

    // A real clipboard paste: synthesized paste events never insert text.
    const large = 'large pasted log line\n'.repeat(2_000)
    await page.evaluate((text) => navigator.clipboard.writeText(text), large)
    await selectors.fillChatMessage(page, '')
    await page.keyboard.press('Control+V')
    await selectors.chatStagedFile(page, 'pasted-text.txt').waitFor({ timeout: 10_000 })
    strictEqual(await selectors.chatPromptText(page), '', 'A folded paste leaves the prompt empty')
    await step('large-paste-folded')

    await page.keyboard.press('Control+Shift+V')
    await composer.getByText('large pasted log line', { exact: false }).first().waitFor()
    await step('ctrl-shift-v-pastes-inline')

    await page.evaluate((text) => navigator.clipboard.writeText(text), '@package.json')
    await selectors.fillChatMessage(page, 'read')
    await page.keyboard.press('Control+V')
    await chips.first().waitFor()
    strictEqual(await selectors.chatPromptText(page), 'read @package.json')
    await step('pasted-mention-chips')

    await withUserSetting(
      page,
      orchestration,
      { key: 'chat.sendShortcut', value: 'mod-enter' },
      async () => {
        await selectors.fillChatMessage(page, '')
        await page.keyboard.type('first line')
        await page.keyboard.press('Enter')
        await page.keyboard.type('second line with @package.json ')
        match(
          await selectors.chatPromptText(page),
          /^first line\nsecond line with @\S*package\.json$/,
        )
        await step('enter-adds-a-line')
        await page.keyboard.press('Control+Enter')
        await messages.getByText('second line', { exact: false }).waitFor({ timeout: 30_000 })
        await step('ctrl-enter-sent')
      },
    )

    await page.setViewportSize({ width: 390, height: 844 })
    await selectors.fillChatMessage(
      page,
      'on a phone the composer wraps at words and keeps @package.json on one row while it grows',
    )
    await chips.first().waitFor()
    await step('phone-width')
    await selectors.fillChatMessage(page, '')
  },
})

/** What an IME sends: a candidate, then the commit that replaces it. */
async function imeCommit(page: Page, candidate: string, committed: string) {
  const session = await page.context().newCDPSession(page)
  await session.send('Input.imeSetComposition', {
    selectionEnd: candidate.length,
    selectionStart: candidate.length,
    text: candidate,
  })
  await session.send('Input.insertText', { text: committed })
  await session.detach()
}
