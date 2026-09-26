import { deepEqual } from 'node:assert/strict'
import type { Page } from 'playwright'
import { runPaletteCommand, selectors } from '../selectors'
import { serverApi } from '../server-api'
import type { Scenario } from './index'

async function settings(page: Page) {
  const { base, headers } = serverApi(page)
  const document = await (await page.request.get(`${base}/settings`, { headers })).json()
  return document.layers.find((layer: { id: string }) => layer.id === 'user')?.raw ?? {}
}

async function holdPost(page: Page, endpoint: RegExp) {
  const arrived = Promise.withResolvers<void>()
  const release = Promise.withResolvers<void>()
  await page.route(endpoint, async (route) => {
    if (route.request().method() !== 'POST') return route.continue()
    arrived.resolve()
    await release.promise
    await route.continue()
  })
  return {
    arrived: arrived.promise,
    release: release.resolve,
    remove: () => page.unroute(endpoint),
  }
}

async function editAccent(page: Page) {
  await selectors.themeStudioTab(page, 'Colors').click()
  const accent = selectors.themeStudio(page).getByRole('textbox', { name: 'Accent', exact: true })
  await accent.fill('#d33682')
  await accent.press('Enter')
}

export const themeStudioAsync: Scenario = {
  name: 'theme-studio-async',
  description:
    'Complete an upload after changing surfaces and mode; discard while Apply waits for palette storage.',
  async run(page, { step }) {
    await runPaletteCommand(page, 'Theme studio')
    const studio = selectors.themeStudio(page)
    await selectors.themeStudioTab(page, 'Dark').click()
    await editAccent(page)
    await selectors.themeStudioTab(page, 'Wallpaper').click()
    const upload = await holdPost(page, /\/themes\/wallpapers$/)
    const uploaded = page.waitForResponse(
      (response) =>
        response.url().endsWith('/themes/wallpapers') && response.request().method() === 'POST',
    )
    try {
      await studio.getByLabel('Upload wallpapers', { exact: true }).setInputFiles({
        name: 'review-async.png',
        mimeType: 'image/png',
        buffer: Buffer.from(
          'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFklEQVR4nGP8z8DAwMDAxMDAwMDAAAANHQEDasKb6QAAAABJRU5ErkJggg==',
          'base64',
        ),
      })
      await upload.arrived
      await selectors.themeStudioTab(page, 'Surfaces').click()
      await studio.getByRole('button', { name: 'Clear', exact: true }).click()
      await selectors.themeStudioTab(page, 'Light').click()
      upload.release()
      await (await uploaded).finished()
    } finally {
      upload.release()
      await upload.remove()
    }
    await selectors.themeStudioTab(page, 'Wallpaper').click()
    const wallpaper = studio.getByRole('button', { name: 'Select review-async.png', exact: true })
    await wallpaper.waitFor()
    await step('upload-completed-in-current-half')
    const currentModeUploaded = (await wallpaper.getAttribute('aria-pressed')) === 'true'
    await selectors.themeStudioTab(page, 'Dark').click()
    await selectors.themeStudioTab(page, 'Surfaces').click()
    const surfacesRetained =
      (await page.evaluate(() =>
        document.documentElement.style.getPropertyValue('--surface-opacity'),
      )) === '55%'
    await step('surface-edit-retained')
    await studio.getByRole('button', { name: 'Close', exact: true }).click()
    await studio.getByRole('button', { name: 'Close', exact: true }).click()

    const before = await settings(page)
    await runPaletteCommand(page, 'Theme studio')
    await editAccent(page)
    const save = await holdPost(page, /\/themes\/palettes$/)
    try {
      await studio.getByRole('button', { name: 'Apply', exact: true }).click()
      await save.arrived
      await studio.getByRole('button', { name: 'Close', exact: true }).click()
      await studio.getByRole('button', { name: 'Close', exact: true }).click()
      await studio.waitFor({ state: 'detached' })
      const settled = page.waitForResponse(
        (response) =>
          response.url().endsWith('/themes/palettes') && response.request().method() === 'GET',
      )
      save.release()
      await (await settled).finished()
      await step('discarded-pending-apply')
    } finally {
      save.release()
      await save.remove()
    }
    deepEqual(
      { currentModeUploaded, surfacesRetained, settings: await settings(page) },
      {
        currentModeUploaded: true,
        surfacesRetained: true,
        settings: before,
      },
    )
  },
}
