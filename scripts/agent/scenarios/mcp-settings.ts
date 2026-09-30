import { deepStrictEqual, ok } from 'node:assert/strict'
import { selectors } from '../selectors'
import { isolatedNativeScenario, nativeLog } from './native-provider-verification'

/** Plan 174 P3–P4: Settings › MCP servers lists an instance's config, adds through it and deletes. */
export const mcpSettings = isolatedNativeScenario({
  name: 'mcp-settings',
  description:
    'Settings › MCP servers with a fixture Codex: picking the instance lists its user and project servers with status, facts and files; Add server writes an HTTP server through config/batchWrite with a masked header; Delete removes it again; a signed-out server signs in by pasting the address its page ended on, as from a phone.',
  fixture: new URL('../fixtures/native-codex.ts', import.meta.url),
  async drive(page, { root, step }) {
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
