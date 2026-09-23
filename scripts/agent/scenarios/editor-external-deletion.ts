import { strictEqual } from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { Scenario } from './index'
import { openFixtureWorkspace, releaseFixture, waitForFileContent } from '../fixture-workspace'
import { chords, focusEditor, openFileByName, selectors } from '../selectors'

export const editorExternalDeletion: Scenario = {
  name: 'editor-external-deletion',
  description:
    'Preserve deleted buffers, retire missing restored tabs, and recreate an explicitly opened missing file.',
  async run(page, { step }) {
    const originalUrl = page.url()
    const fixture = await mkdtemp('/work/tmp/fregat-external-deletion-')
    const target = path.join(fixture, 'retained.txt')
    const tab = selectors.editorTab(page, target.slice(1))
    try {
      await writeFile(target, 'original text')
      await writeFile(path.join(fixture, 'other.txt'), 'another tab')
      await openFixtureWorkspace(page, fixture)
      await openFileByName(page, 'retained.txt')
      await focusEditor(page)
      await step('file-open')
      await rm(target)
      await tab.filter({ hasText: '(deleted)' }).waitFor({ timeout: 15_000 })
      await step('clean-file-retained')
      await openFileByName(page, 'other.txt')
      await tab.click()
      await focusEditor(page)
      await page.keyboard.press('Control+s')
      await tab.filter({ hasNotText: '(deleted)' }).waitFor({ timeout: 15_000 })
      await waitForFileContent(target, 'original text')
      await step('clean-buffer-recreated')
      await page.keyboard.press('Control+End')
      await page.keyboard.insertText(' local edit')
      await rm(target)
      await tab.filter({ hasText: '(deleted)' }).waitFor({ timeout: 15_000 })
      await step('dirty-file-retained')
      await focusEditor(page)
      await page.keyboard.press('Control+s')
      await tab.filter({ hasNotText: '(deleted)' }).waitFor({ timeout: 15_000 })
      await waitForFileContent(target, 'original text local edit')
      await step('dirty-buffer-recreated')
      await rm(target)
      await tab.filter({ hasText: '(deleted)' }).waitFor({ timeout: 15_000 })
      await writeFile(target, 'restored remotely')
      await tab.filter({ hasNotText: '(deleted)' }).waitFor({ timeout: 15_000 })
      await focusEditor(page)
      await page.keyboard.press('Control+End')
      await page.keyboard.insertText('!')
      await page.keyboard.press('Control+s')
      await waitForFileContent(target, 'restored remotely!')
      strictEqual(await readFile(target, 'utf8'), 'restored remotely!')
      await step('remote-recreation-refreshed')
      await rm(target)
      await tab.filter({ hasText: '(deleted)' }).waitFor({ timeout: 15_000 })
      await page.reload()
      await focusEditor(page)
      await tab.waitFor({ state: 'detached', timeout: 15_000 })
      await selectors.editorTab(page, path.join(fixture, 'other.txt').slice(1)).waitFor()
      await step('missing-restored-active-tab-closed')
      await page.reload()
      await focusEditor(page)
      strictEqual(await tab.count(), 0, 'Reload must not restore the missing tab again')
      await step('missing-tab-stays-closed-after-reload')

      await writeFile(target, 'inactive file')
      await openFileByName(page, 'retained.txt')
      await focusEditor(page)
      await openFileByName(page, 'other.txt')
      await rm(target)
      await tab.filter({ hasText: '(deleted)' }).waitFor({ timeout: 15_000 })
      await page.reload()
      await focusEditor(page)
      if (await tab.count()) await tab.hover()
      await tab.waitFor({ state: 'detached', timeout: 15_000 })
      await step('missing-restored-inactive-tab-closed')

      const vanishing = path.join(fixture, 'vanishing.txt')
      await writeFile(vanishing, 'removed before the first read')
      let removed = false
      await page.route('**/fs/read?**', async (route) => {
        const requested = new URL(route.request().url()).searchParams.get('path')
        if (!removed && requested === vanishing.slice(1)) {
          removed = true
          await rm(vanishing)
        }
        await route.continue()
      })
      await page.keyboard.press(chords.commandPalette)
      await selectors.paletteInput(page).fill('vanishing.txt')
      await selectors.commandOption(page, 'vanishing.txt').click()
      await selectors.createMissingFile(page).waitFor({ timeout: 15_000 })
      await step('explicit-missing-file-offers-create')
      await selectors.createMissingFile(page).click()
      await selectors.createMissingFile(page).waitFor({ state: 'detached' })
      await focusEditor(page)
      await waitForFileContent(vanishing, '')
      await step('explicit-missing-file-created')
      await page.unroute('**/fs/read?**')
    } finally {
      await page.goto(originalUrl)
      await releaseFixture(fixture)
    }
  },
}
