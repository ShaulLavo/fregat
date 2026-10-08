import { equal, ok } from 'node:assert/strict'

import { committedFixture, fixtureApiBase, openFixtureWorkspace } from '../fixture-workspace'
import { selectors } from '../selectors'
import type { BrowserContext } from 'playwright'

import type { Scenario } from './index'

/** What the mesh proxy adds for a phone on the tailnet: a client address that is not this host. */
const PHONE_ADDRESS = '100.64.0.9'
const LAPTOP_ADDRESS = '100.64.0.11'
const TABLET_ADDRESS = '100.64.0.10'

/**
 * Pairing a phone: this machine makes a link in Settings › Machines, a phone reaching the machine
 * through the proxy sees the pairing screen naming the machine, opens the link, and joins the
 * paired list; the paired phone then makes a code that pairs a second device. The dev
 * page talks to its API cross-origin, where no cookie rides along, so the phone's app stays on
 * the pairing screen here; in production page and API share an origin, and a real phone is the
 * owner's check.
 */
export const devicePairing: Scenario = {
  name: 'device-pairing',
  description:
    'Settings › Machines makes a pairing link, a phone and a laptop through the proxy see the pairing screen naming the machine, the claimed phone joins the list and makes a code for a second device.',
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

  await showLaptopScreen(page, step, api, origin)

  const phone = await page
    .context()
    .browser()!
    .newContext({
      viewport: { width: 390, height: 844 },
      deviceScaleFactor: 2,
      hasTouch: true,
      isMobile: true,
      userAgent: IPHONE_AGENT,
    })
  try {
    await phone.addInitScript(`window.platformDevServerUrl = ${JSON.stringify(api)}`)
    await forwardAs(phone, api, PHONE_ADDRESS)
    const phonePage = await phone.newPage()
    await phonePage.goto(origin)
    await phonePage
      .getByRole('heading', { name: /^Pair this phone with \S+$/ })
      .waitFor({ timeout: 30_000 })
      .catch(async (error: unknown) => {
        await step('phone-failed', phonePage)
        throw error
      })
    await phonePage.getByText('Settings › Machines › Pair a device').waitFor()
    await phonePage.getByRole('textbox', { name: 'Pairing code' }).fill('abcd efgh')
    await step('phone-unpaired', phonePage)

    // The link itself, as a camera opens it: the boot takes the code out of the address and
    // claims it before anything else asks the machine.
    await phonePage.goto(link)
    await phonePage.waitForURL((url) => !url.hash.includes('token'))
    equal(new URL(phonePage.url()).pathname, '/', 'The pairing path leaves the address too')
    await waitForPairedDevice(api, origin)

    const reused = await phone.request.post(`${api}/pairing/claim`, {
      data: { code, label: 'Another phone' },
      headers: { origin, 'x-forwarded-for': PHONE_ADDRESS },
    })
    equal(reused.status(), 400, 'A code works once')
    await pairNextDevice(api, origin)
  } finally {
    await phone.close()
  }

  await page.reload()
  await selectors.sidebarSettingsButton(page).click()
  await selectors.settingsSearch(page).fill('pair')
  await page.locator('[data-paired-device]').first().waitFor()
  await step('host-devices')
}

/** The paired devices this machine lists, asked as this machine. */
async function pairedLabels(api: string, origin: string) {
  const response = await fetch(`${api}/pairing/devices`, { headers: { origin } })
  const { devices } = (await response.json()) as { devices: { label: string }[] }
  return devices.map((device) => device.label)
}

async function waitForPairedDevice(api: string, origin: string) {
  const deadline = Date.now() + 15_000
  while ((await pairedLabels(api, origin)).length === 0) {
    ok(Date.now() < deadline, 'Opening the link pairs the phone')
    await Bun.sleep(200)
  }
}

const IPHONE_AGENT =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 19_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/19.0 Mobile/15E148 Safari/604.1'

/** Added below the page, as the proxy adds it: a header the page set would need CORS consent. */
async function forwardAs(context: BrowserContext, api: string, address: string) {
  const apiPort = new URL(api).port
  await context.route(
    (url) => url.port === apiPort,
    (route) =>
      route.continue({ headers: { ...route.request().headers(), 'x-forwarded-for': address } }),
  )
}

/** A desktop browser on another machine gets the two-column screen. */
async function showLaptopScreen(
  page: Parameters<Scenario['run']>[0],
  step: Parameters<Scenario['run']>[1]['step'],
  api: string,
  origin: string,
) {
  const laptop = await page
    .context()
    .browser()!
    .newContext({ viewport: { width: 1440, height: 900 } })
  try {
    await laptop.addInitScript(`window.platformDevServerUrl = ${JSON.stringify(api)}`)
    await forwardAs(laptop, api, LAPTOP_ADDRESS)
    const laptopPage = await laptop.newPage()
    await laptopPage.goto(origin)
    await laptopPage
      .getByRole('heading', { name: /^Pair this browser with \S+$/ })
      .waitFor({ timeout: 30_000 })
    await step('laptop-unpaired', laptopPage)
  } finally {
    await laptop.close()
  }
}

/**
 * The paired phone makes a code and a second device claims it, asked over the API as the proxy
 * forwards each device: the dev page's cross-origin requests carry no cookie, as noted above.
 */
async function pairNextDevice(api: string, origin: string) {
  const as = (address: string, cookie?: string) => ({
    origin,
    'content-type': 'application/json',
    'x-forwarded-for': address,
    ...(cookie ? { cookie } : {}),
  })
  const post = (route: string, headers: Record<string, string>, body?: unknown) =>
    fetch(`${api}${route}`, {
      method: 'POST',
      headers,
      body: body === undefined ? null : JSON.stringify(body),
    })

  const hostLink = await fetch(`${api}/pairing/links`, { method: 'POST', headers: { origin } })
  const { code } = (await hostLink.json()) as { code: string }
  const claimed = await post('/pairing/claim', as(PHONE_ADDRESS), {
    code,
    label: 'iPhone · Safari',
  })
  const cookie = (claimed.headers.get('set-cookie') ?? '').split(';')[0]!
  ok(cookie.includes('='), 'Claiming a code sets the device cookie')

  const unpaired = await post('/pairing/links', as(TABLET_ADDRESS))
  equal(unpaired.status, 403, 'An unpaired device cannot make a code')
  const issued = await post('/pairing/links', as(PHONE_ADDRESS, cookie))
  equal(issued.status, 200, 'A paired device makes a code')
  const next = ((await issued.json()) as { code: string }).code
  const tablet = await post('/pairing/claim', as(TABLET_ADDRESS), {
    code: next,
    label: 'iPad · Safari',
  })
  equal(tablet.status, 200, 'The paired phone’s code pairs a second device')
}
