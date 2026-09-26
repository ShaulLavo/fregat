import { equal, ok } from 'node:assert/strict'

import { committedFixture, fixtureApiBase, openFixtureWorkspace } from '../fixture-workspace'
import { selectors } from '../selectors'
import type { Scenario } from './index'

/** What the mesh proxy adds for a phone on the tailnet: a client address that is not this host. */
const PHONE_ADDRESS = '100.64.0.9'

/**
 * Pairing a phone: this machine makes a link in Settings › Machines, a phone reaching the machine
 * through the proxy sees the pairing screen, claims the code, and joins the paired list. The dev
 * page talks to its API cross-origin, where a cookie never rides along, so the claim is made the
 * way the page makes it and the list is read back; the paired phone itself is the owner's check.
 */
export const devicePairing: Scenario = {
  name: 'device-pairing',
  description:
    'Settings › Machines makes a pairing link, a phone through the proxy sees the pairing screen, and the claimed phone joins the list.',
  async run(page, { step }) {
    const fixture = await committedFixture('device-pairing')
    try {
      await pairPhone(page, step, fixture.path)
    } finally {
      await fixture.release()
    }
  },
}

async function pairPhone(
  page: Parameters<Scenario['run']>[0],
  step: Parameters<Scenario['run']>[1]['step'],
  fixture: string,
) {
  await openFixtureWorkspace(page, fixture)
  const api = fixtureApiBase(page)
  const origin = new URL(page.url()).origin

  await selectors.sidebarSettingsButton(page).click()
  await selectors.settingsSearch(page).fill('pair')
  const section = page.locator('[data-pairing-section]')
  await section.getByRole('button', { name: 'Pair a device' }).click()
  const link = (await section.locator('[data-pairing-link]').innerText()).trim()
  const code = new URL(link).hash.replace('#token=', '')
  ok(/^[A-HJ-NP-Z2-9]{12}$/.test(code), `The link carries a code in its fragment: ${link}`)
  await step('host-link')

  const phone = await page
    .context()
    .browser()!
    .newContext({
      viewport: { width: 390, height: 844 },
      deviceScaleFactor: 2,
      hasTouch: true,
      isMobile: true,
    })
  try {
    await phone.addInitScript(`window.platformDevServerUrl = ${JSON.stringify(api)}`)
    // Added below the page, as the proxy adds it: a header the page set would need CORS consent.
    const apiPort = new URL(api).port
    await phone.route(
      (url) => url.port === apiPort,
      (route) =>
        route.continue({
          headers: { ...route.request().headers(), 'x-forwarded-for': PHONE_ADDRESS },
        }),
    )
    const phonePage = await phone.newPage()
    await phonePage.goto(origin)
    await phonePage
      .getByRole('heading', { name: 'Pair this device' })
      .waitFor({ timeout: 30_000 })
      .catch(async (error: unknown) => {
        await step('phone-failed', phonePage)
        throw error
      })
    await phonePage.getByRole('textbox', { name: 'Pairing code' }).fill(code.toLowerCase())
    await step('phone-unpaired', phonePage)

    const claimed = await phone.request.post(`${api}/pairing/claim`, {
      data: { code, label: 'iPhone · Safari' },
      headers: { origin, 'x-forwarded-for': PHONE_ADDRESS },
    })
    equal(claimed.status(), 200, 'The phone claims the code')
    ok(claimed.headers()['set-cookie']?.includes('HttpOnly'), 'The cookie is HttpOnly')
    const reused = await phone.request.post(`${api}/pairing/claim`, {
      data: { code, label: 'Another phone' },
      headers: { origin, 'x-forwarded-for': PHONE_ADDRESS },
    })
    equal(reused.status(), 400, 'A code works once')
  } finally {
    await phone.close()
  }

  await page.reload()
  await selectors.sidebarSettingsButton(page).click()
  await selectors.settingsSearch(page).fill('pair')
  await page.locator('[data-paired-device]').getByText('iPhone · Safari').waitFor()
  await step('host-devices')
}
