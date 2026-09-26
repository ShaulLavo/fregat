import { ok } from 'node:assert/strict'
import type { Page } from 'playwright'
import { selectors } from '../selectors'
import { isolatedNativeScenario } from './native-provider-verification'

export const chatMarkdownFence = isolatedNativeScenario({
  name: 'chat-markdown-fence',
  description:
    'An assistant message with a fenced ts block paints more than one token colour once Shiki loads.',
  fixture: new URL('../fixtures/native-codex.mjs', import.meta.url),
  async drive(page, { step }) {
    await selectors.fillChatMessage(page, 'Reply with a fenced TypeScript block.')
    await selectors.chatSend(page).click()
    const body = selectors.chatCodeBlockBody(page, 'ts')
    await body.getByText(/MARKDOWN_FENCE_VERIFIED/).waitFor({ timeout: 30_000 })
    const colors = await waitForTokenColors(page)
    ok(colors.length > 1, `Expected several token colours in the fence, found ${colors.join(', ')}`)
    await step('fence-highlighted')
  },
})

// The fence renders plain text first and swaps in tokens when the lazy Shiki chunks resolve.
async function waitForTokenColors(page: Page) {
  let colors: readonly string[] = []
  for (let attempt = 0; attempt < 60; attempt += 1) {
    colors = await fenceTokenColors(page)
    if (colors.length > 1) return colors
    await page.waitForTimeout(250)
  }
  return colors
}

function fenceTokenColors(page: Page) {
  return selectors
    .chatCodeBlockBody(page, 'ts')
    .last()
    .evaluate((pre) => {
      const tokens = pre.querySelectorAll('code > span > span')
      return [...new Set([...tokens].map((token) => getComputedStyle(token).color))].sort()
    })
}
