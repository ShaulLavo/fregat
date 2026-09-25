import { ok, strictEqual } from 'node:assert/strict'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Page } from 'playwright'

import type { Scenario } from './index'
import { openFixtureWorkspace, releaseFixture } from '../fixture-workspace'
import { openFileFromTree, selectors } from '../selectors'

/** Two files that fail type checking as written, so nothing has to be typed into them. */
async function createFixture() {
  const fixture = await mkdtemp('/work/tmp/fregat-problems-panel-rows-')
  await writeFile(
    join(fixture, 'tsconfig.json'),
    JSON.stringify({ compilerOptions: { strict: true, noEmit: true } }),
  )
  await writeFile(join(fixture, 'alpha.ts'), "export const alpha: number = 'one'\n")
  // Padding above the error, so a jump to it visibly moves the cursor line.
  await writeFile(join(fixture, 'beta.ts'), '// beta\n\n\nexport const beta: string = 2\n')
  return fixture
}

async function activeRowText(page: Page) {
  const tree = selectors.problemsTree(page)
  const id = await tree.getAttribute('aria-activedescendant')
  ok(id, 'The Problems tree must point at an active row')
  return page.locator(`[id="${id}"]`).innerText()
}

export const problemsPanelRows: Scenario = {
  name: 'problems-panel-rows',
  description:
    'Two files with type errors in a disposable workspace: Problems is one tree with one tab stop, the arrows walk from the first file into the second, and clicking a problem moves the cursor to it.',
  async run(page, { step }) {
    const fixture = await createFixture()
    try {
      await openFixtureWorkspace(page, fixture)
      await openFileFromTree(page, 'alpha.ts')
      await openFileFromTree(page, 'beta.ts')
      await selectors.bottomTab(page, 'Problems').click()
      await selectors.problemsFiles(page).nth(1).waitFor({ timeout: 60_000 })
      await step('two-files')

      const tree = selectors.problemsTree(page)
      strictEqual(await selectors.problemsTree(page).count(), 1, 'Problems is one tree')
      strictEqual(await selectors.listTabStops(tree).count(), 0, 'Only the tree is a Tab stop')
      const tiles = await page.getByText(/^(Errors|Warnings|Hints)$/).count()
      strictEqual(tiles, 0, 'The Problems panel renders no counter tiles')
      const title = await selectors.diagnosticsRows(page).first().getAttribute('title')
      ok(title?.includes(':'), `A diagnostic row recovers its file and line, got "${title}"`)

      await tree.focus()
      await page.keyboard.press('Home')
      const first = await activeRowText(page)
      await page.keyboard.press('ArrowDown')
      await page.keyboard.press('ArrowDown')
      const second = await activeRowText(page)
      ok(first !== second, 'ArrowDown moves the active row')
      ok(
        /alpha|beta/.test(first) && /alpha|beta/.test(second) && first !== second,
        `The arrows cross into the second file: "${first}" then "${second}"`,
      )
      strictEqual(
        await tree.evaluate((element) => element === element.ownerDocument.activeElement),
        true,
        'Focus stays on the tree while the cursor moves',
      )
      await step('crossed-into-second-file')

      await page.keyboard.press('Home')
      await page.keyboard.press('ArrowLeft')
      strictEqual(
        await selectors.problemsFiles(page).first().getAttribute('aria-expanded'),
        'false',
      )
      await step('first-file-collapsed')

      await selectors.editorTabNamed(page, /beta\.ts/).click()
      const cursorLine = selectors.editorCursorLineRow(page)
      const before = await cursorLine.innerText()
      ok(
        !before.includes('export const beta'),
        `The cursor starts off the problem line: "${before}"`,
      )
      const betaDiagnostic = selectors
        .diagnosticsRows(page)
        .and(page.locator('[title*="beta.ts"]'))
        .first()
      await betaDiagnostic.click()
      await cursorLine.filter({ hasText: 'export const beta' }).waitFor()
      await step('click-jumps-to-problem')
    } finally {
      await releaseFixture(fixture)
    }
  },
}
