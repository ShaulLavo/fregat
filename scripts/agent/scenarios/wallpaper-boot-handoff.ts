import { holdSettingsResponses } from '../hold-settings'
import { strictEqual, ok } from 'node:assert/strict'
import {
  HTML_BOOTSTRAP_ID,
  HTML_BOOTSTRAP_WALLPAPER_IDS,
} from '../../../packages/contracts/src/html-bootstrap'
import { writeUserOperations } from '../preserve-settings'
import { serverApi } from '../server-api'
import type { Scenario } from './index'
import { selectors, waitForApp } from '../selectors'

export const wallpaperBootHandoff: Scenario = {
  name: 'wallpaper-boot-handoff',
  requiresIsolatedServer: true,
  capture: { width: 390, height: 844, touch: true },
  description:
    'The document preloads its selected library image and displays it before a held settings response, using one image transfer.',
  async run(page, { step, evidence }) {
    const { base, headers } = serverApi(page)
    const library = await (await page.request.get(`${base}/themes/wallpapers`, { headers })).json()
    const asset = library.assets[0]
    ok(asset, 'The isolated library contains a known-good wallpaper')
    await writeUserOperations(page, [
      { kind: 'set', key: 'workbench.theme', value: null },
      {
        kind: 'set',
        key: 'workbench.wallpaper',
        value: { enabled: true, source: { kind: 'library', asset: asset.id } },
      },
    ])
    const hold = await holdSettingsResponses(page, base)
    try {
      await page.reload({ waitUntil: 'domcontentloaded' })
      await hold.requested
      await waitForApp(page)
      const image = selectors.wallpaperAsset(page, asset.id)
      await image.waitFor()
      await image.evaluate('image => image.decode()')
      await step('selected-image-visible-settings-held')
      const result = await page.evaluate(
        ({ id, linkId, assetId }) => {
          const payload = JSON.parse(document.getElementById(id)?.textContent ?? 'null')
          const links = [linkId.light, linkId.dark]
            .map((id) => document.getElementById(id))
            .filter((link): link is HTMLElement => link !== null)
          const resources = performance
            .getEntriesByType('resource')
            .filter(
              (entry): entry is PerformanceResourceTiming =>
                entry instanceof PerformanceResourceTiming &&
                entry.name.includes(`${assetId}/display`),
            )
            .map((entry) => ({
              name: entry.name,
              initiator: entry.initiatorType,
              start: entry.startTime,
              end: entry.responseEnd,
              transfer: entry.transferSize,
            }))
          return {
            kind: payload.kind,
            links: links.map((link) => link.getAttribute('href')),
            resources,
          }
        },
        { id: HTML_BOOTSTRAP_ID, linkId: HTML_BOOTSTRAP_WALLPAPER_IDS, assetId: asset.id },
      )
      await evidence.json('wallpaper-html-handoff.json', result)
      strictEqual(result.kind, 'app')
      strictEqual(result.links.length, 1, 'Identical mode images share one preload')
      strictEqual(result.resources.length, 1, 'Preload and rendered image share one transfer')
      strictEqual(result.resources[0]?.initiator, 'link', 'HTML discovers the image')
    } finally {
      hold.resume()
      await hold.close()
    }
  },
}
