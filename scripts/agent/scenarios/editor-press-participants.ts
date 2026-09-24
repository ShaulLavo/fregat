import { writeFile } from 'node:fs/promises'
import path from 'node:path'

import type { Page } from 'playwright'
import type { Scenario } from './index'
import {
  createModifiedFileFixture,
  fixtureGit,
  openFixtureWorkspace,
  releaseFixture,
} from '../fixture-workspace'
import {
  diffPaneSelector,
  focusedEditorTextBeforeCaret,
  openFileByName,
  openGitPanel,
  selectedEditorFileTabSelector,
  selectors,
  textPoint,
} from '../selectors'
import { createScriptError } from '../../structured-errors'

const FILLER = Array.from({ length: 12 }, (_, index) => `export const filler${index} = ${index}`)
const HEAD = ['export function target(): number {', '  return 1', '}']
// The change sits right under the definition, so the definition is diff context and the filler
// after it collapses into a separator.
const BEFORE = [...HEAD, 'export const value = target() + 1', ...FILLER]
const AFTER = [...HEAD, 'export const value = target() + 2', ...FILLER]

export const editorPressParticipants: Scenario = {
  name: 'editor-press-participants',
  description:
    'Presses a plugin claims never reach caret placement (E050 row 5): a double-click on a diff separator leaves the diff unfocused, and Ctrl+click follows a definition in the diff and in the editor.',
  async run(page, { step }) {
    const fixture = await createModifiedFileFixture('press-participants', 'a.ts', BEFORE, AFTER)
    try {
      await writeFile(
        path.join(fixture, 'b.ts'),
        "import { target } from './a'\nexport const other = target()\n",
      )
      await writeFile(
        path.join(fixture, 'tsconfig.json'),
        '{"compilerOptions":{"strict":true},"include":["*.ts"]}',
      )
      await fixtureGit(fixture, ['add', 'b.ts', 'tsconfig.json'])
      await fixtureGit(fixture, ['commit', '--quiet', '-m', 'callers'])

      await openFixtureWorkspace(page, fixture)
      await openGitPanel(page)
      await selectors.worktreeFiles(page).first().click()
      await selectors.diffExpandRows(page).first().waitFor({ timeout: 15_000 })
      // The diff's language server has to be up before a Ctrl+click can resolve anything.
      await page.waitForTimeout(3000)

      await selectors.diffExpandRows(page).first().dblclick()
      await step('separator-double-click')
      await assertSeparatorUntouched(page)

      await ctrlClick(page, 'target() + 2', 'target', diffPaneSelector)
      await step('diff-definition')
      await waitForCaretLine(page, 'export function target')

      await openFileByName(page, 'b.ts')
      await page.waitForTimeout(3000)
      await ctrlClick(page, 'other = target()', 'target', 'body')
      await page
        .locator(`${selectedEditorFileTabSelector}[data-editor-tab-path$="a.ts"]`)
        .first()
        .waitFor({ timeout: 10_000 })
      await step('editor-definition')
      await waitForCaretLine(page, 'export function target')
    } finally {
      await releaseFixture(fixture)
    }
  },
}

async function ctrlClick(page: Page, context: string, part: string, within: string) {
  const point = await textPoint(page, context, part, within)
  await page.mouse.move(point.x, point.y)
  await page.keyboard.down('Control')
  await page.mouse.down()
  await page.mouse.up()
  await page.keyboard.up('Control')
}

async function assertSeparatorUntouched(page: Page) {
  const state = await page.evaluate((paneSelector) => {
    const active = document.activeElement
    return {
      diffFocused: Boolean(active?.closest(paneSelector)),
      selected: document.getSelection()?.toString() ?? '',
    }
  }, diffPaneSelector)
  if (state.diffFocused || /unmodified/.test(state.selected)) {
    throw createScriptError(
      `A double-click on a separator reached the editor: ${JSON.stringify(state)}`,
    )
  }
}

async function waitForCaretLine(page: Page, lineStart: string) {
  const deadline = Date.now() + 10_000
  let line = ''
  while (Date.now() < deadline) {
    const before = await page.evaluate(focusedEditorTextBeforeCaret)
    line = before.slice(before.lastIndexOf('\n') + 1)
    if (line.length > 0 && (lineStart.startsWith(line) || line.startsWith(lineStart))) return
    await page.waitForTimeout(200)
  }
  throw createScriptError(`The caret did not reach \`${lineStart}\`; its line starts \`${line}\``)
}
