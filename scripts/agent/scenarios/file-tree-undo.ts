import { ok, strictEqual } from 'node:assert/strict'
import { mkdir, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { Page } from 'playwright'
import type { Scenario } from './index'
import { openFixtureWorkspace, releaseFixture, waitForFileContent } from '../fixture-workspace'
import { focusEditor, openFileFromTree, selectors, waitForApp } from '../selectors'

const FIXTURE = '/work/tmp/plan136-undo'
const UNSAVED = '// unsaved edit'

export const fileTreeUndo: Scenario = {
  name: 'file-tree-undo',
  description:
    'Drag a folder holding a dirty file, undo and redo it from the tree, undo a folder delete from its toast, after a reload and from a second window.',
  async run(page, { step }) {
    const originalUrl = page.url()
    await rm(FIXTURE, { force: true, recursive: true })
    const browser = page.context().browser()
    ok(browser, 'The scenario browser is unavailable')
    // Its own context: tabs of one profile share six HTTP/1.1 connections, and each tab holds four streams.
    const secondContext = await browser.newContext({ viewport: page.viewportSize() })
    try {
      await seedFixture()
      await openFixtureWorkspace(page, FIXTURE)
      // Opened while the history is empty, so its cached list must follow the first window.
      const second = await secondContext.newPage()
      await second.goto(page.url())
      await waitForApp(second)
      await waitForWritable(second)
      await selectors.treeItem(page, 'src').click()
      await selectors.treeItem(page, 'feature').click()
      await openFileFromTree(page, 'note.ts')
      await focusEditor(page)
      await page.keyboard.press('Control+End')
      await page.keyboard.insertText(`${UNSAVED}\n`)
      await step('dirty-file-open')

      await selectors.treeItem(page, 'feature').dragTo(selectors.treeItem(page, 'lib'))
      await selectors.toast(page, 'Move feature into lib').waitFor({ timeout: 15_000 })
      await expectMoved(page, 'lib/feature/note.ts', 'src/feature')
      await step('dragged-with-toast')

      await focusTree(page)
      await page.keyboard.press('Control+z')
      await selectors.toast(page, 'Undid Move feature into lib').waitFor({ timeout: 15_000 })
      await expectMoved(page, 'src/feature/note.ts', 'lib/feature')
      await step('undone-from-tree')

      await focusTree(page)
      await page.keyboard.press('Control+Shift+z')
      await selectors.toast(page, 'Redid Move feature into lib').waitFor({ timeout: 15_000 })
      await expectMoved(page, 'lib/feature/note.ts', 'src/feature')
      await focusEditor(page)
      await page.keyboard.press('Control+s')
      await waitForFileContent(
        path.join(FIXTURE, 'lib/feature/note.ts'),
        `export const note = 1\n${UNSAVED}\n`,
      )
      await step('redone-and-saved')

      await deleteFromMenu(page, 'doomed', () => step('delete-dialog'))
      await focusEditor(page)
      await selectors.toastAction(page, 'Delete doomed', 'Undo').click({ timeout: 15_000 })
      await expectDoomedRestored()
      await expectUndone(page, 'Delete doomed')
      await step('toast-undo-with-editor-focus')

      await deleteFromMenu(page, 'doomed')
      await page.reload()
      await waitForApp(page)
      await focusTree(page)
      await page.keyboard.press('Control+z')
      await expectDoomedRestored()
      await expectUndone(page, 'Delete doomed')
      // The saved file's tab survived undo, redo and the reload at the path it was moved to.
      await selectors
        .editorTab(page, path.join(FIXTURE, 'lib/feature/note.ts').slice(1))
        .waitFor({ timeout: 15_000 })
      await step('undo-after-reload')

      await deleteFromMenu(page, 'doomed')
      await selectors.treeItem(second, 'doomed').waitFor({ state: 'detached', timeout: 15_000 })
      await focusTree(second)
      await second.keyboard.press('Control+z')
      await expectDoomedRestored()
      await expectUndone(second, 'Delete doomed')
      // The first window follows the second one's undo through the watch stream.
      await selectors.treeItem(page, 'doomed').waitFor({ timeout: 15_000 })
      await step('undo-from-second-window')
    } finally {
      await secondContext.close()
      await page.goto(originalUrl)
      await releaseFixture(FIXTURE)
    }
  },
}

/** A window can show a tree before it connects; it mutates only once connected. */
async function waitForWritable(page: Page) {
  const button = selectors.treeNewFileButton(page).first()
  await button.waitFor({ timeout: 15_000 })
  const deadline = Date.now() + 30_000
  while (!(await button.isEnabled())) {
    ok(Date.now() < deadline, 'The second window never became writable')
    await Bun.sleep(100)
  }
}

async function seedFixture() {
  await mkdir(path.join(FIXTURE, 'src/feature'), { recursive: true })
  await mkdir(path.join(FIXTURE, 'lib'), { recursive: true })
  await mkdir(path.join(FIXTURE, 'doomed/nested'), { recursive: true })
  await writeFile(path.join(FIXTURE, 'src/feature/note.ts'), 'export const note = 1\n')
  // A sibling keeps the tree from flattening src/feature into one row.
  await writeFile(path.join(FIXTURE, 'src/index.ts'), 'export {}\n')
  await writeFile(path.join(FIXTURE, 'lib/keep.ts'), 'export const keep = 1\n')
  await writeFile(path.join(FIXTURE, 'doomed/a.txt'), 'alpha\n')
  await writeFile(path.join(FIXTURE, 'doomed/nested/b.txt'), 'beta\n')
}

async function focusTree(page: Page) {
  await selectors.treeItem(page, 'lib').waitFor({ timeout: 15_000 })
  await page.keyboard.press('Control+Shift+E')
  await selectors.focusedTreeRow(page).waitFor({ timeout: 5_000 })
}

/** The file, its tab and its unsaved text all moved; the old folder is gone from disk. */
async function expectMoved(page: Page, file: string, vacated: string) {
  await waitForPath(path.join(FIXTURE, file), true)
  await waitForPath(path.join(FIXTURE, vacated), false)
  const tab = selectors.editorTab(page, path.join(FIXTURE, file).slice(1))
  await tab.waitFor({ timeout: 15_000 })
  const text = await selectors.editorSurface(page).first().innerText()
  ok(text.includes(UNSAVED), `The moved buffer lost its unsaved text: ${text.slice(0, 200)}`)
}

async function deleteFromMenu(page: Page, name: string, onDialog?: () => Promise<unknown>) {
  await selectors.treeItem(page, name).click({ button: 'right' })
  await selectors.menuItem(page, 'Delete').click({ timeout: 5_000 })
  await selectors.confirmTreeDelete(page).waitFor({ timeout: 5_000 })
  await onDialog?.()
  await selectors.confirmTreeDelete(page).click({ timeout: 5_000 })
  await waitForPath(path.join(FIXTURE, name), false)
  await selectors.toast(page, `Delete ${name}`).waitFor({ timeout: 15_000 })
}

/** The user sees the result: the toast names what was reversed and the tree shows it back. */
async function expectUndone(page: Page, label: string) {
  await selectors.toast(page, `Undid ${label}`).waitFor({ timeout: 15_000 })
  await selectors.treeItem(page, 'doomed').waitFor({ timeout: 15_000 })
}

async function expectDoomedRestored() {
  await waitForPath(path.join(FIXTURE, 'doomed/nested/b.txt'), true)
  await waitForFileContent(path.join(FIXTURE, 'doomed/a.txt'), 'alpha\n')
  await waitForFileContent(path.join(FIXTURE, 'doomed/nested/b.txt'), 'beta\n')
}

async function waitForPath(target: string, exists: boolean) {
  const deadline = Date.now() + 10_000
  while (Date.now() < deadline) {
    if ((await pathExists(target)) === exists) return
    await Bun.sleep(50)
  }
  strictEqual(await pathExists(target), exists, `${target} ${exists ? 'missing' : 'still there'}`)
}

async function pathExists(target: string) {
  return stat(target).then(
    () => true,
    () => false,
  )
}
