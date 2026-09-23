import { ok, strictEqual } from 'node:assert/strict'
import { mkdtemp, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { openFixtureWorkspace, releaseFixture } from '../fixture-workspace'
import { chords, selectors } from '../selectors'
import type { Scenario } from './index'

export const paletteScriptsPending: Scenario = {
  name: 'palette-scripts-pending',
  description: 'Script mode holds its "No scripts" verdict while the manifest read is in flight.',
  async run(page, { step }) {
    const fixture = await mkdtemp('/work/tmp/fregat-palette-scripts-')
    try {
      const manifest = { scripts: { build: 'echo build', test: 'echo test' } }
      await writeFile(path.join(fixture, 'package.json'), JSON.stringify(manifest))
      await openFixtureWorkspace(page, fixture)

      // Hold filesystem reads so the pending window is long enough to observe.
      await page.route(/\/fs\//, async (route) => {
        await new Promise((resolve) => setTimeout(resolve, 1_500))
        await route.continue()
      })
      await page.keyboard.press(chords.commandPalette)
      const input = selectors.paletteInput(page)
      await input.waitFor()
      await input.fill('run ')
      await selectors.paletteScriptsLoading(page).waitFor({ timeout: 1_400 })
      strictEqual(await selectors.paletteNoScripts(page).count(), 0, 'No verdict while pending')
      await step('pending')

      await selectors.paletteOptions(page).filter({ hasText: 'build' }).first().waitFor()
      ok((await selectors.paletteOptions(page).count()) >= 2, 'Manifest scripts must list')
      await step('loaded')
      await page.keyboard.press('Escape')
    } finally {
      await page.unroute(/\/fs\//)
      await releaseFixture(fixture)
    }
  },
}
