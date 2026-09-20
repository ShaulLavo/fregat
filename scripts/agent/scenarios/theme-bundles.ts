import { readFile } from 'node:fs/promises'
import { ok, strictEqual } from 'node:assert/strict'
import type { Page } from 'playwright'
import * as v from 'valibot'
import {
  GRAPHITE_PALETTE_DOCUMENT,
  themeBundleSchema,
  wallpaperAssetSchema,
} from '../../../packages/contracts/src/index'
import { wallpaperPng, secondWallpaperPng } from '../../../apps/web/test/factories/wallpaper'
import { preserveAppearance } from '../preserve-settings'
import { chords, selectors, runPaletteCommand } from '../selectors'
import type { Scenario } from './index'

async function mode(page: Page, value: 'light' | 'dark' | 'system') {
  await page.keyboard.press(chords.commandPalette)
  await selectors.paletteInput(page).fill('>Choose light / dark mode')
  await selectors.commandOption(page, 'Choose light / dark mode').click()
  await selectors.colorModeOption(page, value).click()
  await selectors.paletteInput(page).waitFor({ state: 'hidden' })
}
async function wallpaper(page: Page, id: string) {
  await selectors.wallpaperAsset(page, id).waitFor()
}

export const themeBundles: Scenario = {
  name: 'theme-bundles',
  description:
    'Select paired wallpapers, customize one mode, reload, follow system mode, cancel a preview, create a bundle and restore the original settings.',
  async run(page, { step }) {
    const url = new URL(page.url())
    const base = url.pathname.startsWith('/platform/')
      ? `${url.origin}/platform`
      : 'http://localhost:3001'
    const headers = { origin: url.origin }
    const restore = await preserveAppearance(page)
    const existing = await (await page.request.get(`${base}/themes/wallpapers`, { headers })).json()
    const initialIds = new Set(
      v.parse(v.array(wallpaperAssetSchema), existing.assets).map((asset) => asset.id),
    )
    const ownedAssets: string[] = []
    const ownedThemes: string[] = []
    const createId = `verify-117-${crypto.randomUUID()}`
    try {
      const assets = []
      for (const [index, bytes] of [wallpaperPng(), secondWallpaperPng()].entries()) {
        const upload = await page.request.post(`${base}/themes/wallpapers`, {
          headers,
          multipart: {
            file: {
              name: `bundle-verification-${index}.png`,
              mimeType: 'image/png',
              buffer: bytes,
            },
          },
        })
        ok(upload.ok(), 'Upload verification wallpaper')
        const asset = v.parse(wallpaperAssetSchema, await upload.json())
        assets.push(asset)
        if (!initialIds.has(asset.id)) ownedAssets.push(asset.id)
      }
      const library = v.parse(
        v.array(themeBundleSchema),
        await (await page.request.get(`${base}/themes/bundles`, { headers })).json(),
      )
      const foundation = library.find((theme) => theme.id === 'graphite')!
      const response = await page.request.post(`${base}/themes/bundles`, {
        headers,
        data: {
          schemaVersion: 1,
          id: createId,
          name: 'Verification · Day and night',
          variants: {
            light: {
              ...foundation.variants.light,
              palette: 'sage',
              wallpaper: { enabled: true, source: { kind: 'library', asset: assets[0]!.id } },
            },
            dark: {
              ...foundation.variants.dark,
              wallpaper: { enabled: true, source: { kind: 'library', asset: assets[1]!.id } },
            },
          },
        },
      })
      ok(response.ok(), 'Create paired fixture')
      ownedThemes.push(createId)
      await page.keyboard.press('Control+,')
      await selectors.settingsSearch(page).fill('Theme bundles')
      await selectors.themeCard(page, createId).click()
      await mode(page, 'dark')
      await wallpaper(page, assets[1]!.id)
      await step('dark-wallpaper')
      await mode(page, 'light')
      await wallpaper(page, assets[0]!.id)
      await step('light-wallpaper')
      await hideLightWallpaper(page, assets[1]!.id)
      await step('dark-unaffected-by-light-customization')
      await mode(page, 'light')
      await selectors.wallpaperStill(page).waitFor({ state: 'detached' })
      await page.reload()
      await selectors.windowToolbar(page).waitFor()
      strictEqual(await selectors.wallpaperStill(page).count(), 0)
      await step('reload-customized-light')
      await mode(page, 'system')
      await page.emulateMedia({ colorScheme: 'dark' })
      await wallpaper(page, assets[1]!.id)
      await step('system-dark')
      await page.emulateMedia({ colorScheme: 'light' })
      await selectors.wallpaperStill(page).waitFor({ state: 'detached' })
      await step('system-light')
      await runPaletteCommand(page, 'Toggle wallpaper')
      await selectors.paletteInput(page).waitFor({ state: 'hidden' })
      await wallpaper(page, assets[0]!.id)
      await step('reenabled-light-restores-image')
      await hideLightWallpaper(page, assets[1]!.id)
      await selectors.settingsSearch(page).fill('Theme bundles')
      await page.keyboard.press('Tab')
      await selectors.themeCard(page, 'sage').focus()
      await selectors.wallpaperStill(page).waitFor({ state: 'detached' })
      await step('preview-sage')
      await page.keyboard.press('Escape')
      await wallpaper(page, assets[1]!.id)
      await step('escape-restores-bundle')
      await selectors.themeAction(page, 'New from current').click()
      await selectors.themeName(page).fill('Verification · Created in UI')
      await selectors.themeAction(page, 'Dark version').click()
      await step('create-both-variants')
      const applied = page.waitForResponse(
        (response) =>
          response.url().endsWith('/settings/write') &&
          response.request().method() === 'POST' &&
          response.ok(),
      )
      await selectors.themeAction(page, 'Save and apply').click()
      await applied
      await selectors.themeEditor(page).waitFor({ state: 'hidden' })
      const saved = await (await page.request.get(`${base}/settings`, { headers })).json()
      const theme = v.parse(themeBundleSchema, saved.values['workbench.theme'])
      ownedThemes.push(theme.id)
      strictEqual(theme.name, 'Verification · Created in UI')
      strictEqual(theme.variants.light.wallpaper.enabled, false)
      strictEqual(theme.variants.dark.wallpaper.enabled, true)
      await wallpaper(page, assets[1]!.id)
      await step('created-and-applied')
      const downloading = page.waitForEvent('download')
      await selectors.themeAction(page, 'Export theme').click()
      const download = await downloading
      const archive = await download.path()
      ok(archive, 'Export produces a downloadable archive')
      const choosing = page.waitForEvent('filechooser')
      await selectors.themeAction(page, 'Import theme').click()
      const importedSelection = page.waitForResponse(
        (response) =>
          response.url().endsWith('/settings/write') &&
          response.request().method() === 'POST' &&
          response.ok(),
      )
      const portable = JSON.parse(await readFile(archive, 'utf8'))
      portable.theme.variants.dark.palette = 'verification-private'
      portable.palettes = [
        {
          ...GRAPHITE_PALETTE_DOCUMENT,
          id: 'verification-private',
          name: 'Verification private colors',
        },
      ]
      await (
        await choosing
      ).setFiles({
        name: 'private.platform-theme.json',
        mimeType: 'application/json',
        buffer: Buffer.from(JSON.stringify(portable)),
      })
      await importedSelection
      const importedSettings = await (
        await page.request.get(`${base}/settings`, { headers })
      ).json()
      const imported = v.parse(themeBundleSchema, importedSettings.values['workbench.theme'])
      ownedThemes.push(imported.id)
      ok(imported.id !== theme.id, 'Import creates a copy without replacing the source')
      strictEqual(imported.variants.light.wallpaper.enabled, false)
      await wallpaper(page, assets[1]!.id)
      await step('exported-imported-and-applied')
      await selectors.settingsSearch(page).fill('App colors')
      await selectors.paletteActions(page, 'Verification private colors').click()
      await selectors.paletteMenuAction(page, 'Customize a copy…').waitFor()
      strictEqual(await selectors.paletteMenuAction(page, 'Customize…').count(), 0)
      strictEqual(await selectors.paletteMenuAction(page, 'Delete').count(), 0)
      await step('embedded-palette-copy-action')
      await page.keyboard.press('Escape')
    } finally {
      await restore()
      for (const id of ownedThemes)
        ok(
          (await page.request.post(`${base}/themes/bundles/${id}/delete`, { headers })).ok(),
          'Clean up verification bundle',
        )
      for (const id of ownedAssets)
        ok(
          (await page.request.post(`${base}/themes/wallpapers/${id}/delete`, { headers })).ok(),
          'Clean up verification wallpaper',
        )
    }
  },
}

async function hideLightWallpaper(page: Page, darkAsset: string) {
  await runPaletteCommand(page, 'Toggle wallpaper')
  await selectors.paletteInput(page).waitFor({ state: 'hidden' })
  await selectors.wallpaperStill(page).waitFor({ state: 'detached' })
  await mode(page, 'dark')
  await wallpaper(page, darkAsset)
}
