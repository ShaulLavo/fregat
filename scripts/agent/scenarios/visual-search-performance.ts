import { ok, strictEqual } from 'node:assert'
import type { Page } from 'playwright'

import {
  openFileByName,
  searchEditorFileRowSelector,
  searchEditorSelector,
  selectors,
} from '../selectors'
import type { Scenario } from './index'

type Snapshot = Awaited<ReturnType<typeof snapshot>>
type Measurement = { label: string; elapsedMs: number; snapshot: Snapshot }
const inspections = new WeakMap<Page, Measurement[]>()

export const visualSearchPerformance: Scenario = {
  name: 'visual-search-performance',
  description:
    'Search import, open highlighted results, wheel 20 times, jump halfway, drag the search tab into a split and back.',
  async run(page, { step }) {
    const measurements: Measurement[] = []
    inspections.set(page, measurements)
    await openFileByName(page, 'README.md')
    await selectors.sidebarTab(page, 'Search').click()
    await selectors.workspaceSearch(page).waitFor()
    await step('search-query-begin')
    let started = performance.now()
    await selectors.workspaceSearch(page).fill('import')
    await settledSearch(page)
    await record(page, measurements, 'search-query', started)
    await step('search-query-end')

    await step('open-results-begin')
    started = performance.now()
    await selectors.openSearchEditor(page).click()
    await paintedResults(page)
    await record(page, measurements, 'open-results', started)
    await step('open-results-end')
    const summary = measurements.at(-1)?.snapshot.summary ?? ''
    const fileCount = Number(summary.match(/in ([\d,]+) files/)?.[1]?.replaceAll(',', ''))
    ok(fileCount > 100, `Broad search needs over 100 files, got: ${summary}`)

    const box = await selectors.searchEditor(page).boundingBox()
    ok(box, 'Visual search has a scrollable viewport')
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await step('wheel-scroll-begin')
    started = performance.now()
    for (let index = 0; index < 20; index++) {
      await page.mouse.wheel(0, 1_200)
      await page.waitForTimeout(16)
    }
    await paintedResults(page)
    await record(page, measurements, 'wheel-scroll', started)
    await step('wheel-scroll-end')

    await step('jump-halfway-begin')
    started = performance.now()
    const previousIndex = await firstFileIndex(page)
    await selectors.searchEditor(page).evaluate((element) => {
      element.scrollTop = (element.scrollHeight - element.clientHeight) / 2
    })
    await page.waitForFunction(
      ({ viewportSelector, rowSelector, previousIndex }) => {
        const row = document.querySelector(viewportSelector)?.querySelector(rowSelector)
        return row?.getAttribute('data-index') !== previousIndex
      },
      {
        viewportSelector: searchEditorSelector,
        rowSelector: searchEditorFileRowSelector,
        previousIndex,
      },
    )
    await paintedResults(page)
    await record(page, measurements, 'jump-halfway', started)
    await step('jump-halfway-end')
    const preservedScrollTop = await selectors
      .searchEditor(page)
      .evaluate((element) => element.scrollTop)

    await step('split-search-begin')
    started = performance.now()
    await moveSearchTab(page, 0, 'right')
    await selectors.editorGroups(page).nth(1).waitFor()
    await paintedResults(page)
    strictEqual(await selectors.editorGroups(page).count(), 2)
    await assertSearchScroll(page, preservedScrollTop, 'Splitting preserves the search position')
    await record(page, measurements, 'split-search', started)
    await step('split-search-end')

    await step('merge-search-begin')
    started = performance.now()
    await moveSearchTab(page, 1, 'center')
    await selectors.editorGroups(page).nth(1).waitFor({ state: 'hidden' })
    await paintedResults(page)
    strictEqual(await selectors.editorGroups(page).count(), 1)
    await assertSearchScroll(page, preservedScrollTop, 'Merging preserves the search position')
    await record(page, measurements, 'merge-search', started)
    await step('merge-search-end')
  },
  async inspect(page) {
    return { query: 'import', measurements: inspections.get(page) ?? [] }
  },
}

async function settledSearch(page: Page) {
  await selectors.searchSummary(page).first().waitFor({ timeout: 90_000 })
  await page.waitForFunction(() => !document.body.textContent?.includes('Searching'), undefined, {
    timeout: 90_000,
  })
}

async function paintedResults(page: Page) {
  await selectors.searchEditorVisibleRows(page).first().waitFor({ timeout: 90_000 })
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
      }),
  )
  await page.waitForFunction(
    (selector) => {
      return Array.from(CSS.highlights.entries())
        .filter(([name]) => name.startsWith('editor-shared-token-'))
        .some(([, highlight]) =>
          Array.from(highlight).some((range) =>
            range.startContainer.parentElement?.closest(selector),
          ),
        )
    },
    searchEditorSelector,
    { timeout: 90_000 },
  )
}

async function firstFileIndex(page: Page) {
  return selectors
    .searchEditor(page)
    .evaluate(
      (element, selector) => element.querySelector(selector)?.getAttribute('data-index'),
      searchEditorFileRowSelector,
    )
}

async function snapshot(page: Page) {
  const viewport = await selectors.searchEditor(page).evaluateAll((elements) => {
    const element = elements[0]
    if (!element) return null
    return {
      scrollTop: element.scrollTop,
      scrollHeight: element.scrollHeight,
      clientHeight: element.clientHeight,
      descendants: element.getElementsByTagName('*').length,
    }
  })
  return {
    summary: await selectors.searchSummary(page).first().getAttribute('title'),
    viewport,
    groups: await selectors.editorGroups(page).count(),
    editorHosts: await selectors.searchEditorHosts(page).count(),
    editorRows: await selectors.searchEditorRows(page).count(),
    highlightGroups: await page.evaluate(() => CSS.highlights.size),
    highlightStyles: await selectors.editorHighlightStyles(page).evaluateAll((elements) => ({
      elements: elements.length,
      rules: elements.reduce(
        (count, element) =>
          count + Array.from(element.textContent.matchAll(/::highlight\(/g)).length,
        0,
      ),
      bytes: elements.reduce((count, element) => count + element.textContent.length, 0),
    })),
    syntaxTokenRanges: await page.evaluate(
      (selector) =>
        Array.from(CSS.highlights.entries())
          .filter(([name]) => name.startsWith('editor-shared-token-'))
          .flatMap(([, highlight]) => Array.from(highlight))
          .filter((range) => range.startContainer.parentElement?.closest(selector)).length,
      searchEditorSelector,
    ),
  }
}

async function record(page: Page, measurements: Measurement[], label: string, started: number) {
  const elapsedMs = performance.now() - started
  measurements.push({ label, elapsedMs, snapshot: await snapshot(page) })
}

async function assertSearchScroll(page: Page, expected: number, message: string) {
  strictEqual(
    await selectors.searchEditor(page).evaluate((element) => element.scrollTop),
    expected,
    message,
  )
}

async function moveSearchTab(page: Page, source: number, edge: 'right' | 'center') {
  const tab = await selectors
    .editorGroupTabs(page, source)
    .filter({ hasText: 'Search' })
    .boundingBox()
  const target = await selectors.editorGroupContent(page, 0).boundingBox()
  ok(tab && target, 'Search tab and destination are visible')
  const x = edge === 'right' ? target.x + target.width - 12 : target.x + target.width / 2
  const y = target.y + target.height / 2
  await page.mouse.move(tab.x + 35, tab.y + tab.height / 2)
  await page.mouse.down()
  await page.mouse.move(tab.x + 50, tab.y + tab.height / 2 + 12, { steps: 4 })
  await page.mouse.move(x, y, { steps: 16 })
  await selectors.editorDropPreview(page).waitFor()
  strictEqual(
    await selectors.editorDropPreview(page).getAttribute('data-editor-drop-preview'),
    edge,
  )
  await page.mouse.up()
}
