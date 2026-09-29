import { strictEqual } from 'node:assert/strict'
import { mkdtemp, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { Page } from 'playwright'

import { openFixtureWorkspace, releaseFixture, waitForFileContent } from '../fixture-workspace'
import { scratchPath } from '../paths'
import {
  focusedEditorSelectedText,
  focusEditor,
  openFileFromTree,
  runPaletteCommand,
  selectors,
} from '../selectors'
import type { Scenario } from './index'

const INITIAL = '# Authoring\n\nalpha beta\n'
const LINKED = 'see [label](https://example.com) z'

export const markdownAuthoring: Scenario = {
  name: 'markdown-authoring',
  description:
    'Format Markdown through keyboard and menu commands, preserve source and undo, and combine either editing style with a rendered page.',
  async run(page, { step }) {
    const fixture = await mkdtemp(scratchPath('fregat-markdown-authoring-'))
    const file = path.join(fixture, 'authoring.md')
    try {
      await writeFile(file, INITIAL)
      await openFixtureWorkspace(page, fixture)
      await openFileFromTree(page, 'authoring.md')
      await runPaletteCommand(page, 'Toggle Markdown rendered pane')
      await selectors
        .markdownRenderedPane(page)
        .getByRole('heading', { name: 'Authoring' })
        .waitFor()
      await step('live-preview-and-rendered-page')

      await runPaletteCommand(page, 'Cycle markdown view')
      await focusEditor(page)
      await page.keyboard.press('Control+End')
      await selectors.editorRows(page).filter({ hasText: '# Authoring' }).first().waitFor()
      strictEqual(await selectors.markdownRenderedPane(page).count(), 1)
      await step('plain-source-and-rendered-page')

      await page.keyboard.press('Control+Home')
      await page.keyboard.press('ArrowDown')
      await page.keyboard.press('ArrowDown')
      await page.keyboard.press('Home')
      await page.keyboard.press('Shift+End')
      await page.keyboard.press('Control+b')
      await step('bold-command')
      await saveAndCheck(page, file, '# Authoring\n\n**alpha beta**\n')
      await step('bold-saved')
      await page.keyboard.press('Control+z')
      await saveAndCheck(page, file, INITIAL)
      await step('bold-undone')
      await page.keyboard.press('Control+Shift+z')
      await saveAndCheck(page, file, '# Authoring\n\n**alpha beta**\n')
      await runPaletteCommand(page, 'Cycle markdown view')
      await page.keyboard.press('Control+End')
      await step('formatted-with-history')

      await replaceContent(page, '- [ ] first\n- [x] second')
      await runPaletteCommand(page, 'Toggle Markdown task completion')
      await saveAndCheck(page, file, '- [x] first\n- [x] second')
      await selectors.markdownRenderedPane(page).getByText('second', { exact: true }).waitFor()
      await step('tasks-checked')

      await replaceContent(page, 'docs')
      await runPaletteCommand(page, 'Insert Markdown link')
      await page.waitForFunction(`(${focusedEditorSelectedText.toString()})() === 'https://'`)
      await page.keyboard.insertText('https://example.com')
      await saveAndCheck(page, file, '[docs](https://example.com)')
      await page.keyboard.press('Control+Home')
      await page.keyboard.press('ArrowRight')
      await page.keyboard.press('ArrowRight')
      await runPaletteCommand(page, 'Insert Markdown link')
      await selectors.paletteInput(page).waitFor({ state: 'hidden' })
      await page.waitForFunction(
        `(${focusedEditorSelectedText.toString()})() === 'https://example.com'`,
      )
      await page.keyboard.insertText('https://example.org')
      await saveAndCheck(page, file, '[docs](https://example.org)')

      await replaceContent(page, 'const x = `tick`')
      await runPaletteCommand(page, 'Insert Markdown code block')
      await saveAndCheck(page, file, '```\nconst x = `tick`\n```')
      await step('code-block')

      await replaceContent(page, 'first\nsecond')
      await runPaletteCommand(page, 'Toggle Markdown bullet list')
      await saveAndCheck(page, file, '- first\n- second')
      await page.keyboard.press('Control+End')
      await page.keyboard.press('Enter')
      await page.keyboard.insertText('third')
      await selectors.markdownRenderedPane(page).getByText('third', { exact: true }).waitFor()
      await step('third-before-save')
      await saveAndCheck(page, file, '- first\n- second\n- third')
      await page.keyboard.press('Tab')
      await page.keyboard.press('Shift+Tab')
      await saveAndCheck(page, file, '- first\n- second\n- third')
      await step('list-editing')

      await page.context().grantPermissions(['clipboard-read', 'clipboard-write'])
      await page.keyboard.press('Control+a')
      await page.keyboard.press('Control+c')
      strictEqual(
        await page.evaluate('navigator.clipboard.readText()'),
        '- first\n- second\n- third',
      )
      await page.keyboard.press('Control+v')
      await saveAndCheck(page, file, '- first\n- second\n- third')
      await replaceContent(page, '**one** and **two**')
      await runPaletteCommand(page, 'Toggle Markdown bold')
      await selectors.markdownRenderedPane(page).getByText('one and two', { exact: true }).waitFor()
      await step('separate-marks')
      await saveAndCheck(page, file, 'one and two')

      await replaceContent(page, '**hello world**')
      await page.keyboard.press('Control+Home')
      await page.keyboard.press('ArrowRight')
      await page.keyboard.press('ArrowRight')
      for (let index = 0; index < 5; index++) await page.keyboard.press('Shift+ArrowRight')
      await page.keyboard.press('Control+b')
      await selectors.markdownRenderedPane(page).getByText('world', { exact: true }).waitFor()
      await step('partial-formatting')
      await saveAndCheck(page, file, 'hello **world**')

      await replaceContent(page, 'one\n\ntwo')
      await runPaletteCommand(page, 'Toggle Markdown bold')
      await selectors.markdownRenderedPane(page).getByText('two', { exact: true }).waitFor()
      await step('formatted-paragraphs')
      await saveAndCheck(page, file, '**one**\n\n**two**')

      await replaceContent(page, 'foobar')
      await page.keyboard.press('Control+Home')
      for (let index = 0; index < 3; index++) await page.keyboard.press('Shift+ArrowRight')
      await page.keyboard.press('Control+i')
      await selectors.markdownRenderedPane(page).getByText('foo', { exact: true }).waitFor()
      await step('intraword-italic')
      await saveAndCheck(page, file, '*foo*bar')

      await replaceContent(page, 'folder\\')
      await runPaletteCommand(page, 'Insert Markdown link')
      await page.waitForFunction(`(${focusedEditorSelectedText.toString()})() === 'https://'`)
      await page.keyboard.insertText('https://example.com')
      await selectors
        .markdownRenderedPane(page)
        .getByRole('link', { name: 'folder\\', exact: true })
        .waitFor()
      await step('escaped-link-label')
      await saveAndCheck(page, file, '[folder\\\\](https://example.com)')

      await replaceContent(page, '1. [ ] first\n2. [x] second')
      await runPaletteCommand(page, 'Toggle Markdown task completion')
      await selectors
        .markdownRenderedPane(page)
        .getByRole('checkbox', { checked: true })
        .nth(1)
        .waitFor()
      await step('numbered-tasks')
      await saveAndCheck(page, file, '1. [x] first\n2. [x] second')

      await replaceContent(page, LINKED)
      await caretAt(page, 7)
      await boldAndSave(page, file, 'see [la**text**bel](https://example.com) z')
      await step('bold-in-link-label')
      await boldAndSave(page, file, 'see [latextbel](https://example.com) z')
      await step('bold-in-link-label-toggled-off')

      await replaceContent(page, LINKED)
      await caretAt(page, 20)
      await boldAndSave(page, file, 'see **[label](https://example.com)** z')
      await step('bold-from-link-destination')
      await boldAndSave(page, file, LINKED)
      await step('bold-from-link-destination-toggled-off')

      await runPaletteCommand(page, 'Toggle Markdown rendered pane')
      await selectors.markdownRenderedPane(page).waitFor({ state: 'detached' })
      await step('editor-alone')
    } finally {
      await releaseFixture(fixture)
    }
  },
}

async function replaceContent(page: Page, text: string) {
  await focusEditor(page)
  await page.keyboard.press('Control+a')
  await page.keyboard.insertText(text)
  await page.keyboard.press('Control+a')
}

async function caretAt(page: Page, offset: number) {
  await page.keyboard.press('Control+Home')
  for (let index = 0; index < offset; index++) await page.keyboard.press('ArrowRight')
}

// Bold waits for fresh syntax records after an edit, so saving before the row changes races it.
async function boldAndSave(page: Page, file: string, text: string) {
  await page.keyboard.press('Control+b')
  await selectors.editorRows(page).filter({ hasText: text }).first().waitFor()
  await saveAndCheck(page, file, text)
}

async function saveAndCheck(page: Page, file: string, text: string) {
  await page.keyboard.press('Control+s')
  await waitForFileContent(file, text)
  await selectors.writableEditorInput(page).first().waitFor({ state: 'attached' })
}
