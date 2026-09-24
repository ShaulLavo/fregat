import { strictEqual } from 'node:assert/strict'
import type { Scenario } from './index'
import { selectors, settleAnimations } from '../selectors'
import { dispatch, openChatShell, readShell } from './chat-verification'

/**
 * The Claude list comes from the running CLI: current models first, retired ones
 * folded under Legacy, and each model's options from its own row. Picking a model
 * moves the project's default, so the scenario puts the original back.
 */
export const chatClaudeCatalog: Scenario = {
  name: 'chat-claude-catalog',
  description:
    'Open the Claude models in the picker, expand Legacy, and read the options of Opus 5.5 and Fable 5.1. Restores the project default model.',
  async run(page, { step }) {
    const shell = await openChatShell(page)
    try {
      await selectors.chatNewSession(page).click()
      const trigger = selectors.modelPickerTrigger(page)
      await trigger.waitFor({ timeout: 20_000 })
      await trigger.click()
      const panel = selectors.modelPickerPanel(page)
      await panel.waitFor({ timeout: 10_000 })
      await selectors.modelPickerProvider(page, 'Claude Code').click()
      await selectors.modelPickerOption(page, 'Opus 5.5').waitFor({ timeout: 20_000 })
      await selectors.modelPickerLegacy(page).waitFor()
      strictEqual(await selectors.modelPickerOption(page, 'Opus 5').count(), 0)
      await settleAnimations(panel)
      await step('claude-current')

      await selectors.modelPickerLegacy(page).click()
      await selectors.modelPickerOption(page, 'Opus 5').waitFor()
      await selectors.modelPickerOption(page, 'Fable 5').waitFor()
      await step('claude-legacy')

      await selectors.modelPickerOption(page, 'Opus 5.5').click()
      await panel.waitFor({ state: 'hidden' })
      await selectors.modelOptions(page).click()
      await selectors.modelOptionChoice(page, 'Fast Mode', 'On').waitFor()
      await selectors.modelOptionChoice(page, 'Context Window', '1M').waitFor()
      await settleAnimations(selectors.popupMenu(page))
      await step('opus-options')
      await page.keyboard.press('Escape')

      await trigger.click()
      await selectors.modelPickerOption(page, 'Fable 5.1').click()
      await panel.waitFor({ state: 'hidden' })
      await selectors.modelOptions(page).click()
      await selectors.modelOptionChoice(page, 'Context Window', '1M').waitFor()
      strictEqual(await page.getByRole('group', { name: 'Fast Mode', exact: true }).count(), 0)
      await settleAnimations(selectors.popupMenu(page))
      await step('fable-options')
      await page.keyboard.press('Escape')
    } finally {
      await dispatch(page, shell.base, {
        type: 'project.meta.update',
        projectId: shell.project.id,
        defaultModelSelection: shell.project.defaultModelSelection,
      })
      const restored = (await readShell(page, shell.base)).projects.find(
        (project) => project.id === shell.project.id,
      )
      strictEqual(
        JSON.stringify(restored?.defaultModelSelection),
        JSON.stringify(shell.project.defaultModelSelection),
      )
    }
  },
}
