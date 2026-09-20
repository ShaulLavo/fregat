import { ok, strictEqual } from 'node:assert'
import type { Page } from 'playwright'

import { preserveAppearance } from '../preserve-settings'
import { searchEditorGeometrySelectors, selectors } from '../selectors'
import { openVisualSearch } from './visual-search-drive'
import type { Scenario } from './index'

type Geometry = Awaited<ReturnType<typeof headerGeometry>>
const inspections = new WeakMap<Page, { phase: string; geometry: Geometry }[]>()

export const visualSearchHeaders: Scenario = {
  name: 'visual-search-headers',
  description:
    'Measure search header allocation, painted row height, and excerpt spacing in compact and cozy density; collapse and expand the first file in both.',
  async run(page, { step }) {
    const restore = await preserveAppearance(page, ['workbench.density'])
    const measurements: { phase: string; geometry: Geometry }[] = []
    inspections.set(page, measurements)
    try {
      await openVisualSearch(page)
      await step('search-headers-opened')
      for (const density of ['compact', 'cozy'] as const) {
        await selectDensity(page, density)
        await measure(page, measurements, `${density}-expanded`, step)
        await selectors.searchEditorHeaderToggle(page, true).click()
        await selectors.searchEditorHeaderToggle(page, false).waitFor()
        await measure(page, measurements, `${density}-collapsed`, step)
        await selectors.searchEditorHeaderToggle(page, false).click()
        await selectors.searchEditorHeaderToggle(page, true).waitFor()
        await selectors.searchEditorVisibleRows(page).first().waitFor()
        await measure(page, measurements, `${density}-reexpanded`, step)
      }
    } finally {
      await restore()
    }
  },
  async inspect(page) {
    return inspections.get(page) ?? []
  },
}

async function selectDensity(page: Page, density: 'compact' | 'cozy') {
  await page.keyboard.press('Control+,')
  await selectors.settingsSearch(page).fill('Interface density')
  await selectors.settingsScopeTab(page, 'User').click()
  await selectors.settingsDensity(page).click()
  await selectors.settingsDensityOption(page, density).click()
  await page.waitForFunction((value) => document.documentElement.dataset.density === value, density)
  await selectors.searchEditorTab(page).click()
  await selectors.searchEditorVisibleRows(page).first().waitFor()
}

async function measure(
  page: Page,
  measurements: { phase: string; geometry: Geometry }[],
  phase: string,
  step: (label: string) => Promise<void>,
) {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
      }),
  )
  const geometry = await headerGeometry(page)
  ok(geometry.headers.length > 0, 'At least one file header is mounted')
  measurements.push({ phase, geometry })
  await step(phase)
  for (const header of geometry.headers) assertHeaderGeometry(header)
}

function assertHeaderGeometry(header: Geometry['headers'][number]) {
  strictEqual(header.allocationGap, 0, `${header.path}: allocation matches the painted header`)
  if (header.nextRowGap !== null)
    strictEqual(header.nextRowGap, 0, `${header.path}: next row follows the header`)
  if (header.firstExcerptGap !== null)
    strictEqual(header.firstExcerptGap, 2, `${header.path}: only excerpt padding remains`)
}

async function headerGeometry(page: Page) {
  return selectors.searchEditor(page).evaluate((element, handles) => {
    const rows = Array.from(element.querySelectorAll(handles.row))
    const headers = Array.from(element.querySelectorAll(handles.header)).slice(0, 5)
    return {
      density: document.documentElement.dataset.density,
      densityRowHeight: getComputedStyle(element).getPropertyValue('--density-row-height'),
      scrollHeight: element.scrollHeight,
      headers: headers.map((header) => {
        const allocated = header.getBoundingClientRect()
        const painted = header.querySelector(handles.listRow)?.getBoundingClientRect()
        const index = Number(header.getAttribute('data-index'))
        const next = rows.find((row) => Number(row.getAttribute('data-index')) === index + 1)
        const excerptTops = Array.from(next?.querySelectorAll(handles.excerpt) ?? []).map(
          (row) => row.getBoundingClientRect().top,
        )
        const excerptTop = excerptTops.length > 0 ? Math.min(...excerptTops) : null
        return {
          index,
          path: header.querySelector(handles.listRow)?.getAttribute('title'),
          expanded: header.getAttribute('aria-expanded'),
          allocatedHeight: allocated.height,
          paintedHeight: painted?.height ?? null,
          allocationGap: painted ? allocated.height - painted.height : null,
          nextRowGap: painted && next ? next.getBoundingClientRect().top - painted.bottom : null,
          firstExcerptGap: painted && excerptTop !== null ? excerptTop - painted.bottom : null,
        }
      }),
    }
  }, searchEditorGeometrySelectors)
}
