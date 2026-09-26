import { deepStrictEqual, strictEqual } from 'node:assert/strict'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

import type { Page } from 'playwright'
import type { Scenario } from './index'
import { openFixtureWorkspace, releaseFixture } from '../fixture-workspace'
import { readUserSetting, writeUserOperations, writeUserSetting } from '../preserve-settings'
import {
  focusEditor,
  openFileFromTree,
  rightClickEditorWord,
  runPaletteCommand,
  selectors,
} from '../selectors'
import { createScriptError } from '../../structured-errors'

const TYPED = 'the list settles befor the cursor and fregat ships'

/** Marks land once the dictionary worker answers, so the menu is retried until it offers `item`. */
async function openSpellingMenu(page: Page, word: string, item: string) {
  const deadline = Date.now() + 15_000
  while (Date.now() < deadline) {
    await rightClickEditorWord(page, word)
    const found = await selectors
      .menuItem(page, item)
      .waitFor({ timeout: 1_000 })
      .then(() => true)
      .catch(() => false)
    if (found) return
    await page.keyboard.press('Escape')
  }
  throw createScriptError(`The text menu never offered "${item}" for "${word}"`)
}

/** The command's menu is retried the same way, since the mark lands after the worker answers. */
async function openSuggestionsAtCaret(page: Page, item: string) {
  const deadline = Date.now() + 15_000
  while (Date.now() < deadline) {
    await runPaletteCommand(page, 'Spelling suggestions')
    const found = await selectors
      .menuItem(page, item)
      .waitFor({ timeout: 1_000 })
      .then(() => true)
      .catch(() => false)
    if (found) return
    await page.keyboard.press('Escape')
    await focusEditor(page)
  }
  throw createScriptError(`Spelling suggestions never offered "${item}" at the caret`)
}

async function waitForFileText(file: string, expected: string) {
  const deadline = Date.now() + 10_000
  while (Date.now() < deadline) {
    if ((await readFile(file, 'utf8')).includes(expected)) return
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
  throw createScriptError(`${path.basename(file)} never held "${expected}"`)
}

export const editorSpellcheck: Scenario = {
  name: 'editor-spellcheck',
  description:
    'With editor.spellcheck on, a typed misspelling is marked; right-clicking it offers replacements and one click replaces it; the Spelling suggestions command opens them at the caret; Add to Dictionary writes the word to user settings, and after a reload the word is no longer marked.',
  async run(page, { step }) {
    const fixture = await mkdtemp('/work/tmp/fregat-spellcheck-')
    const file = path.join(fixture, 'notes.txt')
    try {
      await writeFile(file, 'Release notes\n')
      await openFixtureWorkspace(page, fixture)
      await writeUserSetting(page, 'editor.spellcheck', 'prose')
      await openFileFromTree(page, 'notes.txt')
      await focusEditor(page)
      await page.keyboard.press('Control+End')
      await page.keyboard.type(`${TYPED} `, { delay: 20 })

      await openSpellingMenu(page, 'befor', 'before')
      await step('spelling-menu')
      await selectors.menuItem(page, 'before').click()
      await page.keyboard.press('Control+s')
      await waitForFileText(file, 'settles before the cursor')
      await step('replaced')

      await page.keyboard.press('Control+End')
      await page.keyboard.type(' wrold ', { delay: 20 })
      await page.keyboard.press('ArrowLeft')
      await page.keyboard.press('ArrowLeft')
      await page.keyboard.press('ArrowLeft')
      await openSuggestionsAtCaret(page, 'world')
      await step('suggestions-at-caret')
      await page.keyboard.press('Escape')

      await openSpellingMenu(page, 'fregat', 'Add to Dictionary')
      await selectors.menuItem(page, 'Add to Dictionary').click()
      const deadline = Date.now() + 10_000
      while (Date.now() < deadline && !(await readUserSetting(page, 'spellcheck.words'))) {
        await page.waitForTimeout(200)
      }
      deepStrictEqual(await readUserSetting(page, 'spellcheck.words'), { fregat: true })

      // A full page load, through the fixture address: a bare reload of a fixture workspace loses
      // its files (fs/read answers 404), which is not what this scenario is about.
      await openFixtureWorkspace(page, fixture)
      await openFileFromTree(page, 'notes.txt')
      // Long enough for the worker to have answered, were the word still unknown.
      await page.waitForTimeout(1_500)
      await focusEditor(page)
      await openSpellingMenu(page, 'fregat', 'Add File to Chat')
      await step('accepted-after-reload')
      strictEqual(await selectors.menuItem(page, 'Add to Dictionary').count(), 0)
      await page.keyboard.press('Escape')
    } finally {
      await writeUserOperations(page, [
        { kind: 'reset', keys: ['editor.spellcheck', 'spellcheck.words'] },
      ]).catch(() => undefined)
      await releaseFixture(fixture)
    }
  },
}
