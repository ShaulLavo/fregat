import { strictEqual, ok } from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { selectors } from '../selectors'
import {
  isolatedNativeScenario,
  nativeLog,
  restoreUserSettings,
  settingsSnapshot,
  writeSettings,
} from './native-provider-verification'

export const composerDefaults = isolatedNativeScenario({
  name: 'composer-defaults',
  description:
    'Plan is opt-in and the occupancy meter can be switched off; hiding Plan keeps the preference while the next native turn uses default mode.',
  fixture: new URL('../fixtures/native-titles.mjs', import.meta.url),
  async drive(page, { step, root, orchestration }) {
    const base = orchestration.replace(/\/orchestration$/, '')
    const before = await settingsSnapshot(page, base)
    const keys = ['chat.planModeEnabled', 'chat.contextWindowMeterEnabled'] as const
    const set = (value: boolean) =>
      writeSettings(
        page,
        base,
        keys.map((key) => ({ kind: 'set', key, value })),
      )
    try {
      await writeFile(
        join(root, 'title-control.json'),
        JSON.stringify({ mode: 'success', usage: true }),
      )
      await set(false)
      await selectors.composerModes(page).click()
      await selectors.composerAccess(page).waitFor()
      strictEqual(await selectors.composerPlan(page).count(), 0)
      await selectors.composerAccess(page).press('Escape')
      await selectors.composerAccess(page).waitFor({ state: 'hidden' })
      await selectors.chatMessage(page).fill('/pla')
      strictEqual(await selectors.commandOption(page, '/plan').count(), 0)
      await selectors.chatMessage(page).fill('Show the provider context usage.')
      await selectors.chatSend(page).click()
      await selectors.chatExactText(page, 'TITLE_CONVERSATION_READY').first().waitFor()
      strictEqual(await selectors.contextMeter(page).count(), 0)
      await step('default-plan-and-context-hidden')
      await set(true)
      await selectors.contextMeter(page).first().waitFor()
      await selectors.composerModes(page).click()
      await selectors.composerPlan(page).click()
      await selectors.composerModes(page).filter({ hasText: 'Plan' }).waitFor()
      await selectors.chatMessage(page).fill('/pla')
      await selectors.commandOption(page, '/plan').first().waitFor()
      await page.keyboard.press('Escape')
      await selectors
        .chatMessage(page)
        .fill('Keep the stored Plan preference while hiding the controls.')
      await step('opt-in-plan-and-context-visible')
      await set(false)
      await selectors.contextMeter(page).first().waitFor({ state: 'detached' })
      await set(true)
      await selectors.composerModes(page).filter({ hasText: 'Plan' }).waitFor()
      await set(false)
      await selectors.contextMeter(page).first().waitFor({ state: 'detached' })
      await selectors.chatSend(page).click()
      await selectors.chatExactText(page, 'TITLE_CONVERSATION_READY').nth(1).waitFor()
      for (let attempt = 0; attempt < 50; attempt++) {
        const turns = (await nativeLog(root)).filter(
          (entry) => entry.event === 'conversation-request',
        )
        if (turns.length >= 2) {
          strictEqual(turns.at(-1)?.interactionMode, 'default')
          break
        }
        if (attempt === 49) ok(false, 'Native second turn recorded')
        await Bun.sleep(50)
      }
      await step('retained-preference-and-hidden-mode-sends-default')
    } finally {
      await restoreUserSettings(page, base, before, keys)
    }
  },
})
