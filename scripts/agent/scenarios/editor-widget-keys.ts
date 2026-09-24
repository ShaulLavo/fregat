import { mkdtemp, writeFile } from 'node:fs/promises'
import path from 'node:path'

import type { Page } from 'playwright'
import type { Scenario } from './index'
import { openFixtureWorkspace, releaseFixture } from '../fixture-workspace'
import { openFileFromTree, selectedEditorFileTabSelector, selectors } from '../selectors'
import { createScriptError } from '../../structured-errors'

const SOURCE = [
  'export function call(a: number): void',
  'export function call(a: string, b: string): void',
  'export function call(a: unknown, b?: string): void {}',
  'export const alpha = 1',
  'export const alphabet = 2',
  '',
].join('\n')

export const editorWidgetKeys: Scenario = {
  name: 'editor-widget-keys',
  description:
    'With a signature hint and a completion list both open, the arrows move the list and Escape closes the list first, then the hint; Enter accepts in place; Escape closes find through its plugin key (E050 row 6: plugin keymap context keys).',
  async run(page, { step }) {
    const fixture = await mkdtemp('/work/tmp/fregat-widget-keys-')
    try {
      await writeFile(path.join(fixture, 'main.ts'), SOURCE)
      await writeFile(
        path.join(fixture, 'tsconfig.json'),
        '{"compilerOptions":{"strict":true},"include":["*.ts"]}',
      )
      await openFixtureWorkspace(page, fixture)
      await openFileFromTree(page, 'main.ts')
      // Never type into anything but the fixture: a workspace that failed to open leaves the
      // palette matching some other file of whatever workspace the page is on.
      await page
        .locator(
          `${selectedEditorFileTabSelector}[data-editor-tab-path$="${path.basename(fixture)}/main.ts"]`,
        )
        .waitFor({ timeout: 10_000 })
      // A click on the viewport focuses the input on either input route; the EditContext host is
      // not "visible" to Playwright, so focusing it by role would wait forever.
      await selectors.editorSurface(page).first().click()
      await page.keyboard.press('Control+End')
      await page.waitForTimeout(3000)

      await page.keyboard.type('call(', { delay: 60 })
      await selectors.editorSignatureHelp(page).waitFor({ state: 'visible', timeout: 10_000 })
      const firstOverload = await hintText(page)
      await page.keyboard.press('ArrowDown')
      await expectHint(page, (text) => text !== firstOverload, 'ArrowDown cycles the overloads')
      await step('hint-overload-cycled')

      await page.keyboard.type('alph', { delay: 60 })
      await page.keyboard.press('Control+Space')
      await waitForList(page)
      const hintWithList = await hintText(page)
      const focused = await selectors.editorCompletionFocusedLabel(page)
      await page.keyboard.press('ArrowDown')
      const moved = await selectors.editorCompletionFocusedLabel(page)
      if (moved === focused) throw createScriptError(`ArrowDown left the list on ${focused}`)
      await expectHint(page, (text) => text === hintWithList, 'the hint holds while the list moves')
      await step('list-moved')

      await page.keyboard.press('Escape')
      if ((await selectors.editorCompletionLabels(page)).length > 0)
        throw createScriptError('The first Escape did not close the list')
      await expectHint(page, (text) => text.length > 0, 'the first Escape leaves the hint open')
      await step('list-closed')

      await page.keyboard.press('Escape')
      await selectors.editorSignatureHelp(page).waitFor({ state: 'hidden', timeout: 5000 })
      await step('hint-closed')

      await page.keyboard.press('Control+Space')
      await waitForList(page)
      const chosen = await selectors.editorCompletionFocusedLabel(page)
      await page.keyboard.press('Enter')
      const lines = await linesAfterAcceptance(page)
      if (lines.at(-1) !== `call(${chosen})`)
        throw createScriptError(`Enter did not accept the item in place: ${JSON.stringify(lines)}`)
      await step('accepted')

      // `findVisible` is the find plugin's key now; Escape from the text closes the widget through it.
      await page.keyboard.press('Control+f')
      const find = selectors.editorFindInput(page).first()
      await find.waitFor({ timeout: 5000 })
      await selectors.editorSurface(page).first().click()
      if (!(await find.isVisible()))
        throw createScriptError('Clicking the text closed find by itself')
      await page.keyboard.press('Escape')
      await find.waitFor({ state: 'hidden', timeout: 5000 })
      await step('find-closed')
    } finally {
      await releaseFixture(fixture)
    }
  },
}

async function hintText(page: Page): Promise<string> {
  const hint = selectors.editorSignatureHelp(page)
  if ((await hint.count()) === 0) return ''
  return hint.innerText()
}

async function expectHint(page: Page, holds: (text: string) => boolean, claim: string) {
  const deadline = Date.now() + 3000
  let text = ''
  while (Date.now() < deadline) {
    text = await hintText(page)
    if (holds(text)) return
    await page.waitForTimeout(100)
  }
  throw createScriptError(`${claim}: the hint reads ${JSON.stringify(text)}`)
}

/** Rows in document order; an Enter the list did not take leaves `call(alph` and `)` on two. */
async function linesAfterAcceptance(page: Page): Promise<readonly string[]> {
  const deadline = Date.now() + 3000
  let lines: readonly string[] = []
  while (Date.now() < deadline) {
    lines = await page
      .locator('.editor-virtualized-row[data-editor-virtual-row]:not([hidden])')
      .evaluateAll((elements) =>
        elements
          .map((element) => ({
            row: Number(element.getAttribute('data-editor-virtual-row')),
            text: element.textContent ?? '',
          }))
          .sort((left, right) => left.row - right.row)
          .map((entry) => entry.text),
      )
    if (lines.at(-1) !== 'call(alph)') return lines
    await page.waitForTimeout(150)
  }
  return lines
}

async function waitForList(page: Page) {
  const deadline = Date.now() + 10_000
  while (Date.now() < deadline) {
    if ((await selectors.editorCompletionLabels(page)).length > 1) return
    await page.waitForTimeout(150)
  }
  throw createScriptError('Control+Space opened no completion list')
}
