import { ok, strictEqual } from 'node:assert/strict'
import type { Scenario } from './index'
import { selectors } from '../selectors'

export const projectMenu: Scenario = {
  name: 'project-menu',
  description:
    'Open the project switcher, count its rows on every frame, and check they land in one step with worktrees nested.',
  async run(page, { step }) {
    await selectors.projectMenuTrigger(page).waitFor({ timeout: 15_000 })
    await page.evaluate(() => {
      const counts: number[] = []
      Object.assign(window, { projectMenuRowCounts: counts })
      function sample() {
        counts.push(document.querySelectorAll('[role="menuitemradio"]').length)
        if (counts.length < 240) requestAnimationFrame(sample)
      }
      requestAnimationFrame(sample)
    })
    await selectors.projectMenuTrigger(page).click()
    await selectors.projectMenuRows(page).first().waitFor({ timeout: 5_000 })
    await selectors.projectMenuLoader(page).waitFor({ state: 'hidden', timeout: 15_000 })
    await page.waitForTimeout(500)
    await step('menu-open')

    const counts = await page.evaluate(
      () => (window as unknown as { projectMenuRowCounts: number[] }).projectMenuRowCounts,
    )
    const distinct = [...new Set(counts.filter((count) => count > 0))]
    ok(distinct.length <= 2, `rows must land together, saw row counts ${distinct.join(' → ')}`)

    // A reopen must paint its rows at once: no loader frame, no regrowth.
    await page.keyboard.press('Escape')
    await selectors.projectMenuRows(page).first().waitFor({ state: 'hidden' })
    await page.evaluate(() => {
      const state = { loaderFrames: 0, until: performance.now() + 1500 }
      Object.assign(window, { projectMenuReopen: state })
      function sample() {
        state.loaderFrames += document.querySelectorAll('[role="menu"] [role="status"]').length
        if (performance.now() < state.until) requestAnimationFrame(sample)
      }
      requestAnimationFrame(sample)
    })
    await selectors.projectMenuTrigger(page).click()
    await page.waitForTimeout(1600)
    await step('menu-reopened')
    const loaderFrames = await page.evaluate(
      () =>
        (window as unknown as { projectMenuReopen: { loaderFrames: number } }).projectMenuReopen
          .loaderFrames,
    )
    strictEqual(loaderFrames, 0, 'a reopened menu must not fall back to its loader')

    const titles = await selectors
      .projectMenuRows(page)
      .evaluateAll((rows) => rows.map((row) => row.getAttribute('title') ?? ''))
    ok(!titles[0]?.startsWith('Worktree') || titles.length === 1, 'a worktree needs a parent row')
    console.log(`project menu rows:\n${titles.join('\n')}`)
  },
}
