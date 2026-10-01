import { ok, strictEqual } from 'node:assert/strict'
import { chmod, mkdtemp, open, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { ElementHandle, Page } from 'playwright'
import {
  fixtureGit,
  openFixtureWorkspace,
  releaseFixture,
  waitForFileContent,
} from '../fixture-workspace'
import { scratchPath } from '../paths'
import { connectSecondOwner, type SecondOwner } from '../second-owner'
import { csvSelectors, focusEditor, openFileFromTree, selectors, waitForApp } from '../selectors'
import { collectOrchestrationBases } from './chat-verification'
import type { Scenario } from './index'

const ORIGINAL = '﻿"name";"notes";\r\n"pear";"two\r\nlines";\r\n'
const EDITED = ORIGINAL.replace('"pear"', '"peach"')

export const csvTable: Scenario = {
  name: 'csv-table',
  description:
    'Edit CSV cells over the live buffer, undo in text, retain per-tab views, save to the remote owner and follow external edits.',
  requiresIsolatedServer: true,
  async run(page, { step }) {
    const root = await mkdtemp(scratchPath('fregat-csv-table-'))
    const file = path.join(root, 'fruit.csv')
    let second: SecondOwner | null = null
    const writes: string[] = []
    page.on('request', (request) => {
      if (request.method() === 'POST' && new URL(request.url()).pathname.endsWith('/fs/write'))
        writes.push(request.url())
    })
    const delayed = Promise.withResolvers<void>()
    try {
      await fixtureGit(root, ['init', '--quiet'])
      await fixtureGit(root, ['config', 'user.name', 'Fregat'])
      await fixtureGit(root, ['config', 'user.email', 'fregat@example.com'])
      await writeFile(file, ORIGINAL)
      await writeFile(path.join(root, 'other.csv'), 'value,count\nother,1\n')
      await writeFile(path.join(root, 'malformed.csv'), 'a,b\n"unclosed,b')
      await fixtureGit(root, ['add', 'fruit.csv', 'other.csv', 'malformed.csv'])
      await fixtureGit(root, ['commit', '--quiet', '-m', 'CSV fixture'])
      await openFixtureWorkspace(page, root)
      second = await connectSecondOwner(page, collectOrchestrationBases(page))
      const headers = { Origin: new URL(page.url()).origin }
      const health = await page.request.get(`${second.origin}/health`, { headers })
      const identity = await health.json()
      const address = await page.request.post(`${second.origin}/fs/workspace-address`, {
        headers,
        data: { path: root.slice(1) },
      })
      ok(address.ok(), 'Remote owner must issue the workspace address')
      const workspace = await address.json()
      const token = encodeURIComponent(`${workspace.name}.${workspace.id}`)
      await page.goto(
        `${new URL(page.url()).origin}/@${identity.environmentId}/~${token}/workbench`,
      )
      await waitForApp(page)
      await openFileFromTree(page, 'fruit.csv')
      await step('remote-csv-text')

      await page.route(csvSelectors.engineModule, async (route) => {
        await delayed.promise
        await route.continue()
      })
      await csvSelectors.mode(page, 'Table').click()
      await csvSelectors.preparing(page).waitFor()
      strictEqual(
        await selectors.editorInput(page).isVisible(),
        true,
        'Text stays whole while the engine loads',
      )
      strictEqual(await csvSelectors.mode(page, 'Text').getAttribute('aria-pressed'), 'true')
      await step('table-readiness-retains-text')
      delayed.resolve()
      await csvSelectors.table(page).waitFor()
      await csvSelectors.cell(page, 2, 1).waitFor()
      strictEqual(await csvSelectors.cell(page, 2, 2).getAttribute('title'), 'two\nlines')
      strictEqual(await csvSelectors.cell(page, 2, 3).getAttribute('title'), '')
      await step('table-without-header')

      await csvSelectors.header(page).click()
      strictEqual(
        await csvSelectors.table(page).getByRole('columnheader').first().innerText(),
        'name',
      )
      await csvSelectors.cell(page, 2, 1).focus()
      await page.keyboard.press('Enter')
      await csvSelectors.cellEditor(page, 2, 1).fill('cancelled')
      await page.keyboard.press('Escape')
      strictEqual(await csvSelectors.cell(page, 2, 1).getAttribute('title'), 'pear')
      await csvSelectors.cell(page, 2, 1).dblclick()
      await csvSelectors.cellEditor(page, 2, 1).fill('peach')
      await step('activated-cell-editor')
      await page.keyboard.press('Tab')
      strictEqual(
        await csvSelectors.cell(page, 2, 2).evaluate((cell) => cell === document.activeElement),
        true,
      )
      await step('edited-table-cell')
      await csvSelectors.mode(page, 'Text').click()
      await selectors.editorRows(page).filter({ hasText: 'peach' }).waitFor()
      await step('text-shows-table-edit')
      await focusEditor(page)
      await page.keyboard.press('Control+z')
      await selectors.editorRows(page).filter({ hasText: 'pear' }).waitFor()
      await csvSelectors.mode(page, 'Table').click()
      strictEqual(await csvSelectors.cell(page, 2, 1).getAttribute('title'), 'pear')
      strictEqual(await csvSelectors.header(page).getAttribute('aria-pressed'), 'true')
      await step('text-undo-restores-table')
      await csvSelectors.redo(page).click()
      strictEqual(await csvSelectors.cell(page, 2, 1).getAttribute('title'), 'peach')
      await csvSelectors.cell(page, 2, 1).focus()
      await page.keyboard.press('Control+s')
      await waitForFileContent(file, EDITED)
      ok(writes.length > 0, 'Save must write the CSV')
      ok(
        writes.every((url) => new URL(url).port === new URL(second!.origin).port),
        'CSV saves must reach the remote owner',
      )
      await step('remote-save-preserves-original-bytes')

      await csvSelectors.mode(page, 'Text').click()
      await openFileFromTree(page, 'other.csv')
      strictEqual(await csvSelectors.mode(page, 'Text').getAttribute('aria-pressed'), 'true')
      await csvSelectors.mode(page, 'Table').click()
      await csvSelectors.table(page).waitFor()
      await selectors.editorTabNamed(page, /fruit\.csv/u).click()
      strictEqual(await csvSelectors.mode(page, 'Text').getAttribute('aria-pressed'), 'true')
      await csvSelectors.mode(page, 'Table').click()
      await csvSelectors.cell(page, 2, 1).waitFor()
      const external = EDITED.replace('"peach"', '"plum"')
      await writeFile(file, external)
      await page.waitForFunction(
        (input) => input instanceof HTMLElement && input.title === 'plum',
        await csvSelectors.cell(page, 2, 1).elementHandle(),
      )
      await step('external-edit-updates-table')
      await csvSelectors.mode(page, 'Text').click()
      await openFileFromTree(page, 'malformed.csv')
      await csvSelectors.mode(page, 'Table').click()
      await csvSelectors.parseError(page).waitFor()
      await step('malformed-csv-contained')
      await csvSelectors.mode(page, 'Text').click()
      await selectors.editorRows(page).filter({ hasText: 'unclosed' }).waitFor()
      await step('malformed-source-remains-editable')
    } finally {
      delayed.resolve()
      await page.unroute(csvSelectors.engineModule)
      await page.goto('about:blank')
      await releaseFixture(root)
      await second?.stop()
    }
  },
}

export const csvQueryFailure: Scenario = {
  name: 'csv-query-failure',
  description:
    'Show CSV file read failures, retry the original query and retain the tab presentation choice.',
  requiresIsolatedServer: true,
  async run(page, { step }) {
    const root = await mkdtemp(scratchPath('fregat-csv-query-'))
    const file = path.join(root, 'fruit.csv')
    try {
      await writeFile(file, ORIGINAL)
      await chmod(file, 0)
      await openFixtureWorkspace(page, root)
      await selectors.treeItem(page, 'fruit.csv').click()
      await csvSelectors.queryRetry(page).waitFor()
      strictEqual(await csvSelectors.preparing(page).count(), 0)
      await step('initial-csv-query-failure-visible')
      await chmod(file, 0o600)
      await csvSelectors.queryRetry(page).click()
      await csvSelectors.mode(page, 'Table').click()
      await csvSelectors.cell(page, 2, 1).waitFor()
      await step('csv-query-retry-loads-table')

      await denyCsvRead(file)
      await csvSelectors.queryRetry(page).waitFor()
      strictEqual(await csvSelectors.preparing(page).count(), 0)
      await selectors.editorRows(page).filter({ hasText: 'pear' }).waitFor()
      await step('table-query-failure-retains-source')
      await chmod(file, 0o600)
      await csvSelectors.queryRetry(page).click()
      await csvSelectors.cell(page, 2, 1).waitFor()
      strictEqual(await csvSelectors.cell(page, 2, 1).getAttribute('title'), 'peach')
      await step('query-retry-restores-table-choice')
    } finally {
      await chmod(file, 0o600)
      await page.goto('about:blank')
      await releaseFixture(root)
    }
  },
}

export const csvEngineFailure: Scenario = {
  name: 'csv-engine-failure',
  description:
    'Fail the CSV code import, keep source text available and recover through a page reload.',
  requiresIsolatedServer: true,
  async run(page, { step }) {
    const root = await mkdtemp(scratchPath('fregat-csv-engine-'))
    try {
      await writeFile(path.join(root, 'fruit.csv'), ORIGINAL)
      await openFixtureWorkspace(page, root)
      await openFileFromTree(page, 'fruit.csv')
      await page.route(csvSelectors.engineModule, (route) => route.abort('failed'))
      await csvSelectors.mode(page, 'Table').click()
      await csvSelectors.engineError(page).waitFor()
      await step('engine-failure-contained')
      await csvSelectors.mode(page, 'Text').click()
      await selectors.editorRows(page).filter({ hasText: 'pear' }).waitFor()
      await step('source-available-after-engine-error')
      await page.unroute(csvSelectors.engineModule)
      await csvSelectors.mode(page, 'Table').click()
      await csvSelectors.engineError(page).waitFor()
      await selectors.reloadApp(page).click()
      await waitForApp(page)
      await csvSelectors.mode(page, 'Table').click()
      await csvSelectors.cell(page, 2, 1).waitFor()
      await step('table-recovers-after-reload')
    } finally {
      await page.unroute(csvSelectors.engineModule)
      await page.goto('about:blank')
      await releaseFixture(root)
    }
  },
}

export const csvTextSave: Scenario = {
  name: 'csv-text-save',
  description: 'Round-trip BOM and CRLF through the ordinary text editor save owner.',
  requiresIsolatedServer: true,
  async run(page, { step }) {
    const root = await mkdtemp(scratchPath('fregat-csv-text-save-'))
    const file = path.join(root, 'ordinary.txt')
    try {
      await writeFile(file, ORIGINAL)
      await openFixtureWorkspace(page, root)
      await openFileFromTree(page, 'ordinary.txt')
      await focusEditor(page)
      await page.keyboard.press('Control+End')
      await page.keyboard.type('tail')
      await page.keyboard.press('Control+s')
      await waitForFileContent(file, ORIGINAL + 'tail')
      await step('ordinary-text-save-preserves-format')
    } finally {
      await page.goto('about:blank')
      await releaseFixture(root)
    }
  },
}

export const csvKeyboardNavigation: Scenario = {
  name: 'csv-keyboard-navigation',
  description:
    'Reveal a virtualized CSV row with keyboard navigation and keep focus at the final cell.',
  requiresIsolatedServer: true,
  async run(page, { step }) {
    const root = await mkdtemp(scratchPath('fregat-csv-keyboard-'))
    try {
      await writeFile(
        path.join(root, 'many.csv'),
        Array.from({ length: 150 }, (_, row) => `value ${row + 1},${row + 1}`).join('\n'),
      )
      await writeFile(
        path.join(root, 'wide.csv'),
        Array.from({ length: 100 }, (_, row) =>
          Array.from({ length: 20 }, (_, column) => `row ${row + 1} column ${column + 1}`).join(
            ',',
          ),
        ).join('\n'),
      )
      await openFixtureWorkspace(page, root)
      await openFileFromTree(page, 'many.csv')
      await csvSelectors.mode(page, 'Table').click()
      await csvSelectors.cell(page, 1, 1).waitFor()
      await step('initial-virtualized-grid')
      const geometry = await csvSelectors.table(page).evaluate((table) => ({
        viewport: window.innerHeight,
        table: table.getBoundingClientRect().height,
        rows: table.querySelector('[role="rowgroup"]')?.getBoundingClientRect().height,
      }))
      strictEqual(
        await csvSelectors.cell(page, 150, 1).count(),
        0,
        `Distant rows begin unmounted: ${JSON.stringify(geometry)}`,
      )
      await csvSelectors.cell(page, 1, 1).focus()
      await page.keyboard.press('End')
      await csvSelectors.cell(page, 150, 1).waitFor()
      strictEqual(
        await csvSelectors.cell(page, 150, 1).evaluate((cell) => cell === document.activeElement),
        true,
      )
      await step('keyboard-reveals-unmounted-row')
      await page.keyboard.press('Enter')
      await page.keyboard.press('Tab')
      strictEqual(
        await csvSelectors.cell(page, 150, 2).evaluate((cell) => cell === document.activeElement),
        true,
      )
      await page.keyboard.press('Enter')
      await page.keyboard.press('Tab')
      strictEqual(
        await csvSelectors.cell(page, 150, 2).evaluate((cell) => cell === document.activeElement),
        true,
      )
      await step('final-cell-commit-keeps-focus')
      await openFileFromTree(page, 'wide.csv')
      await csvSelectors.mode(page, 'Table').click()
      await csvSelectors.cell(page, 1, 1).waitFor()
      const scrollOwners = await csvSelectors.table(page).evaluate((table) =>
        [table, ...Array.from(table.querySelectorAll<HTMLElement>('*'))]
          .filter((element) => {
            const style = getComputedStyle(element)
            return (
              ['auto', 'scroll'].includes(style.overflowX) ||
              ['auto', 'scroll'].includes(style.overflowY)
            )
          })
          .map((element) => ({
            x: getComputedStyle(element).overflowX,
            y: getComputedStyle(element).overflowY,
          })),
      )
      strictEqual(scrollOwners.length, 1, 'One CSV scroller owns both axes')
      strictEqual(scrollOwners[0]?.x, 'auto')
      strictEqual(scrollOwners[0]?.y, 'auto')
      const heading = csvSelectors.table(page).getByRole('columnheader').last()
      const headerTop = await heading.evaluate((element) => element.getBoundingClientRect().top)
      async function assertVisibleColumn(column: number) {
        const bounds = await csvSelectors.scroll(page).evaluate((scroller) => ({
          left: scroller.getBoundingClientRect().left,
          right: scroller.getBoundingClientRect().left + scroller.clientWidth,
        }))
        const cell = await csvSelectors.cell(page, 1, column).evaluate((element) => ({
          left: element.getBoundingClientRect().left,
          right: element.getBoundingClientRect().right,
          focused: element === document.activeElement,
        }))
        ok(
          cell.focused && cell.left >= bounds.left - 1 && cell.right <= bounds.right + 1,
          `Keyboard column ${column} must be focused and visible: ${JSON.stringify({ cell, bounds })}`,
        )
      }
      await csvSelectors.cell(page, 1, 1).focus()
      for (let column = 2; column <= 20; column++) await page.keyboard.press('ArrowRight')
      await assertVisibleColumn(20)
      await step('keyboard-reveals-offscreen-column')
      for (let column = 19; column >= 1; column--) await page.keyboard.press('ArrowLeft')
      await assertVisibleColumn(1)
      await step('keyboard-reveals-first-column')
      for (let column = 2; column <= 6; column++) await page.keyboard.press('ArrowRight')
      await page.keyboard.press('Enter')
      await csvSelectors.cellEditor(page, 1, 6).fill('edited field')
      await page.keyboard.press('Tab')
      await assertVisibleColumn(7)
      strictEqual(await csvSelectors.cell(page, 1, 6).getAttribute('title'), 'edited field')
      await step('edited-tab-reveals-next-column')
      await csvSelectors.scroll(page).evaluate((scroller) => {
        scroller.scrollLeft = scroller.scrollWidth
      })
      const headerLeft = await heading.evaluate((element) => element.getBoundingClientRect().left)
      const cellLeft = await csvSelectors
        .cell(page, 1, 20)
        .evaluate((element) => element.getBoundingClientRect().left)
      ok(Math.abs(headerLeft - cellLeft) < 1, 'Headers and cells share horizontal scrolling')
      await csvSelectors.cell(page, 1, 20).focus()
      await page.keyboard.press('End')
      await csvSelectors.cell(page, 100, 20).waitFor()
      strictEqual(
        await heading.evaluate((element) => element.getBoundingClientRect().top),
        headerTop,
      )
      strictEqual(
        await csvSelectors
          .scroll(page)
          .evaluate((scroller) => getComputedStyle(scroller).maskImage),
        'none',
        'The sticky header stays readable at the scroll edge',
      )
      await step('wide-grid-header-alignment')
    } finally {
      await page.goto('about:blank')
      await releaseFixture(root)
    }
  },
}

export const csvPresentationReadiness: Scenario = {
  name: 'csv-presentation-readiness',
  description: 'Retain the same source while the CSV table chunk loads and a file read fails.',
  requiresIsolatedServer: true,
  async run(page, { step }) {
    const root = await mkdtemp(scratchPath('fregat-csv-presentation-'))
    const file = path.join(root, 'fruit.csv')
    const delayed = Promise.withResolvers<void>()
    try {
      await writeFile(file, ORIGINAL)
      await openFixtureWorkspace(page, root)
      await openFileFromTree(page, 'fruit.csv')
      const source = await selectors.editorInput(page).first().elementHandle()
      ok(source, 'The original source must be mounted')
      await page.route(csvSelectors.presentationModule, async (route) => {
        await delayed.promise
        await route.continue()
      })
      await csvSelectors.mode(page, 'Table').click()
      await csvSelectors.preparing(page).waitFor()
      await selectors.editorRows(page).filter({ hasText: 'pear' }).waitFor()
      strictEqual(await csvSelectors.mode(page, 'Text').getAttribute('aria-pressed'), 'true')
      await assertCsvSourceIdentity(page, source)
      await step('presentation-import-retains-same-source')

      await denyCsvRead(file)
      await csvSelectors.queryRetry(page).waitFor()
      strictEqual(await csvSelectors.preparing(page).count(), 0)
      await selectors.editorRows(page).filter({ hasText: 'pear' }).waitFor()
      await assertCsvSourceIdentity(page, source)
      await step('pending-presentation-retains-source-and-retry')
      const loaded = page.waitForResponse((response) =>
        response.url().includes('/utils/csv-presentation.ts'),
      )
      delayed.resolve()
      await (await loaded).finished()
      await csvSelectors.queryRetry(page).waitFor()
      strictEqual(await source.evaluate((node) => node.isConnected), true)
      await chmod(file, 0o600)
      await csvSelectors.queryRetry(page).click()
      await csvSelectors.cell(page, 2, 1).waitFor()
      strictEqual(await csvSelectors.cell(page, 2, 1).getAttribute('title'), 'peach')
      await step('loaded-presentation-retry-restores-table')
    } finally {
      delayed.resolve()
      await chmod(file, 0o600)
      await page.unroute(csvSelectors.presentationModule)
      await page.goto('about:blank')
      await releaseFixture(root)
    }
  },
}

export const csvPresentationFailure: Scenario = {
  name: 'csv-presentation-failure',
  description:
    'Contain a failed CSV table chunk while retaining source and recover through Reload app.',
  requiresIsolatedServer: true,
  async run(page, { step }) {
    const root = await mkdtemp(scratchPath('fregat-csv-chunk-failure-'))
    try {
      await writeFile(path.join(root, 'fruit.csv'), ORIGINAL)
      await openFixtureWorkspace(page, root)
      await openFileFromTree(page, 'fruit.csv')
      const source = await selectors.editorInput(page).first().elementHandle()
      ok(source, 'The original source must be mounted')
      await page.route(csvSelectors.presentationModule, (route) => route.abort('failed'))
      await csvSelectors.mode(page, 'Table').click()
      await csvSelectors.presentationError(page).waitFor()
      strictEqual(await csvSelectors.preparing(page).count(), 0)
      await selectors.editorRows(page).filter({ hasText: 'pear' }).waitFor()
      await assertCsvSourceIdentity(page, source)
      strictEqual(await source.evaluate((node) => node.isConnected), true)
      await step('failed-presentation-retains-same-source')
      await page.unroute(csvSelectors.presentationModule)
      await selectors.reloadApp(page).click()
      await waitForApp(page)
      await csvSelectors.mode(page, 'Table').click()
      await csvSelectors.cell(page, 2, 1).waitFor()
      strictEqual(await csvSelectors.cell(page, 2, 1).getAttribute('title'), 'pear')
      await step('presentation-recovers-after-reload')
    } finally {
      await page.unroute(csvSelectors.presentationModule)
      await page.goto('about:blank')
      await releaseFixture(root)
    }
  },
}

async function denyCsvRead(file: string) {
  const writer = await open(file, 'r+')
  try {
    await chmod(file, 0)
    await writer.writeFile(EDITED)
  } finally {
    await writer.close()
  }
}

async function assertCsvSourceIdentity(
  page: Page,
  source: ElementHandle<HTMLElement | SVGElement>,
) {
  strictEqual(
    await selectors
      .editorInput(page)
      .first()
      .evaluate((node, held) => node === held, source),
    true,
  )
}
