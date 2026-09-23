import { openFixtureWorkspace, releaseFixture } from '../fixture-workspace'
import { deepStrictEqual, ok, strictEqual } from 'node:assert'
import { mkdtemp, writeFile } from 'node:fs/promises'
import type { Page } from 'playwright'
import { createScriptError } from '../../structured-errors'
import { openFileFromTree, selectors, waitForApp } from '../selectors'
import type { Scenario } from './index'

const names = Array.from({ length: 8 }, (_, index) => `long-editor-tab-number-${index}.ts`)

export const editorSplitTargets: Scenario = {
  name: 'editor-split-targets',
  description:
    'Suppress unchanged drops, ignore clipped neighboring tabs, and insert accurately after tab-strip auto-scroll.',
  async run(page, { step }) {
    const fixture = await mkdtemp('/work/tmp/fregat-split-targets-')
    const originalUrl = page.url()
    try {
      await prepareFixture(fixture)
      await openFixtureWorkspace(page, fixture)
      for (const name of names) await openFileFromTree(page, name)
      await selectors.editorGroupTabs(page, 0).first().click()
      const initial = await tabIds(page, 0)
      const content = await selectors.editorGroupContent(page, 0).boundingBox()
      ok(content)
      await startDrag(page, 0, 0)
      await page.mouse.move(content.x + content.width / 2, content.y + content.height / 2, {
        steps: 12,
      })
      await step('same-group-center')
      await assertNoPreview(page)
      await page.mouse.up()
      deepStrictEqual(await tabIds(page, 0), initial)

      const first = await selectors.editorGroupTabs(page, 0).first().boundingBox()
      ok(first)
      await startDrag(page, 0, 0)
      await page.mouse.move(first.x + first.width * 0.25, first.y + first.height / 2, { steps: 8 })
      await assertNoPreview(page)
      await page.keyboard.down('Control')
      await assertNoPreview(page)
      await page.keyboard.up('Control')
      await page.mouse.up()
      deepStrictEqual(await tabIds(page, 0), initial)
      await step('unchanged-strip-position')

      await checkScrolledInsertion(page, initial)
      await step('inserted-before-tab-after-scroll')
      await selectors.editorGroupTabs(page, 0).last().click({ button: 'right' })
      await selectors.menuItem(page, 'Split Right').click()
      await selectors.editorGroups(page).nth(1).waitFor()
      await selectors.editorGroupTabs(page, 0).first().click()
      const left = await tabIds(page, 0)
      const right = await tabIds(page, 1)
      const source = await selectors.editorGroupTabs(page, 1).first().boundingBox()
      ok(source)
      await startDrag(page, 1, 0)
      await page.mouse.move(source.x + 25, source.y + source.height / 2, { steps: 12 })
      await step('clipped-neighbor-tabs-ignored')
      await assertNoPreview(page)
      await page.mouse.up()
      deepStrictEqual(await tabIds(page, 0), left)
      deepStrictEqual(await tabIds(page, 1), right)
      strictEqual(await selectors.editorGroups(page).count(), 2)
      await step('both-groups-unchanged')
      const neighbor = await selectors.editorGroupContent(page, 0).boundingBox()
      ok(neighbor)
      await startDrag(page, 1, 0)
      await page.mouse.move(neighbor.x + neighbor.width - 10, neighbor.y + neighbor.height / 2, {
        steps: 12,
      })
      await assertNoPreview(page)
      await page.mouse.up()
      deepStrictEqual(await tabIds(page, 0), left)
      deepStrictEqual(await tabIds(page, 1), right)
      await step('equivalent-edge-layout-ignored')
    } finally {
      await page.goto(originalUrl)
      await waitForApp(page)
      await releaseFixture(fixture)
    }
  },
}

async function assertNoPreview(page: Page) {
  await page.waitForTimeout(100)
  strictEqual(
    await selectors.editorDropPreview(page).count(),
    0,
    'unchanged drop has no content overlay',
  )
  strictEqual(
    await selectors.editorTabInsertion(page).count(),
    0,
    'unchanged drop has no insertion marker',
  )
}

async function checkScrolledInsertion(page: Page, initial: readonly (string | null)[]) {
  const strip = await selectors.editorGroupTabStrip(page, 0).boundingBox()
  ok(strip)
  await startDrag(page, 0, 0)
  await page.mouse.move(strip.x + strip.width - 6, strip.y + strip.height / 2, { steps: 12 })
  await page.waitForTimeout(850)
  const scrollLeft = await selectors
    .editorGroupTabStrip(page, 0)
    .evaluate((element) => element.scrollLeft)
  ok(scrollLeft > 100, 'tab strip scrolled during the drag')
  const tabs = await selectors.editorGroupTabs(page, 0).evaluateAll((elements) =>
    elements.map((element) => ({
      id: element.getAttribute('data-editor-tab-id'),
      left: element.getBoundingClientRect().left,
      right: element.getBoundingClientRect().right,
      width: element.getBoundingClientRect().width,
    })),
  )
  const middle = strip.x + strip.width / 2
  const target = tabs.find((tab) => tab.left < middle && tab.right > middle)
  ok(target && target.id !== initial[0])
  await page.mouse.move(target.left + target.width * 0.25, strip.y + strip.height / 2, { steps: 8 })
  await selectors.editorTabInsertion(page).waitFor()
  strictEqual(
    await selectors.editorInsertionBeforeTab(page).getAttribute('data-editor-tab-id'),
    target.id,
  )
  await page.mouse.up()
  await page.waitForTimeout(200)
  const expected = initial.filter((id) => id !== initial[0])
  expected.splice(expected.indexOf(target.id), 0, initial[0] ?? null)
  deepStrictEqual(await tabIds(page, 0), expected, 'drop inserts before the tab under the pointer')
}

async function startDrag(page: Page, group: number, index: number) {
  const source = await selectors.editorGroupTabs(page, group).nth(index).boundingBox()
  ok(source)
  await page.mouse.move(source.x + 25, source.y + source.height / 2)
  await page.mouse.down()
  await page.mouse.move(source.x + 35, source.y + 45, { steps: 4 })
}

async function tabIds(page: Page, group: number) {
  return selectors
    .editorGroupTabs(page, group)
    .evaluateAll((elements) =>
      elements.map((element) => element.getAttribute('data-editor-tab-id')),
    )
}

async function prepareFixture(fixture: string) {
  for (const name of names) await writeFile(`${fixture}/${name}`, 'export const value = 1\n')
  for (const args of [
    ['init', '--quiet'],
    ['add', '.'],
    [
      '-c',
      'user.name=Split verification',
      '-c',
      'user.email=split@example.invalid',
      'commit',
      '--quiet',
      '-m',
      fixture,
    ],
  ]) {
    const child = Bun.spawn(['git', '-C', fixture, ...args], { stdout: 'ignore', stderr: 'pipe' })
    if (await child.exited)
      throw createScriptError(`Split fixture failed: ${await new Response(child.stderr).text()}`)
  }
}
