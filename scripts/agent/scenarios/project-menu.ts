import { ok, strictEqual } from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import type { Page } from 'playwright'
import type { Scenario } from './index'
import { releaseFixture } from '../fixture-workspace'
import { selectors } from '../selectors'
import { serverApi } from '../server-api'

export const projectMenu: Scenario = {
  name: 'project-menu',
  description:
    'Open the project switcher, count its rows on every frame, and check they land in one step with worktrees nested. Seeds a live and a missing recent folder.',
  async run(page, { step }) {
    await selectors.projectMenuTrigger(page).waitFor({ timeout: 15_000 })
    // Seeded before the first hover: the menu fetches its recents only once armed.
    const kept = await seedRecent(page)
    const gone = await seedRecent(page)
    await rm(gone, { recursive: true })
    try {
      const titles = await openMenu(page, step)
      ok(titles.includes(kept.slice(1)), 'a live recent folder is listed')
      ok(!titles.includes(gone.slice(1)), 'a missing recent folder is not listed')
    } finally {
      await releaseFixture(kept)
    }
  },
}

async function seedRecent(page: Page) {
  const folder = await mkdtemp('/work/tmp/fregat-project-menu-')
  const { base, headers } = serverApi(page)
  const response = await page.request.post(`${base}/fs/recents`, {
    data: { path: folder.slice(1) },
    headers,
  })
  ok(response.ok(), `recording a recent failed: ${response.status()}`)
  return folder
}

async function openMenu(page: Page, step: (label: string) => Promise<void>) {
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
  return titles
}
