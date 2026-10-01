import { writeFile } from 'node:fs/promises'
import path from 'node:path'
import {
  createGitFixture,
  fixtureGit,
  openFixtureWorkspace,
  releaseFixture,
} from '../fixture-workspace'
import { preserveAppearance, writeUserSetting } from '../preserve-settings'
import { chords, selectors } from '../selectors'
import type { Scenario } from './index'

const SAMPLE = ['const first = 1;', 'const second = 2;', 'const third = 3;', '']

export const quickOpenCrlfPreview: Scenario = {
  name: 'quick-open-crlf-preview',
  description:
    'Quick open previews a CRLF TypeScript file; every line starts with a whole coloured `const`. The step label counts lines whose first coloured span is anything else.',
  async run(page, { step }) {
    const fixture = await createGitFixture('crlf-preview')
    const restoreSettings = await preserveAppearance(page, ['search.quickOpenPreview'])
    try {
      await writeUserSetting(page, 'search.quickOpenPreview', true)
      await writeFile(path.join(fixture, 'crlf-sample.ts'), SAMPLE.join('\r\n'))
      await fixtureGit(fixture, ['add', 'crlf-sample.ts'])
      await fixtureGit(fixture, ['commit', '--quiet', '-m', 'fixture'])
      await openFixtureWorkspace(page, fixture)
      await page.keyboard.press(chords.commandPalette)
      const input = selectors.paletteInput(page)
      await input.waitFor({ timeout: 5_000 })
      await input.fill('')
      await page.keyboard.type('crlf-sample.ts', { delay: 40 })
      const text = page.locator(selectors.quickOpenPreviewTextSelector)
      await text.locator('span[style]').first().waitFor()
      const firstSpans = await text
        .locator('code > span')
        .evaluateAll((lines) =>
          lines
            .map((line) => line.querySelector('span[style]')?.textContent ?? '')
            .filter((first) => first.trim().length > 0),
        )
      const misaligned = firstSpans.filter((first) => first !== 'const').length
      await step(`lines-${firstSpans.length}-misaligned-${misaligned}`)
      await page.keyboard.press('Escape')
    } finally {
      await restoreSettings()
      await releaseFixture(fixture)
    }
  },
}
