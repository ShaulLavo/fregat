import { ok } from 'node:assert/strict'
import type { Page } from 'playwright'
import type { Scenario } from './index'
import { selectors } from '../selectors'
import { createScriptError } from '../../structured-errors'

/** A local address nothing listens on, so a connect is refused at once. */
async function refusingUrl() {
  const server = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: () => new Response(null) })
  const url = `http://127.0.0.1:${server.port}`
  await server.stop(true)
  return url
}

/** Adds a Remote URL machine through Connect machine and waits for the dialog's error. */
export async function connectRemoteUrl(page: Page, url: string) {
  await selectors.projectMenu(page).click()
  await selectors.connectMachineMenu(page).click()
  const dialog = selectors.machineDialog(page)
  await dialog.waitFor()
  if (await selectors.machineAdd(page).isVisible()) await selectors.machineAdd(page).click()
  await selectors.machineRemoteUrl(page).click()
  await selectors.machineServerUrl(page).fill(url)
  await selectors.machineConnect(page).click()
  const error = selectors.machineDialogError(dialog)
  await error.waitFor({ timeout: 30_000 })
  return { dialog, error }
}

/**
 * Save a machine whose address refuses connections, connect it from the picker, read the
 * error inside the dialog, and hand it to a new chat with Fix with AI.
 */
export const machineConnectError: Scenario = {
  name: 'machine-connect-error',
  description:
    'Save a Remote URL machine that refuses connections, choose it in Connect machine, require its error to fit the dialog, press Fix with AI and find the report in a new chat composer, then add the same address again and require a connect attempt, not a name refusal.',
  async run(page, { step }) {
    const url = await refusingUrl()
    await selectors.windowToolbar(page).waitFor({ timeout: 45_000 })
    // The machine is saved before its first connect, so the refusal still leaves a picker row.
    const seeded = await connectRemoteUrl(page, url)
    await step('seeded')
    await selectors.machineFormCancel(seeded.dialog).click()

    const dialog = selectors.machineDialog(page)
    const row = selectors.machinePickerRows(page).first()
    await row.waitFor({ timeout: 10_000 })
    ok(await row.getAttribute('title'), 'The saved machine row names its machine')
    await step('picker')
    await row.click()
    await selectors.machineDialogError(dialog).waitFor({ timeout: 30_000 })
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
    const readd = await connectRemoteUrl(page, url)
    const readdText = await readd.error.innerText()
    ok(
      !/already|points somewhere else/.test(readdText),
      `Re-adding ${url} was refused: ${readdText}`,
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
