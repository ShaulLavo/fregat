import { strictEqual } from 'node:assert/strict'
import type { Page } from 'playwright'
import { selectors } from '../selectors'
import {
  isolatedNativeScenario,
  settingsSnapshot,
  writeSettings,
} from './native-provider-verification'

// Markdown renders the reasoning as paragraphs, so compare the words, not the whitespace.
const words = (text: string) => text.replace(/\s+/g, ' ').trim()

/** Opens the one reasoning row, which may already be open, and returns its rendered text. */
async function expandedReasoning(page: Page) {
  const row = selectors.reasoningRows(page).getByRole('button')
  await row.first().waitFor()
  strictEqual(await row.count(), 1)
  if ((await row.getAttribute('aria-expanded')) !== 'true') await row.click()
  const detail = selectors.reasoningDetail(page)
  await detail.waitFor()
  return words(await detail.innerText())
}

export const responseDelivery = isolatedNativeScenario({
  name: 'response-delivery',
  description:
    'A native reasoning stream retains all buffered content in its expanded activity and completes the assistant response.',
  fixture: new URL('../fixtures/native-codex.mjs', import.meta.url),
  async drive(page, { step, orchestration }) {
    const base = orchestration.replace(/\/orchestration$/, '')
    const before = await settingsSnapshot(page, base)
    const key = 'chat.responseStreamingMode'
    const previous = before.layers.find((layer) => layer.id === 'user')?.raw?.[key]
    try {
      await writeSettings(page, base, [{ kind: 'set', key, value: 'paragraph' }])
      await selectors
        .chatMessage(page)
        .fill('Verify buffered response and full reasoning retention.')
      await selectors.chatSend(page).click()
      await selectors.chatExactText(page, 'RESPONSE_DELIVERY_VERIFIED').waitFor({ timeout: 30_000 })
      await selectors.completedWorkGroup(page).click()
      const text =
        'REASONING_BEGIN ' +
        'Full retained reasoning. '.repeat(20) +
        '\n\n' +
        'REASONING_END ' +
        'Final retained detail. '.repeat(20)
      strictEqual(await expandedReasoning(page), words(text))
      await step('full-buffered-reasoning-expanded')
      await page.reload()
      await selectors.chatExactText(page, 'RESPONSE_DELIVERY_VERIFIED').waitFor()
      const group = selectors.completedWorkGroup(page)
      if ((await group.getAttribute('aria-expanded')) !== 'true') await group.click()
      strictEqual(await expandedReasoning(page), words(text))
      await step('buffered-reasoning-retained-after-reload')
    } finally {
      await writeSettings(page, base, [
        previous === undefined
          ? { kind: 'reset', keys: [key] }
          : { kind: 'set', key, value: previous },
      ])
    }
  },
})
