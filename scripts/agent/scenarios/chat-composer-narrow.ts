import { ok } from 'node:assert/strict'
import type { Page } from 'playwright'
import { selectors } from '../selectors'
import { reloadWithUsageFixture } from './chat-usage-meter'
import type { Scenario } from './index'

/** Side-panel widths from roomy to the narrowest the composer must survive. */
const WIDTHS = [600, 560, 520, 506, 480, 440, 400, 360, 320, 280, 240, 200] as const

/**
 * The composer's control row in the editor's chat side panel, dragged narrower step by
 * step, with every optional control present (the plan-usage gauge comes from a fixed
 * `/providers/usage`). Nothing may leave the row or wrap onto a second line.
 */
export const chatComposerNarrow: Scenario = {
  name: 'chat-composer-narrow',
  description:
    'Chat side-panel composer at 600 → 200px with the usage gauge shown: every control stays on one line inside its row.',
  async run(page, { step }) {
    const unroute = await reloadWithUsageFixture(page)
    try {
      await selectors.workspaceMode(page, 'Workbench').click()
      await selectors.sidebarTab(page, 'Chat').click()
      await selectors.usageMeter(page).waitFor({ timeout: 20_000 })

      const failures: string[] = []
      for (const width of WIDTHS) {
        const rowWidth = await setPanelWidth(page, width)
        failures.push(...(await overflowingControls(page, rowWidth)))
        await step(`panel-${width}`)
      }
      ok(failures.length === 0, failures.join('\n'))
    } finally {
      await unroute()
    }
  },
}

/** Drags the side panel's edge so the panel is about `width` wide; returns the row's width. */
async function setPanelWidth(page: Page, width: number) {
  const panel = await selectors.composerActions(page).boundingBox()
  const handle = await selectors.sidebarHandle(page).boundingBox()
  ok(panel && handle, 'The composer and the panel edge must be laid out')
  const y = handle.y + handle.height / 2
  await page.mouse.move(handle.x + handle.width / 2, y)
  await page.mouse.down()
  await page.mouse.move(panel.x + width, y, { steps: 12 })
  await page.mouse.up()
  await page.waitForTimeout(250)
  const row = await selectors.composerActions(page).boundingBox()

  return Math.round(row?.width ?? 0)
}

/** Controls that leave the row, sit on a second line, or make the row scroll. */
async function overflowingControls(page: Page, rowWidth: number) {
  return selectors.composerActions(page).evaluate((row, width) => {
    const edge = row.getBoundingClientRect()
    const problems: string[] = []
    if (row.scrollWidth > row.clientWidth + 1)
      problems.push(`${width}px row: scrolls (${row.scrollWidth} > ${row.clientWidth})`)
    const controls = [...row.querySelectorAll('button, [role="button"]')].filter(
      (control) => control.getBoundingClientRect().width > 0,
    )
    const firstTop = Math.min(...controls.map((control) => control.getBoundingClientRect().top))
    const sizes = controls
      .map((control) => {
        const name = control.getAttribute('aria-label') ?? control.textContent?.trim().slice(0, 20)
        return `${name}=${Math.round(control.getBoundingClientRect().width)}`
      })
      .join(', ')
    for (const control of controls) {
      const box = control.getBoundingClientRect()
      const name = control.getAttribute('aria-label') ?? control.textContent?.trim().slice(0, 30)
      if (box.right > edge.right + 1 || box.left < edge.left - 1)
        problems.push(
          `${width}px row: "${name}" spans ${Math.round(box.left)}–${Math.round(box.right)} outside ${Math.round(edge.left)}–${Math.round(edge.right)}`,
        )
      // One row of controls, always: a control below the first line is a wrapped row.
      if (box.top > firstTop + box.height / 2)
        problems.push(`${width}px row: "${name}" wrapped to a second line [${sizes}]`)
    }
    return problems
  }, rowWidth)
}
