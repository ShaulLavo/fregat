import { ok } from 'node:assert'
import type { Page } from 'playwright'

import {
  searchEditorGeometrySelectors,
  selectedEditorFileTabSelector,
  selectors,
} from '../selectors'
import { openVisualSearch, paintVisualSearch } from './visual-search-drive'
import type { Scenario } from './index'

type Snapshot = Awaited<ReturnType<typeof visibleResults>>
type Inspection = { phases: { phase: string; snapshot: Snapshot }[]; openedPath: string | null }
const inspections = new WeakMap<Page, Inspection>()

export const visualSearchScrollContent: Scenario = {
  name: 'visual-search-scroll-content',
  description:
    'Scroll and jump through visual search, check visible file blocks contain editors, then press Enter on a visible result and verify the opened file.',
  async run(page, { step }) {
    const inspection: Inspection = { phases: [], openedPath: null }
    inspections.set(page, inspection)
    await openVisualSearch(page)
    const viewport = await selectors.searchEditor(page).boundingBox()
    ok(viewport)
    await page.mouse.move(viewport.x + viewport.width / 2, viewport.y + viewport.height / 2)
    for (let index = 0; index < 6; index++) {
      await page.mouse.wheel(0, 480)
      await inspectVisible(page, inspection, `wheel-${index + 1}`, step)
    }
    for (const fraction of [0.1, 0.5, 0.85, 0.25]) {
      await selectors.searchEditor(page).evaluate((element, fraction) => {
        element.scrollTop = (element.scrollHeight - element.clientHeight) * fraction
      }, fraction)
      await inspectVisible(page, inspection, `jump-${fraction}`, step)
    }
    const target = await visibleOpenTarget(page)
    ok(target, 'A visible excerpt has its file header mounted')
    await page.mouse.click(target.x, target.y)
    await paintVisualSearch(page)
    await page.keyboard.press('Enter')
    await page.waitForFunction(
      ({ selector, path }) => {
        return document.querySelector(selector)?.getAttribute('data-editor-tab-path') === path
      },
      { selector: selectedEditorFileTabSelector, path: target.path },
    )
    inspection.openedPath = target.path
    await step('visible-result-opened')
  },
  async inspect(page) {
    return inspections.get(page)
  },
}

async function inspectVisible(
  page: Page,
  inspection: Inspection,
  phase: string,
  step: (label: string) => Promise<void>,
) {
  await paintVisualSearch(page)
  const snapshot = await visibleResults(page)
  inspection.phases.push({ phase, snapshot })
  await step(phase)
  ok(snapshot.blocks.length > 0, `${phase}: result blocks intersect the viewport`)
  for (const block of snapshot.blocks) {
    ok(block.editors > 0, `${phase}: visible block ${block.index} has an editor`)
    ok(block.rows > 0, `${phase}: visible block ${block.index} has rendered text`)
  }
}

async function visibleResults(page: Page) {
  return selectors.searchEditor(page).evaluate((element, handles) => {
    const viewport = element.getBoundingClientRect()
    const blocks = Array.from(element.querySelectorAll(handles.result))
      .map((block) => {
        const rect = block.getBoundingClientRect()
        return {
          index: block.getAttribute('data-index'),
          intersection: Math.min(rect.bottom, viewport.bottom) - Math.max(rect.top, viewport.top),
          editors: block.querySelectorAll(handles.editor).length,
          rows: block.querySelectorAll(handles.excerpt).length,
        }
      })
      .filter((block) => block.intersection >= 22)
    return { scrollTop: element.scrollTop, blocks }
  }, searchEditorGeometrySelectors)
}

async function visibleOpenTarget(page: Page) {
  return selectors.searchEditor(page).evaluate((element, handles) => {
    const viewport = element.getBoundingClientRect()
    const headers = Array.from(element.querySelectorAll(handles.header))
    const rows = Array.from(element.querySelectorAll(handles.excerpt))
    for (const row of rows) {
      const rect = row.getBoundingClientRect()
      if (rect.top < viewport.top || rect.bottom > viewport.bottom) continue
      const index = Number(row.closest(handles.result)?.getAttribute('data-index'))
      const header = headers.find((entry) => Number(entry.getAttribute('data-index')) === index - 1)
      const path = header?.querySelector(handles.listRow)?.getAttribute('title')
      if (!path) continue
      return { path, x: Math.max(rect.left, viewport.left) + 20, y: rect.top + rect.height / 2 }
    }
    return null
  }, searchEditorGeometrySelectors)
}
