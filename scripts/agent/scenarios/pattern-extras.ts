import { ok, strictEqual } from 'node:assert/strict'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { Locator, Page } from 'playwright'
import type { Scenario } from './index'
import { fixtureGit, openFixtureWorkspace, releaseFixture } from '../fixture-workspace'
import { openFileFromTree, runPaletteCommand, selectors, waitForApp } from '../selectors'

const source = `export function patternExample() {
  const nestedValue = 1
  return nestedValue
}

export const patternOther = patternExample()
`

export const breadcrumbPicker: Scenario = {
  name: 'breadcrumb-picker',
  description: 'Navigate folder and symbol pickers through one focused tree container.',
  run: (page, { step }) =>
    withPatternFixture(page, async () => {
      await selectors.breadcrumbCrumb(page, 'regions.ts').click()
      const folders = selectors.folderPickerTree(page)
      await folders.waitFor()
      await folders.focus()
      await page.keyboard.press('Home')
      await step('folder-first-row')
      await page.keyboard.press('ArrowRight')
      await selectors.folderPickerRow(page, 'child.ts').waitFor()
      await page.keyboard.press('ArrowDown')
      await assertListFocus(folders)
      await step('folder-child-row')
      await page.keyboard.press('Escape')
      await selectors.editorGroupInput(page, 0).focus()
      await page.keyboard.press('Control+Home')
      await page.keyboard.press('ArrowDown')
      await selectors.breadcrumbCrumb(page, 'patternExample').waitFor({ timeout: 30_000 })
      await selectors.breadcrumbCrumb(page, 'patternExample').click()
      const symbols = selectors.symbolPickerTree(page)
      await symbols.waitFor()
      await symbols.focus()
      await page.keyboard.press('Home')
      await step('symbol-first-row')
      await page.keyboard.press('ArrowDown')
      await assertListFocus(symbols)
      await step('symbol-next-row')
    }),
}

export const lspReferences: Scenario = {
  name: 'lsp-references',
  description: 'Open real TypeScript references, move between rows and collapse their group.',
  run: (page, { step }) =>
    withPatternFixture(page, async () => {
      await selectors.editorGroupInput(page, 0).focus()
      await page.keyboard.press('Control+Home')
      await page.keyboard.press('ArrowDown')
      await selectors.breadcrumbCrumb(page, 'patternExample').waitFor({ timeout: 30_000 })
      await page.keyboard.press('Control+Home')
      for (let column = 0; column < 18; column += 1) await page.keyboard.press('ArrowRight')
      await runPaletteCommand(page, 'Find references')
      const list = selectors.referenceResults(page)
      await list.waitFor({ timeout: 30_000 })
      await list.focus()
      await page.keyboard.press('Home')
      await step('reference-group')
      await page.keyboard.press('ArrowDown')
      await assertListFocus(list)
      await step('reference-selected')
      await page.keyboard.press('Home')
      await page.keyboard.press('ArrowLeft')
      strictEqual(await selectors.patternRows(list).count(), 1)
      await step('reference-collapsed')
    }),
}

export const environmentsDialog: Scenario = {
  name: 'environments-dialog',
  description: 'Open machine discovery without connecting, and navigate any existing SSH hosts.',
  async run(page, { step }) {
    await selectors.projectMenu(page).click()
    await selectors.connectMachineMenu(page).click()
    if (!(await selectors.machineTarget(page).isVisible())) await selectors.machineAdd(page).click()
    await selectors.machineTarget(page).waitFor()
    await step('machine-discovery')
    const list = selectors.sshHostList(page)
    if (await list.isVisible()) {
      await list.focus()
      await page.keyboard.press('Home')
      await page.keyboard.press('ArrowDown')
      await assertListFocus(list)
      await step('host-selected')
    }
    await page.keyboard.press('Escape')
  },
  inspect: async (page) => ({
    discoveryClosed: !(await selectors.machineTarget(page).isVisible()),
  }),
}

export const chatChangedFiles: Scenario = {
  name: 'chat-changed-files',
  description: 'Inspect an existing session checkpoint tree without sending a message.',
  async run(page, { step }) {
    await runPaletteCommand(page, 'Chat mode')
    const sessions = selectors.sessionRows(page)
    const count = Math.min(await sessions.count(), 8)
    for (let index = 0; index < count; index += 1) {
      await sessions.nth(index).click()
      if ((await selectors.changedFilesSections(page).count()) > 0) break
    }
    if ((await selectors.expandChangedFiles(page).count()) > 0)
      await selectors.expandChangedFiles(page).first().click()
    const tree = selectors.changedFilesTree(page).first()
    if (!(await tree.isVisible())) {
      await step('no-existing-checkpoint-tree')
      return
    }
    await tree.scrollIntoViewIfNeeded()
    await tree.focus()
    await page.keyboard.press('Home')
    await step('changed-files-first-row')
    await page.keyboard.press('ArrowRight')
    await page.keyboard.press('ArrowDown')
    await assertListFocus(tree)
    await step('changed-files-next-row')
  },
  inspect: async (page) => ({
    treeAvailable: (await selectors.changedFilesTree(page).count()) > 0,
  }),
}

async function assertListFocus(list: Locator) {
  strictEqual(
    await list.evaluate((element) => element === element.ownerDocument.activeElement),
    true,
    await list.evaluate((element) => element.ownerDocument.activeElement?.outerHTML ?? 'no focus'),
  )
  ok(await list.getAttribute('aria-activedescendant'))
  strictEqual(await selectors.selectedPatternRows(list).count(), 1)
  const tabIndices = await selectors
    .patternRows(list)
    .evaluateAll((rows) => rows.map((row) => row.getAttribute('tabindex')))
  ok(tabIndices.every((value) => value === '-1'))
}

async function withPatternFixture(page: Page, run: () => Promise<void>) {
  const fixture = await mkdtemp('/work/tmp/fregat-pattern-extras-')
  const original = page.url()
  try {
    await mkdir(path.join(fixture, 'folder'))
    await writeFile(path.join(fixture, 'folder/child.ts'), 'export const child = 1\n')
    await writeFile(path.join(fixture, 'regions.ts'), source)
    await writeFile(path.join(fixture, 'README.md'), '# Pattern fixture\n')
    await fixtureGit(fixture, ['init', '--quiet'])
    await fixtureGit(fixture, ['add', '.'])
    await fixtureGit(fixture, [
      '-c',
      'user.name=Pattern verification',
      '-c',
      'user.email=patterns@example.invalid',
      'commit',
      '--quiet',
      '-m',
      'Fixture',
    ])
    await openFixtureWorkspace(page, fixture)
    await openFileFromTree(page, 'regions.ts')
    await run()
  } finally {
    await page.goto(original)
    await waitForApp(page)
    await releaseFixture(fixture)
  }
}

export const patternHints: Scenario = {
  name: 'pattern-hints',
  description: 'Inspect shared icon hints and open their menus without changing chat.',
  async run(page, { step }) {
    await runPaletteCommand(page, 'Workbench mode')
    await runPaletteCommand(page, 'Show chat')
    await selectors.chatHeaderNew(page).hover()
    await step('chat-header')
    await selectors.hint(page, 'New chat').waitFor()
    await step('chat-new-hint')
    const history = selectors.chatHeaderHistory(page)
    await history.hover()
    const historyHint = selectors.hint(page, 'Conversation history')
    await historyHint.waitFor()
    ok(await historyHint.getAttribute('data-instant'))
    strictEqual(
      await historyHint.evaluate((element) => getComputedStyle(element).animationDuration),
      '0s',
    )
    await step('instant-history-hint')
    await history.click()
    await selectors.popupMenu(page).waitFor()
    await selectors.popupMenu(page).evaluate(async (element) => {
      await Promise.all(element.getAnimations().map((animation) => animation.finished))
    })
    await step('chat-history-menu')
    await page.keyboard.press('Escape')
  },
}
