import { ok } from 'node:assert/strict'
import type { Locator, Page } from 'playwright'
import { selectors } from './selectors'

/** Reload only the disabled setup; enable and catalogue selection stay on the same document. */
export async function openDisabledCatalogSettings(
  page: Page,
  providerInstanceId: string,
  label: string,
) {
  await page.reload()
  await selectors.windowToolbar(page).waitFor()
  await page.keyboard.press('Control+,')
  await selectors.settingsSearch(page).fill('providers')
  await selectors.settingsProviderRow(page, providerInstanceId).waitFor()
  const toggle = selectors.settingsSwitch(page, `Enable ${label}`)
  ok(
    (await toggle.getAttribute('aria-checked')) === 'false',
    'The fixture starts disabled in Settings',
  )
  return toggle
}

/** Drive the switch and verify the exact provider enable intent sent by Settings. */
export async function enableCatalogFixture(
  page: Page,
  base: string,
  providerInstanceId: string,
  toggle: Locator,
) {
  const settingsWrite = page.waitForResponse(
    (response) =>
      response.url() === `${base}/settings/write` &&
      response.request().method() === 'POST' &&
      response.ok(),
  )
  await toggle.click()
  const written = await settingsWrite
  ok(
    written
      .request()
      .postDataJSON()
      .operations.some(
        (operation: { kind: string; providerInstanceId?: string; enabled?: boolean }) =>
          operation.kind === 'provider.setEnabled' &&
          operation.providerInstanceId === providerInstanceId &&
          operation.enabled === true,
      ),
    'Settings UI submits the fixture enable operation',
  )
}
