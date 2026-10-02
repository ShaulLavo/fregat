import {
  chooseFixtureFolder,
  createGitFixture,
  fixtureGit,
  releaseFixture,
} from '../fixture-workspace'
import type { Scenario } from './index'

export const webPicker: Scenario = {
  name: 'web-picker',
  description: 'Open a fixture folder through the web picker and verify the selected fixture.',
  requiresIsolatedServer: true,
  async run(page, { step }) {
    const fixture = await createGitFixture('web-picker')
    try {
      await fixtureGit(fixture, ['commit', '--quiet', '-m', 'fixture'])
      await chooseFixtureFolder(page, fixture, () => step('chromium-web-picker'))
      await step('fixture-folder-open')
    } finally {
      try {
        await page.goto('about:blank')
      } finally {
        await releaseFixture(fixture)
      }
    }
  },
}
