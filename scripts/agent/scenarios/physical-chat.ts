import { strictEqual } from 'node:assert/strict'
import { selectors } from '../selectors'
import { isolatedNativeScenario, writeSettings } from './native-provider-verification'

export const physicalChat = isolatedNativeScenario({
  name: 'physical-chat',
  description:
    'Stream a fixture response with physical feel and verify scrolling never replays a timeline entrance.',
  fixture: new URL('../fixtures/native-codex.mjs', import.meta.url),
  async drive(page, { step, orchestration }) {
    const base = orchestration.replace(/\/orchestration$/, '')
    const feel = process.env.PHYSICAL_BASELINE === '1' ? 'flat' : 'playful'
    await writeSettings(page, base, [{ kind: 'set', key: 'workbench.feel', value: feel }])
    await page.waitForFunction((value) => document.documentElement.dataset.feel === value, feel)
    await selectors
      .chatMessage(page)
      .fill(
        'Verify buffered response and full reasoning retention.\n' +
          'A line in the long user message.\n'.repeat(100),
      )
    await selectors.chatSend(page).click()
    await selectors.chatExactText(page, 'RESPONSE_DELIVERY_VERIFIED').waitFor({ timeout: 30_000 })
    await page.waitForTimeout(1200)
    await step('stream-complete')
    const messages = selectors.chatMessages(page)
    const counts = await messages.evaluate(async (element) => {
      let entrances = 0
      const observer = new MutationObserver((records) => {
        entrances += records.filter(
          (record) =>
            record.target instanceof HTMLElement && record.target.hasAttribute('data-entering'),
        ).length
      })
      observer.observe(element, {
        subtree: true,
        attributes: true,
        attributeFilter: ['data-entering'],
      })
      for (const position of [0, element.scrollHeight, 0, element.scrollHeight]) {
        element.scrollTop = position
        await new Promise((resolve) => setTimeout(resolve, 100))
      }
      observer.disconnect()
      return entrances
    })
    strictEqual(counts, 0, 'Virtualized scroll must never replay an entrance')
    await step('scroll-without-entrances')
  },
})
