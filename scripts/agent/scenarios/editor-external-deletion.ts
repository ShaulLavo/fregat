import { strictEqual } from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { Scenario } from './index'
import { openFixtureWorkspace, releaseFixture, waitForFileContent } from '../fixture-workspace'
import { focusEditor, openFileByName, selectors } from '../selectors'

export const editorExternalDeletion: Scenario = {
  name: 'editor-external-deletion',
  description:
    'External deletion retains clean and dirty editors; Save recreates and recreation refreshes.',
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
    } finally {
      await page.goto(originalUrl)
      await releaseFixture(fixture)
    }
  },
}
