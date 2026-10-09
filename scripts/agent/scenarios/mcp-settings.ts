import { deepStrictEqual, equal, ok } from 'node:assert/strict'
import type { Page } from 'playwright'
import * as v from 'valibot'
import { providerInstanceIdSchema } from '../../../packages/contracts/src/index'
import { selectors } from '../selectors'
import {
  isolatedNativeScenario,
  nativeLog,
  settingsSnapshot,
  writeRawSetting,
} from './native-provider-verification'

/** Settings MCP configuration through an isolated provider fixture. */
export const mcpSettings = isolatedNativeScenario({
  name: 'mcp-settings',
  description:
    'Settings › MCP servers with a fixture Codex: picking the instance lists its user and project servers with status, facts and files; delayed provider and folder switches keep action ownership and reset open dialogs after readiness; Add server writes an HTTP server through config/batchWrite with a masked header; Delete removes it again; a signed-out server signs in by pasting the address its page ended on, as from a phone.',
  fixture: new URL('../fixtures/native-codex.mjs', import.meta.url),
  async drive(page, { root, step, orchestration, providerInstanceId }) {
    await selectors.sidebarSettingsButton(page, 'Chat').click()
    await selectors.settingsSearch(page).fill('mcp')
    const section = selectors.mcpSettings(page)
    await section.getByText('Choose a provider to list its MCP servers').waitFor()
    await step('mcp-page')

    await section.getByRole('tab', { name: /mcp-settings verification/ }).click()
    await selectors.mcpSettingsRow(page, 'linear').waitFor({ timeout: 30_000 })
    await selectors
      .mcpSettingsRow(page, 'linear')
      .getByText('User · https://mcp.linear.app · 2 tools')
      .waitFor()
    await selectors.mcpSettingsRow(page, 'broken').getByText('Failed').waitFor()
    await step('listed')
    await verifySubjectSwitches(page, { root, step, orchestration, providerInstanceId })

    await section.getByRole('button', { name: 'Add server' }).click()
    const dialog = page.getByRole('dialog', { name: /Add an MCP server/ })
    await dialog.getByLabel('Name').fill('docs')
    await dialog.getByRole('tab', { name: 'HTTP' }).click()
    await dialog.getByLabel('Server address').fill('https://docs.example.test/mcp')
    await dialog.getByRole('button', { name: 'Add header' }).click()
    await dialog.getByLabel('Headers name 1').fill('Authorization')
    await dialog.getByLabel('Headers value 1').fill('Bearer scenario')
    await step('add-dialog')
    await dialog.getByRole('button', { name: 'Add server' }).click()
    await selectors.mcpSettingsRow(page, 'docs').waitFor({ timeout: 30_000 })
    await step('added')

    await selectors.mcpSettingsRow(page, 'docs').getByRole('button', { name: 'Remove' }).click()
    await page
      .getByRole('dialog', { name: 'Delete docs?' })
      .getByRole('button', { name: /Delete/ })
      .click()
    await selectors.mcpSettingsRow(page, 'docs').waitFor({ state: 'detached', timeout: 30_000 })
    await step('removed')

    // A phone: the page ends on the server's loopback, which the phone cannot load, so the
    // address it ended on is pasted back.
    const sentry = selectors.mcpSettingsRow(page, 'sentry')
    await sentry.getByRole('button', { name: 'Sign in' }).click()
    const pageLink = sentry.getByRole('link', { name: 'Open sign-in page for sentry' })
    const authorizationUrl = await pageLink.getAttribute('href')
    ok(authorizationUrl, 'The sign-in page link carries an address')
    const ended = await page.request.get(authorizationUrl, { maxRedirects: 0 })
    const callbackUrl = ended.headers().location
    ok(callbackUrl, 'The sign-in page redirects to the loopback callback')
    await sentry.getByLabel(/Paste that address here/).fill(callbackUrl)
    await step('sign-in-paste')
    await sentry.getByRole('button', { name: 'Finish' }).click()
    await sentry.getByText('Connected').waitFor({ timeout: 30_000 })
    await step('signed-in')

    const callbacks = (await nativeLog(root)).filter((entry) => entry.event === 'oauth-callback')
    deepStrictEqual(
      callbacks.map((entry) => [entry.name, entry.success]),
      [['sentry', true]],
    )
    const writes = (await nativeLog(root)).filter((entry) => entry.event === 'config/batchWrite')
    deepStrictEqual(
      writes.map((entry) => entry.edits),
      [
        [{ keyPath: 'mcp_servers.docs', deletes: false }],
        [{ keyPath: 'mcp_servers.docs', deletes: true }],
      ],
    )
  },
})

async function holdMcpRead(page: Page, providerInstanceId: string, folder: string | null) {
  const reached = Promise.withResolvers<void>()
  const release = Promise.withResolvers<void>()
  const completed: Promise<void>[] = []
  const routeMatch = new RegExp(`/providers/${providerInstanceId}/mcp(?:\\?|$)`)
  await page.route(routeMatch, async (route) => {
    const request = route.request()
    if (
      request.method() !== 'GET' ||
      new URL(request.url()).searchParams.get('folder') !== folder
    ) {
      await route.continue()
      return
    }
    const response = await route.fetch()
    const done = Promise.withResolvers<void>()
    completed.push(done.promise)
    reached.resolve()
    try {
      await release.promise
      await route.fulfill({ response })
    } finally {
      done.resolve()
    }
  })
  return {
    reached: reached.promise,
    release: () => release.resolve(),
    close: async () => {
      release.resolve()
      await Promise.all(completed)
      await page.unroute(routeMatch)
    },
  }
}

async function verifySubjectSwitches(
  page: Page,
  context: {
    readonly root: string
    readonly step: (name: string) => Promise<void>
    readonly orchestration: string
    readonly providerInstanceId: string
  },
) {
  const base = context.orchestration.replace(/\/orchestration$/, '')
  const snapshot = await settingsSnapshot(page, base)
  const first = snapshot.values['providers.instances'].find(
    (provider) => provider.providerInstanceId === context.providerInstanceId,
  )
  ok(first, 'The first fixture provider exists')
  const second = {
    ...first,
    providerInstanceId: v.parse(providerInstanceIdSchema, `verify-${crypto.randomUUID()}`),
    displayLabel: 'MCP second fixture',
  }
  await writeRawSetting(
    page,
    base,
    'providers.instances',
    snapshot.values['providers.instances'].concat(second),
  )
  try {
    await verifyProviderSwitch(page, second.providerInstanceId, context.step)
  } finally {
    await writeRawSetting(page, base, 'providers.instances', snapshot.values['providers.instances'])
  }
  await verifyFolderSwitch(page, context)
}

async function verifyProviderSwitch(
  page: Page,
  providerInstanceId: string,
  step: (name: string) => Promise<void>,
) {
  const section = selectors.mcpSettings(page)
  const firstLabel = (await section.getByRole('tab', { selected: true }).textContent())!.trim()
  const selected = section.getByRole('tab', { name: firstLabel, exact: true })
  const held = await holdMcpRead(page, providerInstanceId, null)
  try {
    await section.getByRole('tab', { name: 'MCP second fixture' }).click()
    await held.reached
    equal(
      await selected.getAttribute('aria-selected'),
      'true',
      'The held provider tab still owns the displayed records',
    )
    await selectors.mcpSettingsRow(page, 'linear').getByRole('button', { name: 'Remove' }).click()
    const dialog = page.getByRole('dialog', { name: 'Delete linear?' })
    await dialog.waitFor()
    ok(
      (await dialog.textContent())?.includes(firstLabel),
      'The removal dialog still names the held provider',
    )
    await step('held-provider-remove-dialog')
    held.release()
    await section.getByRole('tab', { name: 'MCP second fixture', selected: true }).waitFor()
    await dialog.waitFor({ state: 'detached' })
    await selectors.mcpSettingsRow(page, 'linear').waitFor()
    await step('provider-ready-dialog-reset')
    await section.getByRole('tab', { name: firstLabel }).click()
    await section.getByRole('tab', { name: firstLabel, selected: true }).waitFor()
  } finally {
    await held.close()
  }
}

async function verifyFolderSwitch(
  page: Page,
  context: {
    readonly root: string
    readonly providerInstanceId: string
    readonly step: (name: string) => Promise<void>
  },
) {
  const section = selectors.mcpSettings(page)
  const held = await holdMcpRead(page, context.providerInstanceId, context.root.replace(/^\//, ''))
  try {
    await section.getByRole('button', { name: 'Choose folder…' }).click()
    const picker = selectors.pickerDialog(page)
    await picker.waitFor()
    await selectors.pickerGoToFolder(page).click()
    await selectors.pickerFolderPath(page).fill(context.root)
    await selectors.pickerFolderPath(page).press('Enter')
    await selectors.pickerFolderPath(page).waitFor({ state: 'hidden' })
    await picker.getByRole('button', { name: 'Open', exact: true }).click()
    await held.reached
    await section.getByText('Home folder', { exact: true }).waitFor()
    await section.getByRole('button', { name: 'Add server' }).click()
    const dialog = page.getByRole('dialog', { name: /Add an MCP server/ })
    await dialog.getByLabel('Name').fill('held-draft')
    await context.step('held-folder-add-dialog')
    held.release()
    await selectors
      .mcpSettingsFolder(page)
      .filter({ hasText: context.root.replace(/^\//, '') })
      .waitFor()
    await dialog.waitFor({ state: 'detached' })
    await section.getByRole('button', { name: 'Add server' }).click()
    equal(
      await dialog.getByLabel('Name').inputValue(),
      '',
      'The new folder starts a fresh add draft',
    )
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
    await context.step('folder-ready-dialog-reset')
  } finally {
    await held.close()
  }
}
