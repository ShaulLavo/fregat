import { match } from 'node:assert'
import { mkdtemp, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { Page } from 'playwright'
import type { Scenario } from './index'
import { openFixtureWorkspace, releaseFixture } from '../fixture-workspace'
import { scratchPath } from '../paths'
import { focusEditor, openFileFromTree, runPaletteCommand, selectors } from '../selectors'

const BARRIER_TOAST = 'Undo stopped at a multi-file edit'
const RENAMED = 'renamedValue'

/** `renameMe` is exported from `a.ts` and imported in `b.ts`, so the rename spans two files. */
async function createRenameFixture() {
  const fixture = await mkdtemp(scratchPath('fregat-undo-barrier-'))
  await writeFile(path.join(fixture, 'a.ts'), 'export const renameMe = 1\n')
  await writeFile(
    path.join(fixture, 'b.ts'),
    "import { renameMe } from './a'\n\nexport const twice = renameMe * 2\n",
  )
  await writeFile(
    path.join(fixture, 'tsconfig.json'),
    '{"compilerOptions":{"strict":true,"module":"esnext","target":"es2022","moduleResolution":"bundler"},"include":["*.ts"]}',
  )
  return fixture
}

export const editorUndoBarrier: Scenario = {
  name: 'editor-undo-barrier',
  description:
    'Type, rename a symbol across two files, then Ctrl+Z to the barrier and undo the rename from the toast.',
  async run(page, { step }) {
    const fixture = await createRenameFixture()
    try {
      await openFixtureWorkspace(page, fixture)
      await exerciseBarrier(page, step)
    } finally {
      await releaseFixture(fixture)
    }
  },
}

async function exerciseBarrier(page: Page, step: (label: string) => Promise<void>) {
  await openFileFromTree(page, 'a.ts')
  await focusEditor(page)
  await page.keyboard.press('Control+End')
  await page.keyboard.insertText(' // note')
  await page.waitForTimeout(6000)
  await page.keyboard.press('Control+Home')
  for (let i = 0; i < 'export const '.length; i++) await page.keyboard.press('ArrowRight')
  await runPaletteCommand(page, 'Rename symbol')
  const rename = selectors.renameInput(page)
  await rename.waitFor({ state: 'visible', timeout: 8000 })
  await rename.fill(RENAMED)
  await page.keyboard.press('Enter')
  await selectors.workspaceEditApplyAll(page).click({ timeout: 8000 })
  await page.getByText(RENAMED).first().waitFor({ timeout: 8000 })
  await step('renamed')
  await focusEditor(page)
  await page.keyboard.press('Control+z')
  await page.keyboard.press('Control+z')
  const toast = selectors.toast(page, BARRIER_TOAST)
  await toast.waitFor({ state: 'visible', timeout: 5000 })
  match(await toast.innerText(), /Undo multi-file edit/)
  // Sonner's enter animation: wait until the toast rests before the screenshot.
  await page.waitForTimeout(400)
  await step('barrier')

  // The other route: the History tab shows the barrier as a state, and undoes the group.
  await runPaletteCommand(page, 'Show history')
  await selectors.historyStates(page).waitFor({ timeout: 10_000 })
  await selectors
    .historyStates(page)
    .getByRole('option', { name: /Multi-file edit/ })
    .click()
  await page.getByText('A multi-file edit blocks earlier versions.').waitFor({ timeout: 10_000 })
  await step('barrier-state')
  // The toast offers the same action; the pane's own button is the one under test.
  await selectors
    .historyPane(page)
    .getByRole('button', { name: 'Undo multi-file edit', exact: true })
    .click()
  // The barrier leaves the graph once the group is undone; the path is reserved until then.
  await selectors
    .historyStates(page)
    .getByRole('option', { name: /Multi-file edit/ })
    .waitFor({ state: 'detached', timeout: 10_000 })
  await page.waitForTimeout(500)
  await selectors
    .editorTabNamed(page, /^a\.ts$/)
    .first()
    .click()
  await page.getByText('renameMe').first().waitFor({ timeout: 8000 })
  await step('restored')
}
