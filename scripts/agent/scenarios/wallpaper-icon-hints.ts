import { ok, strictEqual } from 'node:assert/strict'
import type { Page } from 'playwright'
import type { Scenario } from './index'
import { selectors } from '../selectors'
import { serverApi } from '../server-api'

async function userSettings(page: Page, base: string) {
  const response = await page.request.get(`${base}settings`, {
    headers: { Origin: new URL(page.url()).origin },
  })
  ok(response.ok(), 'Read the original user settings')
  const snapshot: unknown = await response.json()
  ok(
    snapshot &&
      typeof snapshot === 'object' &&
      'layers' in snapshot &&
      Array.isArray(snapshot.layers),
  )
  const user: unknown = snapshot.layers.find((layer) => layer.id === 'user')
  ok(user && typeof user === 'object' && 'raw' in user)
  return JSON.stringify(user.raw)
}

async function createWallpaperFixture(page: Page, base: string) {
  const name = `icon-hints-${crypto.randomUUID()}.png`
  const bytes = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAADAAAAAgCAIAAADbtmxLAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAASUlEQVRYhe2WAQkAQAwCF8VoRrnoH2PPOFgAET03NF/drCtAQdGhmiFsWdbxg2CMDtUMYcuyDiF80KJDNUPYssihCMY6HRwe1weCCwBbeEMuXAAAAABJRU5ErkJggg==',
    'base64',
  )
  const response = await page.request.post(`${base}themes/wallpapers`, {
    headers: { Origin: new URL(page.url()).origin },
    multipart: {
      file: { name, mimeType: 'image/png', buffer: Buffer.concat([bytes, Buffer.from(name)]) },
    },
  })
  ok(response.ok(), `Create an unselected wallpaper fixture: ${await response.text()}`)
  const asset: unknown = await response.json()
  ok(asset && typeof asset === 'object' && 'id' in asset && typeof asset.id === 'string')
  ok(/^[a-f0-9]{64}$/.test(asset.id))
  return { id: asset.id, name }
}

export const wallpaperIconHints: Scenario = {
  name: 'wallpaper-icon-hints',
  description:
    'Create an unselected wallpaper fixture, hover its action and open its menu, then remove the fixture and verify settings are unchanged.',
  async run(page, { step }) {
    const { base: api, headers } = serverApi(page)
    const base = `${api}/`
    const before = await userSettings(page, base)
    const fixture = await createWallpaperFixture(page, base)
    try {
      await selectors.workspaceMode(page, 'Workbench').click()
      await page.keyboard.press('Control+,')
      await selectors.settingsSearch(page).fill('wallpaper')
      await selectors.wallpaperTile(page).click()
      const picker = selectors.wallpaperPicker(page)
      await picker.waitFor()
      const actions = selectors.wallpaperActions(page, fixture.name)
      await actions.waitFor({ timeout: 20_000 })
      const label = await actions.getAttribute('aria-label')
      ok(label, 'The uploaded wallpaper must have a named action control')
      await page.mouse.move(0, 0)
      await actions.hover()
      await selectors.hint(page, label).waitFor({ timeout: 3_000 })
      strictEqual(await actions.getAttribute('title'), null)
      await step('wallpaper-actions-hint')
      await actions.click()
      await selectors.menuItem(page, 'Delete').waitFor()
      await step('wallpaper-actions-menu')
      await page.keyboard.press('Escape')
      await selectors.wallpaperClose(page).click()
      await picker.waitFor({ state: 'hidden' })
      await step('wallpaper-picker-closed')
    } finally {
      const response = await page.request.post(`${base}themes/wallpapers/${fixture.id}/delete`, {
        headers,
      })
      ok(response.ok(), `Remove the verification wallpaper: ${await response.text()}`)
      strictEqual(
        await userSettings(page, base),
        before,
        'Wallpaper hint inspection must leave settings unchanged',
      )
    }
    await step('fixture-removed-settings-unchanged')
  },
}
