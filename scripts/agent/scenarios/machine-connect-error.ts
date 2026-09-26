import { ok } from 'node:assert/strict'
import type { Scenario } from './index'
import { selectors } from '../selectors'
import { createScriptError } from '../../structured-errors'

/**
 * Connect a saved machine that refuses (blocked, offline or a protocol mismatch),
 * read the error inside the dialog, and hand it to a new chat with Fix with AI.
 */
export const machineConnectError: Scenario = {
  name: 'machine-connect-error',
  description:
    'Choose a saved machine in Connect machine, require its error to fit the dialog, press Fix with AI and find the report in a new chat composer, then add the same address again and require a connect attempt, not a name refusal.',
  async run(page, { step }) {
    await selectors.projectMenu(page).click()
    await selectors.connectMachineMenu(page).click()
    const dialog = selectors.machineDialog(page)
    await dialog.waitFor()
    const rows = selectors.machinePickerRows(page)
    if ((await rows.count()) === 0) {
      await step('no-saved-machine')
      return
    }
    await step('picker')
    const target = await rows.first().getAttribute('title')
    ok(target, 'The saved machine row names its machine')
    await rows.first().click()
    const alert = selectors.machineDialogError(dialog)
    await alert.waitFor({ timeout: 30_000 })
    await step('connect-error')
    const overflow = await dialog.evaluate((element) => element.scrollWidth - element.clientWidth)
    ok(overflow <= 0, `The dialog scrolls sideways by ${overflow}px`)

    await selectors.fixWithAi(dialog).click()
    await dialog.waitFor({ state: 'hidden', timeout: 5_000 })
    await page
      .waitForFunction(
        () =>
          document
            .querySelector('[role="textbox"][aria-label="Message"]')
            ?.textContent?.includes('title: Connect machine'),
        undefined,
        { timeout: 20_000 },
      )
      .catch(() => {
        throw createScriptError('Fix with AI did not put the report in a chat composer')
      })
    await step('fix-draft')

    // Adding the saved machine's own address again connects it instead of refusing its name.
    await selectors.projectMenu(page).click()
    await selectors.connectMachineMenu(page).click()
    await selectors.machineAdd(page).click()
    await selectors.machineTarget(page).fill(target)
    await selectors.machineConnect(page).click()
    const readd = selectors.machineDialogError(selectors.machineDialog(page))
    await readd.waitFor({ timeout: 30_000 })
    const readdText = await readd.innerText()
    ok(
      !/already|points somewhere else/.test(readdText),
      `Re-adding ${target} was refused: ${readdText}`,
    )
    await step('readd-connects')
  },
  inspect: async (page) => ({
    composer: (
      await selectors
        .chatMessage(page)
        .innerText()
        .catch(() => '')
    ).slice(0, 400),
  }),
}
