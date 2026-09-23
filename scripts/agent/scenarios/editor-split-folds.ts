import { fixtureGit, openFixtureWorkspace, releaseFixture } from '../fixture-workspace'
import { deepStrictEqual, ok, strictEqual } from 'node:assert'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { Page } from 'playwright'
import { openFileFromTree, selectors, waitForApp } from '../selectors'
import type { Scenario } from './index'

const sample = `export function foldedRegion() {
  const innerValue = 21
  const doubledValue = innerValue * 2
  return doubledValue
}

export const visibleAfterFold = true
`
const inspections = new WeakMap<Page, { phases: string[]; diskChanged: boolean }>()

export const editorSplitFolds: Scenario = {
  name: 'editor-split-folds',
  description:
    'Copy a collapsed structural fold, unfold one view, and preserve both views through split-tree remounts.',
  async run(page, { step }) {
    const fixture = await mkdtemp('/work/tmp/fregat-split-folds-')
    const diskPath = path.join(fixture, 'folds.ts')
    const originalUrl = page.url()
    const result = { phases: [] as string[], diskChanged: false }
    inspections.set(page, result)
    try {
      await writeFile(diskPath, sample)
      await fixtureGit(fixture, ['init', '--quiet'])
      await fixtureGit(fixture, ['add', 'folds.ts'])
      await fixtureGit(fixture, [
        '-c',
        'user.name=Fold verification',
        '-c',
        'user.email=fold@example.invalid',
        'commit',
        '--quiet',
        '-m',
        `Fold lifetime ${path.basename(fixture)}`,
      ])
      await openFixtureWorkspace(page, fixture)
      await openFileFromTree(page, 'folds.ts')
      await selectors.editorGroupStructuralFoldToggle(page, 0, false).waitFor()
      await selectors.editorGroupStructuralFoldToggle(page, 0, false).click()
      await assertFold(page, 0, true)
      result.phases.push('source-collapsed')
      await step('source-collapsed')
      const originalId = await tabId(page, 0)

      await splitFromMenu(page, 0, 'Split Right')
      await assertFold(page, 0, true)
      await assertFold(page, 1, true)
      const copiedId = await tabId(page, 1)
      ok(originalId !== copiedId, 'copied fold belongs to a new tab view')
      result.phases.push('copy-inherits-collapse')
      await step('copy-inherits-collapse')

      await selectors.editorGroupStructuralFoldToggle(page, 1, true).click()
      await assertFold(page, 1, false)
      await assertFold(page, 0, true)
      result.phases.push('independent-unfold')
      await step('independent-unfold')

      const beforeNesting = await selectors.editorGroupInput(page, 1).elementHandle()
      ok(beforeNesting)
      await splitFromMenu(page, 1, 'Split Down')
      await assertFold(page, 0, true)
      await assertFold(page, 1, false)
      await assertFold(page, 2, false)
      strictEqual(
        await beforeNesting.evaluate((element) => element.isConnected),
        false,
        'nesting remounted the surviving editor view',
      )
      result.phases.push('nested-remount-keeps-folds')
      await step('nested-remount-keeps-folds')

      const beforeCollapse = await selectors.editorGroupInput(page, 1).elementHandle()
      ok(beforeCollapse)
      await dragTab(page, 2, 0, 'center')
      await selectors.editorGroups(page).nth(2).waitFor({ state: 'hidden' })
      await assertFold(page, 0, true)
      await assertFold(page, 1, false)
      strictEqual(
        await beforeCollapse.evaluate((element) => element.isConnected),
        false,
        'collapsing the empty branch remounted its survivor',
      )
      deepStrictEqual([await tabId(page, 0), await tabId(page, 1)], [originalId, copiedId])
      result.phases.push('collapse-keeps-folds')
      await step('collapse-keeps-folds')

      await dragTab(page, 1, 0, 'top')
      await assertFold(page, 0, false)
      await assertFold(page, 1, true)
      deepStrictEqual([await tabId(page, 0), await tabId(page, 1)], [copiedId, originalId])
      result.phases.push('move-keeps-both-view-states')
      await step('move-keeps-both-view-states')
      result.diskChanged = (await readFile(diskPath, 'utf8')) !== sample
      strictEqual(result.diskChanged, false, 'fold gestures never changed the file')
    } finally {
      await page.goto(originalUrl)
      await waitForApp(page)
      await releaseFixture(fixture)
    }
  },
  async inspect(page) {
    return inspections.get(page)
  },
}

async function assertFold(page: Page, index: number, collapsed: boolean) {
  await selectors.editorGroupInput(page, index).waitFor()
  await selectors.editorGroupStructuralFoldToggle(page, index, collapsed).waitFor()
  strictEqual(await selectors.editorGroupStructuralFoldToggle(page, index, !collapsed).count(), 0)
}

async function tabId(page: Page, index: number) {
  return selectors.editorGroupTabs(page, index).first().getAttribute('data-editor-tab-id')
}

async function splitFromMenu(page: Page, index: number, command: 'Split Right' | 'Split Down') {
  await selectors.editorGroupTabs(page, index).first().click({ button: 'right' })
  await selectors.menuItem(page, command).click()
}

async function dragTab(page: Page, source: number, destination: number, edge: 'center' | 'top') {
  const tab = await selectors.editorGroupTabs(page, source).first().boundingBox()
  const target = await selectors.editorGroupContent(page, destination).boundingBox()
  ok(tab && target, 'drag source and destination are visible')
  const x = target.x + target.width / 2
  const y = edge === 'top' ? target.y + 12 : target.y + target.height / 2
  await page.mouse.move(tab.x + 30, tab.y + tab.height / 2)
  await page.mouse.down()
  await page.mouse.move(tab.x + 45, tab.y + 45, { steps: 4 })
  await page.mouse.move(x, y, { steps: 16 })
  await selectors.editorDropPreview(page).waitFor()
  await page.mouse.up()
}
