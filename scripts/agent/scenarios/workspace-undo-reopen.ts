import { strictEqual } from 'node:assert'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { Page } from 'playwright'
import { openFixtureWorkspace, releaseFixture } from '../fixture-workspace'
import { scratchPath } from '../paths'
import { openFileFromTree, runPaletteCommand, selectors } from '../selectors'
import type { Scenario } from './index'

const originalA = 'export const renameMe = 1\n'
const originalB = 'export const renameMe = 2\n'

export const workspaceUndoReopen: Scenario = {
  name: 'workspace-undo-reopen',
  description:
    'Reopen a file while a real multi-file Undo request is held, then restore both files.',
  async run(page, { step }) {
    const fixture = await mkdtemp(scratchPath('fregat-undo-reopen-'))
    try {
      await Promise.all([
        writeFile(path.join(fixture, 'a.ts'), originalA),
        writeFile(path.join(fixture, 'b.ts'), originalB),
        writeFile(path.join(fixture, 'control.ts'), 'export const control = 1\n'),
      ])
      await openFixtureWorkspace(page, fixture)
      await openFileFromTree(page, 'a.ts')
      await openFileFromTree(page, 'control.ts')
      await selectors
        .editorTabNamed(page, /^a\.ts$/)
        .first()
        .click()
      await selectors.editorRows(page).filter({ hasText: 'renameMe' }).first().waitFor()
      await assertHealthyTab(page)
      await step('known-good-tab-transition')

      await selectors.sidebarTab(page, 'Search').click()
      await selectors.workspaceSearch(page).fill('renameMe')
      await selectors.replaceToggle(page).click()
      strictEqual(
        await selectors.editorTabNamed(page, /^b\.ts$/).count(),
        0,
        'The second target stays unopened so Undo must reach the server',
      )
      await selectors.replaceBox(page).fill('renamedValue')
      await selectors.workspaceReplaceAll(page).click()
      await selectors.workspaceEditApplyAll(page).click()
      await selectors.workspaceEditApplyAll(page).waitFor({ state: 'hidden' })
      await selectors.editorRows(page).filter({ hasText: 'renamedValue' }).first().waitFor()
      strictEqual(
        await readFile(path.join(fixture, 'b.ts'), 'utf8'),
        originalB.replace('renameMe', 'renamedValue'),
      )
      await step('multi-file-edit-applied')

      await runPaletteCommand(page, 'Show history')
      await selectors
        .historyStates(page)
        .getByRole('option', { name: /Multi-file edit/ })
        .click()
      await selectors
        .historyPane(page)
        .getByRole('button', { name: 'Undo multi-file edit', exact: true })
        .waitFor()
      await reopenDuringUndo(page, step)
      strictEqual(await readFile(path.join(fixture, 'a.ts'), 'utf8'), originalA)
      strictEqual(await readFile(path.join(fixture, 'b.ts'), 'utf8'), originalB)
      await step('both-files-restored')
    } finally {
      await releaseFixture(fixture)
    }
  },
}

async function reopenDuringUndo(page: Page, step: (label: string) => Promise<void>) {
  const gate = Promise.withResolvers<void>()
  await page.route(
    '**/fs/workspace-edit/undo',
    async (route) => {
      await gate.promise
      await route.continue()
    },
    { times: 1 },
  )
  const undoRequested = page.waitForRequest((request) =>
    new URL(request.url()).pathname.endsWith('/fs/workspace-edit/undo'),
  )
  const applied = page.waitForRequest((request) => {
    const body = request.postData() ?? ''
    return (
      new URL(request.url()).pathname.endsWith('/_log/ingest') &&
      body.includes('workspace_edit.reverse') &&
      body.includes('"outcome":"applied"')
    )
  })
  try {
    await selectors
      .historyPane(page)
      .getByRole('button', { name: 'Undo multi-file edit', exact: true })
      .click()
    await undoRequested
    await selectors
      .editorTabNamed(page, /^a\.ts$/)
      .first()
      .click()
    await step('reopened-while-undo-held')
    await assertHealthyTab(page)
    await selectors.editorRows(page).filter({ hasText: 'renamedValue' }).first().waitFor()
  } finally {
    gate.resolve()
    await applied
  }
  await selectors.editorRows(page).filter({ hasText: 'renameMe' }).first().waitFor()
  strictEqual((await selectors.editorRows(page).allInnerTexts()).join('\n'), originalA)
  await assertHealthyTab(page)
}

async function assertHealthyTab(page: Page) {
  strictEqual(
    await selectors.renderErrorState(page).count(),
    0,
    'Reopening keeps the editor healthy',
  )
  strictEqual(
    await selectors.navigationError(page).count(),
    0,
    'Reopening keeps the address healthy',
  )
}
