import { strictEqual } from 'node:assert/strict'
import { selectors } from '../selectors'
import {
  isolatedNativeScenario,
  settingsSnapshot,
  writeSettings,
} from './native-provider-verification'

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
      const row = selectors.reasoningDeliveryRow(page)
      strictEqual(await row.count(), 1)
      await row.click()
      const detail = selectors.reasoningDeliveryDetail(page, text).last()
      await detail.waitFor()
      strictEqual(await detail.textContent(), text)
      await step('full-buffered-reasoning-expanded')
      await page.reload()
      await selectors.chatExactText(page, 'RESPONSE_DELIVERY_VERIFIED').waitFor()
      const group = selectors.completedWorkGroup(page)
      if ((await group.getAttribute('aria-expanded')) !== 'true') await group.click()
      const restored = selectors.reasoningDeliveryRow(page)
      if ((await restored.getAttribute('aria-expanded')) !== 'true') await restored.click()
      strictEqual(await selectors.reasoningDeliveryDetail(page, text).last().textContent(), text)
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
