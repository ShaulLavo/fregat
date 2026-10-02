import {
  chooseFixtureFolder,
  createGitFixture,
  fixtureGit,
  releaseFixture,
} from '../fixture-workspace'
import type { Scenario } from './index'
import { observePolaronTerminal } from '../polaron-continuity'

export const polaronWebPicker: Scenario = {
  name: 'polaron-web-picker',
  description:
    'Open a fixture folder through the web picker and preserve the existing terminal across owned desktop windows.',
  requiresIsolatedServer: true,
  async run(page, { step, evidence }) {
    const fixture = await createGitFixture('polaron-picker')
    let continuity: Awaited<ReturnType<typeof observePolaronTerminal>> | undefined
    try {
      continuity = await observePolaronTerminal(page)
      await fixtureGit(fixture, ['commit', '--quiet', '-m', 'fixture'])
      await chooseFixtureFolder(page, fixture, () => step('chromium-web-picker'))
      await step('fixture-folder-open')
      await continuity.prove(fixture, evidence, step)
    } finally {
      try {
        await page.goto('about:blank')
        await continuity?.dispose()
      } finally {
        await releaseFixture(fixture)
      }
    }
  },
}
