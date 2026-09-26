import { notStrictEqual, ok, strictEqual } from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import {
  createModifiedFileFixture,
  openFixtureWorkspace,
  releaseFixture,
} from '../fixture-workspace'
import { chords, openGitPanel, selectors } from '../selectors'
import type { Scenario } from './index'

export const baseComponents: Scenario = {
  name: 'base-components',
  description:
    'Release a discard hold early and nothing happens, hold Space to confirm it, then switch settings scope tabs and sample the indicator mid-glide, and show key chips in a tooltip and the palette.',
  async run(page, { step }) {
    // Never the dev workspace: confirming a discard there destroys real work.
    const fixture = await createModifiedFileFixture(
      'base-components',
      'tracked.txt',
      ['base'],
      ['edited'],
    )
    try {
      await openFixtureWorkspace(page, fixture)
      await openGitPanel(page)
      const tracked = selectors.gitChangeRow(page, 'tracked.txt')
      await tracked.waitFor()
      await page.waitForTimeout(1_000)

      await tracked.hover()
      await selectors.gitFileRowAction(page, 'tracked.txt', 'Discard file').click()
      const dialog = selectors.gitDiscardDialog(page, 'Discard changes in tracked.txt?')
      await dialog.waitFor()
      await page.waitForTimeout(400)
      const confirm = selectors.holdButton(dialog, 'Discard')
      await confirm.hover()
      await page.mouse.down()
      await page.waitForTimeout(500)
      await step('discard-mid-hold')
      await page.mouse.up()
      await page.waitForTimeout(600)
      ok(await dialog.isVisible(), 'An early release must leave the dialog open')
      strictEqual(await readFile(path.join(fixture, 'tracked.txt'), 'utf8'), 'edited\n')
      await step('released-early')

      await confirm.focus()
      await page.keyboard.down(' ')
      await dialog.waitFor({ state: 'hidden' })
      await page.keyboard.up(' ')
      await tracked.waitFor({ state: 'detached' })
      strictEqual(await readFile(path.join(fixture, 'tracked.txt'), 'utf8'), 'base\n')
      await step('space-held')

      await page.keyboard.press('Control+,')
      await selectors.settingsSearch(page).waitFor()
      const indicator = selectors.tabsIndicator(page, 'Settings scope')
      const before = await indicator.evaluate((element) => getComputedStyle(element).translate)
      // A screenshot takes longer than the glide, so the page samples every frame of it.
      const workspace = await selectors.settingsScopeTab(page, 'Workspace').elementHandle()
      const frames = await indicator.evaluate(async (element, tab) => {
        ;(tab as HTMLElement).click()
        const seen: string[] = []
        for (let frame = 0; frame < 30; frame += 1) {
          await new Promise((resolve) => requestAnimationFrame(resolve))
          seen.push(getComputedStyle(element).translate)
        }
        return seen
      }, workspace)
      const after = frames.at(-1)!
      notStrictEqual(after, before, 'The indicator must move to the selected tab')
      const between = frames.filter((value) => value !== before && value !== after)
      ok(between.length > 0, `The indicator must glide, saw ${frames.join(', ')}`)
      await step('scope-indicator-settled')

      await selectors.sidebarSettingsButton(page).hover()
      const hint = selectors.hint(page, 'Settings')
      await hint.waitFor()
      strictEqual(await hint.locator('kbd[data-slot="kbd"]').count(), 1, 'The hint names its key')
      await step('tooltip-key-chip')

      await page.keyboard.press(chords.commandPalette)
      await selectors.paletteInput(page).waitFor()
      await page.keyboard.type('toggle')
      await page.locator('[data-slot="command-shortcut"] kbd').first().waitFor()
      await step('palette-key-chips')
      await page.keyboard.press('Escape')
    } finally {
      await releaseFixture(fixture)
    }
  },
}
