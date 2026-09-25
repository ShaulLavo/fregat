import { ok } from 'node:assert/strict'
import { ORCHESTRATION_WS_PROTOCOL_VERSION } from '../../../packages/contracts/src/orchestration-ws'
import { selectors } from '../selectors'
import type { Scenario } from './index'

const running = ORCHESTRATION_WS_PROTOCOL_VERSION - 1

/** A Platform server one protocol behind this client: only /health, with the CORS a browser needs. */
function outdatedServer() {
  const descriptor = {
    ok: true,
    environmentId: crypto.randomUUID(),
    label: 'outdated fixture',
    protocolVersion: running,
    serverVersion: 'fixture',
    platform: { os: 'linux', arch: 'x64' },
  }
  return Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch(request) {
      const headers = {
        'Access-Control-Allow-Origin': request.headers.get('Origin') ?? '*',
        'Access-Control-Allow-Headers': request.headers.get('Access-Control-Request-Headers') ?? '',
        'Access-Control-Allow-Methods': 'GET',
      }
      if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers })
      if (new URL(request.url).pathname !== '/health')
        return new Response(null, { status: 404, headers })
      return Response.json(descriptor, { headers })
    },
  })
}

function requireOutdated(text: string, url: string, where: string) {
  ok(
    text.includes(`speaks protocol ${running}`),
    `${where} does not name protocol ${running}: ${text}`,
  )
  ok(
    text.includes(`Update the Platform server at ${url}`),
    `${where} does not show the fix: ${text}`,
  )
}

/**
 * Add a Remote URL machine whose server speaks the previous protocol through Connect machine,
 * then read the failure where a user meets it: the form, the picker and Settings › Machines.
 */
export const machineProtocolMismatch: Scenario = {
  name: 'machine-protocol-mismatch',
  description:
    'Serve /health one protocol behind this client, add it as a Remote URL machine in Connect machine, and require the form error to name both protocols with the fix, the picker row to read "Server out of date" and repeat the fix on retry, and Settings › Machines to read "Server out of date" with the fix under Details.',
  async run(page, { step }) {
    const server = outdatedServer()
    const url = `http://127.0.0.1:${server.port}`
    try {
      await selectors.windowToolbar(page).waitFor({ timeout: 45_000 })
      await selectors.projectMenu(page).click()
      await selectors.connectMachineMenu(page).click()
      const dialog = selectors.machineDialog(page)
      await dialog.waitFor()
      if (await selectors.machineAdd(page).isVisible()) await selectors.machineAdd(page).click()
      await selectors.machineRemoteUrl(page).click()
      await selectors.machineServerUrl(page).fill(url)
      await selectors.machineConnect(page).click()
      const formError = selectors.machineDialogError(dialog)
      await formError.waitFor({ timeout: 30_000 })
      requireOutdated(await formError.innerText(), url, 'The form error')
      await step('form-error')

      await selectors.machineFormCancel(dialog).click()
      const row = selectors.machinePickerRows(page).first()
      await row.waitFor({ timeout: 10_000 })
      const name = await row.getAttribute('title')
      ok(name, 'The saved machine row names its machine')
      const rowText = await row.innerText()
      ok(rowText.includes('Server out of date'), `The picker row reads: ${rowText}`)
      await step('picker-row')
      await row.click()
      const pickerError = selectors.machineDialogError(dialog)
      await pickerError.waitFor({ timeout: 30_000 })
      requireOutdated(await pickerError.innerText(), url, 'The picker error')
      await step('picker-error')
      await page.keyboard.press('Escape')
      await dialog.waitFor({ state: 'hidden' })

      await page.keyboard.press('Control+,')
      await selectors.settingsSearch(page).fill('machines')
      await selectors.serverOutOfDate(page).waitFor({ timeout: 20_000 })
      await step('settings-row')
      await selectors.machineDetails(page, name).click()
      const popover = selectors.machineDetailsPopover(page, name)
      await popover.waitFor()
      requireOutdated(await popover.innerText(), url, 'Settings › Machines details')
      await step('settings-details')
    } finally {
      await server.stop(true)
    }
  },
}
