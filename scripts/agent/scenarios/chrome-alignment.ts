import { ok } from 'node:assert/strict'
import type { Locator, Page } from 'playwright'
import type { Scenario } from './index'
import { selectors } from '../selectors'

type Step = Parameters<Scenario['run']>[1]['step']

/** Subpixel layout rounds differently per engine; anything wider is visible. */
const TOLERANCE_PX = 0.5
const DENSITIES = ['cozy', 'compact'] as const

async function centerX(target: Locator) {
  const box = await target.boundingBox()
  ok(box, 'Alignment target is not laid out')
  return box.x + box.width / 2
}

async function expectColumn(name: string, a: Locator, b: Locator) {
  const offset = (await centerX(a)) - (await centerX(b))
  ok(Math.abs(offset) <= TOLERANCE_PX, `${name}: centres differ by ${offset.toFixed(2)}px`)
}

async function checkMode(page: Page, mode: 'Workbench' | 'Chat', step: Step) {
  await selectors.workspaceMode(page, mode).click()
  const rail = selectors.workspaceRailButtons(page, mode).first()
  await rail.waitFor({ timeout: 20_000 })
  for (const density of DENSITIES) {
    await page.evaluate((value) => {
      document.documentElement.dataset.density = value
    }, density)
    if (mode === 'Workbench') {
      await expectColumn(
        `${density}: project folder icon over the sidebar rail`,
        selectors.projectSwitcher(page).locator('svg').first(),
        rail.locator('svg').first(),
      )
    } else {
      await expectColumn(
        `${density}: chat mode toggle over the tool rail`,
        selectors.workspaceMode(page, 'Chat'),
        rail,
      )
    }
    await step(`${mode.toLowerCase()}-${density}`)
  }
}

/** Titlebar controls at the window edges share the rails' centre lines. */
export const chromeAlignment: Scenario = {
  name: 'chrome-alignment',
  description:
    'Measure the titlebar edge icons against the sidebar and tool rails in both densities; fails on any offset over half a pixel.',
  async run(page, { step }) {
    const density = await page.evaluate(() => document.documentElement.dataset.density ?? null)
    try {
      await checkMode(page, 'Workbench', step)
      await checkMode(page, 'Chat', step)
    } finally {
      await page.evaluate((value) => {
        if (value === null) delete document.documentElement.dataset.density
        else document.documentElement.dataset.density = value
      }, density)
      await selectors.workspaceMode(page, 'Workbench').click()
    }
  },
}
