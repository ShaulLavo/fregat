import { ok } from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { Page } from 'playwright'
import { committedFixture, openFixtureWorkspace } from '../fixture-workspace'
import {
  runPaletteCommand,
  selectors,
  workbenchAlignmentSelectors as alignment,
} from '../selectors'
import { treeRow } from '../tree-parity/states'
import { inspectTreeOcclusion } from '../tree-occlusion'
import type { Scenario } from './index'

const observations = new WeakMap<Page, unknown[]>()
const files = [
  'editor/a.ts',
  'editor/packages/collaboration/a.ts',
  'editor/packages/editor/a.ts',
  ...Array.from(
    { length: 70 },
    (_, index) => `editor/packages/editor/item-${String(index).padStart(2, '0')}.ts`,
  ),
]
const orderedRows = [
  'editor/',
  'editor/packages/',
  'editor/packages/collaboration/',
  'editor/packages/editor/',
  ...files.slice(2),
  'editor/a.ts',
  'a.txt',
]
type Measure = {
  record: (value: unknown) => void
  check: (condition: boolean, message: string) => void
  step: (name: string) => Promise<void>
  density: 'cozy' | 'compact'
}

export const workbenchAlignment: Scenario = {
  name: 'workbench-alignment',
  requiresIsolatedServer: true,
  description:
    'Measure workbench bars, icon lanes, UI fonts and deep sticky tree rows in both densities.',
  inspect: async (page) => observations.get(page),
  async run(page, { step }) {
    const fixture = await committedFixture('workbench-alignment')
    const measured: unknown[] = []
    const failures: string[] = []
    observations.set(page, measured)
    try {
      for (const name of files) {
        await mkdir(path.dirname(path.join(fixture.path, name)), { recursive: true })
        await writeFile(path.join(fixture.path, name), 'export {}\n')
      }
      await openFixtureWorkspace(page, fixture.path)
      await page.evaluate(() => document.fonts.ready)
      if (!(await selectors.folderTree(page).isVisible()))
        await selectors.sidebarTab(page, 'Files').click()
      for (const folder of ['editor/', 'editor/packages/', 'editor/packages/editor/'])
        await treeRow(page, folder).click()
      await treeRow(page, 'editor/packages/editor/item-00.ts').waitFor()
      await treeRow(page, 'editor/packages/editor/item-00.ts').click()
      await runPaletteCommand(page, 'Show terminal')
      await selectors.bottomTab(page, 'Problems').click()
      for (const density of ['cozy', 'compact'] as const) {
        await page.evaluate((value) => {
          document.documentElement.dataset.density = value
        }, density)
        await page.waitForTimeout(250)
        await alignment.scroll(page).evaluate((node) => {
          node.scrollTop = 0
        })
        const measure: Measure = {
          density,
          step,
          record: (value) => measured.push({ density, value }),
          check: (condition, message) => {
            if (!condition) failures.push(`${density}: ${message}`)
          },
        }
        await measureChrome(page, measure)
        await measureSeams(page, measure)
        await measureTabs(page, measure)
        await measureTree(page, measure)
      }
      ok(failures.length === 0, failures.join('\n'))
    } finally {
      // Detach workspace subscriptions before removing the files they observe.
      await page.goto('about:blank')
      await fixture.release()
    }
  },
}

async function measureChrome(page: Page, { density, record, check, step }: Measure) {
  const railCenters = await selectors.workspaceRailButtons(page, 'Workbench').evaluateAll((nodes) =>
    nodes.map((node) => {
      const box = node.querySelector('svg')!.getBoundingClientRect()
      return box.x + box.width / 2
    }),
  )
  check(railCenters.length >= 5, 'rail icons mounted')
  check(Math.max(...railCenters) - Math.min(...railCenters) <= 0.5, 'rail icon column')
  const bars = await alignment.bars(page).evaluateAll((nodes) =>
    nodes
      .filter((node) => node.getBoundingClientRect().height > 0)
      .map((node) => ({
        slot: node.getAttribute('data-slot'),
        height: node.getBoundingClientRect().height,
        expected:
          parseFloat(getComputedStyle(node).getPropertyValue('--bar-height')) *
          parseFloat(getComputedStyle(document.documentElement).fontSize),
      })),
  )
  for (const bar of bars)
    check(
      Math.abs(bar.height - bar.expected) <= 0.5,
      `${bar.slot} height ${bar.height}, expected ${bar.expected}`,
    )
  const filterFont = await alignment.filter(page).evaluate((node) => ({
    actual: getComputedStyle(node).fontFamily,
    expected: getComputedStyle(document.body).fontFamily,
  }))
  check(
    filterFont.actual === filterFont.expected,
    `filter UI font ${filterFont.actual}, expected ${filterFont.expected}`,
  )
  record({ railCenters, bars, filterFont })
  const editorBar = await selectors.editorGroupTabStrip(page, 0).boundingBox()
  const actionColumns: number[] = []
  const titleEdges: number[] = []
  for (const pane of ['Git', 'Search', 'Logs', 'Chat', 'Files']) {
    const tab = alignment.railTab(page, pane)
    if ((await tab.getAttribute('aria-pressed')) !== 'true') await tab.click()
    const header = alignment.header(page)
    await header.waitFor()
    const box = await header.boundingBox()
    const title = await alignment.title(page).boundingBox()
    check(
      !!title && !!box && Math.abs(title.y + title.height / 2 - box.y - box.height / 2) <= 0.5,
      `${pane} title line center`,
    )
    const icons = await header.locator('svg').evaluateAll((nodes) =>
      nodes
        .filter((node) => getComputedStyle(node).position !== 'absolute')
        .map((node) => {
          const bounds = node.getBoundingClientRect()
          return { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 }
        }),
    )
    check(icons.length > 0, `${pane} action icons mounted`)
    if (icons.length > 0) actionColumns.push(icons.at(-1)!.x)
    if (title) titleEdges.push(title.x)
    record({ pane, header: box, title, icons })
    check(!!box && !!editorBar && Math.abs(box.y - editorBar.y) <= 0.5, `${pane} header top`)
    check(
      !!box && !!editorBar && Math.abs(box.height - editorBar.height) <= 0.5,
      `${pane} header height`,
    )
    for (const center of icons)
      check(
        !!box && Math.abs(center.y - box.y - box.height / 2) <= 0.5,
        `${pane} action icon center`,
      )
    await step(`${density}-${pane.toLowerCase()}`)
  }
  check(Math.max(...actionColumns) - Math.min(...actionColumns) <= 0.5, 'pane action icon column')
  check(Math.max(...titleEdges) - Math.min(...titleEdges) <= 0.5, 'pane title left edges')
  const title = await alignment.title(page).boundingBox()
  const field = await alignment.filterField(page).boundingBox()
  record({ title, field })
  check(
    !!title && !!field && Math.abs(title.x - field.x) <= 0.5,
    'pane title and filter field left edge',
  )
  await step(`${density}-chrome`)
}

async function measureSeams(page: Page, { record, check }: Measure) {
  const sidebar = await selectors.resizablePanel(page, 'sidebar').boundingBox()
  const editor = await selectors.resizablePanel(page, 'editor').boundingBox()
  const bottom = await selectors.resizablePanel(page, 'bottom').boundingBox()
  const handles = await selectors.panelHandles(page).evaluateAll((nodes) =>
    nodes.map((node) => ({
      orientation: node.getAttribute('aria-orientation'),
      bounds: node.getBoundingClientRect().toJSON(),
    })),
  )
  const tabStrip = await selectors.editorGroupTabStrip(page, 0).boundingBox()
  const gutter = await alignment.gutter(page).boundingBox()
  const editorSurface = await alignment.editor(page).boundingBox()
  record({ sidebar, editor, bottom, handles, tabStrip, gutter, editorSurface })
  check(
    !!gutter && !!tabStrip && Math.abs(gutter.x - tabStrip.x) <= 0.5,
    'editor gutter and tab strip left edge',
  )
  check(
    !!editorSurface && !!tabStrip && Math.abs(editorSurface.x - tabStrip.x) <= 0.5,
    'editor surface and tab strip left edge',
  )
  for (const handle of handles) {
    const box = handle.bounds
    if (handle.orientation === 'vertical') {
      check(!!sidebar && Math.abs(box.x - sidebar.x - sidebar.width) <= 0.5, 'sidebar resize seam')
      check(!!editor && Math.abs(editor.x - box.right) <= 0.5, 'editor resize seam')
      continue
    }
    check(
      !!editor && Math.abs(box.y - editor.y - editor.height) <= 0.5,
      'editor bottom resize seam',
    )
    check(!!bottom && Math.abs(bottom.y - box.bottom) <= 0.5, 'bottom panel resize seam')
  }
}

async function measureTree(page: Page, { density, record, check, step }: Measure) {
  const scroll = alignment.scroll(page)
  const rowHeight = await treeRow(page, 'editor/packages/editor/item-00.ts').evaluate(
    (node) => node.getBoundingClientRect().height,
  )
  const lanes = await alignment.lanes(page).evaluateAll((nodes) =>
    nodes.map((node) => {
      const row = node.closest('[role="treeitem"]')!
      const box = node.getBoundingClientRect()
      const indent = parseFloat(getComputedStyle(node.parentElement!).paddingInlineStart)
      return {
        path: row.getAttribute('data-item-path'),
        center: box.x + box.width / 2 - indent,
      }
    }),
  )
  check(lanes.length >= 2, 'tree icon lanes mounted')
  record({ lanes })
  const centers = lanes.map((lane) => lane.center)
  check(
    Math.max(...centers) - Math.min(...centers) <= 0.5,
    'tree chevron and file icon columns across depths',
  )
  for (const offset of [
    0,
    1,
    rowHeight / 2,
    rowHeight - 1,
    rowHeight,
    rowHeight + 1,
    2 * rowHeight,
    3 * rowHeight,
    4 * rowHeight + 1,
    10 * rowHeight,
  ]) {
    await scroll.hover()
    const previousTop = await scroll.evaluate((node) => node.scrollTop)
    await page.mouse.wheel(0, offset - previousTop)
    await page.waitForTimeout(120)
    const rows = await alignment.flowRows(page).evaluateAll((nodes) =>
      nodes.map((node) => ({
        path: node.getAttribute('data-item-path')!,
        top: node.getBoundingClientRect().top,
        height: node.getBoundingClientRect().height,
      })),
    )
    check(rows.length >= 2, 'tree rows mounted')
    const scrollBox = await scroll.boundingBox()
    const scrollTop = await scroll.evaluate((node) => node.scrollTop)
    record({
      offset,
      rowHeight,
      scrollTop,
      scrollBox,
      rows,
      occlusion: await inspectTreeOcclusion(page),
    })
    await step(`${density}-scroll-${offset}`)
    for (const row of rows) {
      const rowIndex = orderedRows.indexOf(row.path)
      check(rowIndex >= 0, `known fixture row ${row.path}`)
      const expectedTop = scrollBox!.y + rowIndex * rowHeight - scrollTop
      check(
        Math.abs(row.top - expectedTop) <= 0.5,
        `${row.path} top ${row.top}, expected ${expectedTop}`,
      )
    }
  }
}

async function measureTabs(page: Page, { record, check }: Measure) {
  const tabs = await alignment.tabs(page).evaluateAll((nodes) =>
    nodes.map((node) => {
      const box = node.getBoundingClientRect()
      const icon = node.querySelector('svg')!.getBoundingClientRect()
      const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT)
      const lines: number[] = []
      while (walker.nextNode()) {
        if (!walker.currentNode.textContent?.trim()) continue
        const range = document.createRange()
        range.selectNode(walker.currentNode)
        const line = range.getBoundingClientRect()
        lines.push(line.y + line.height / 2)
      }
      return {
        label: node.textContent?.trim(),
        height: box.height,
        center: box.y + box.height / 2,
        iconCenter: icon.y + icon.height / 2,
        iconColumn: icon.x + icon.width / 2,
        lines,
      }
    }),
  )
  record({ tabs })
  check(tabs.length === 3, 'editor and bottom panel tabs mounted')
  check(
    tabs.length >= 2 && Math.abs(tabs[0]!.iconColumn - tabs[1]!.iconColumn) <= 0.5,
    'first editor and bottom tab icon column',
  )
  for (const tab of tabs) {
    check(Math.abs(tab.iconCenter - tab.center) <= 0.5, `${tab.label} tab icon center`)
    // Glyph ink is font-specific; compare identical UI-font line boxes across bars.
    check(tab.lines.length > 0, `${tab.label} tab text mounted`)
  }
  const offsets = tabs.map((tab) => tab.lines[0]! - tab.center)
  check(Math.max(...offsets) - Math.min(...offsets) <= 0.5, 'tab text line alignment')
  check(
    Math.max(...tabs.map((tab) => tab.height)) - Math.min(...tabs.map((tab) => tab.height)) <= 0.5,
    'editor and bottom tab heights',
  )
}
