import type { Scenario } from './index'
import type { Page } from 'playwright'
import { openGitPanel, selectors } from '../selectors'
import { createScriptError } from '../../structured-errors'

export const gitHistory: Scenario = {
  name: 'git-history',
  description:
    'Open the Git graph, inspect and find commits, expand, page and filter history, then open and reload a historical file diff.',
  async run(page, { step }) {
    await openGitPanel(page)
    const changesToggle = selectors.changesToggle(page)
    if (await changesToggle.isVisible()) {
      if ((await changesToggle.getAttribute('aria-expanded')) === 'false')
        await changesToggle.click()
      await selectors.worktreeFiles(page).first().waitFor()
      await changesToggle.click()
      if ((await changesToggle.getAttribute('aria-expanded')) !== 'false')
        throw createScriptError('Changes section did not collapse')
      await step('changes-collapsed')
      await page.reload({ waitUntil: 'domcontentloaded' })
      await changesToggle.waitFor({ timeout: 20_000 })
      if ((await changesToggle.getAttribute('aria-expanded')) !== 'false')
        throw createScriptError('Refresh reopened the Changes section')
      await changesToggle.click()
      await selectors.worktreeFiles(page).first().waitFor()
    }
    await step('changes')
    await selectors.graphButton(page).click()
    await selectors.historyRows(page).first().waitFor({ timeout: 20_000 })
    await step('graph')
    await assertCircularCommitDots(page)
    await page.reload({ waitUntil: 'domcontentloaded' })
    await selectors.graphButton(page).waitFor({ timeout: 20_000 })
    await step('graph-after-refresh')
    if ((await selectors.graphButton(page).getAttribute('aria-pressed')) !== 'true')
      throw createScriptError('Refresh lost the selected Git graph tab')
    await selectors.historyRows(page).first().waitFor({ timeout: 20_000 })
    const subject = await selectors.historyRows(page).first().getAttribute('aria-label')
    await selectors.historyRows(page).first().click()
    await selectors.historyFiles(page).first().waitFor({ timeout: 15_000 })
    const preview = await selectors.historyDetails(page).boundingBox()
    const graph = await selectors.historyList(page).boundingBox()
    if (!preview || !graph || preview.y + preview.height > graph.y + 1)
      throw createScriptError('Commit preview must appear above the sidebar graph')
    if (!(await selectors.historyFiles(page).first().getAttribute('data-git-file')))
      throw createScriptError('Historical changed files must use the shared Git file row')
    await step('commit-details')
    await selectors.historyFiles(page).first().scrollIntoViewIfNeeded()
    await step('commit-files')
    await selectors.historyInformation(page).click()
    await selectors.historyCopyMessage(page).waitFor({ state: 'hidden' })
    await selectors.historyFiles(page).first().waitFor()
    await step('commit-information-collapsed')
    await selectors.historyRows(page).nth(1).click()
    const selectedCommit = await selectors.historyInformation(page).getAttribute('title')
    if ((await selectors.historyInformation(page).getAttribute('aria-expanded')) !== 'false')
      throw createScriptError('Selecting another commit reopened its information')
    await page.reload({ waitUntil: 'domcontentloaded' })
    await selectors.historyRows(page).first().waitFor({ timeout: 20_000 })
    await selectors.historyInformation(page).waitFor()
    if ((await selectors.historyInformation(page).getAttribute('title')) !== selectedCommit)
      throw createScriptError('Refresh lost the selected commit preview')
    await selectors.historyRows(page).first().click()
    await selectors.historyFiles(page).first().waitFor({ timeout: 15_000 })
    if ((await selectors.historyInformation(page).getAttribute('aria-expanded')) !== 'false')
      throw createScriptError('Refresh lost the collapsed commit information preference')
    await step('commit-information-after-refresh')
    await selectors.historyInformation(page).click()
    await selectors.historyCopyMessage(page).waitFor()
    const searched = page.waitForResponse(
      (response) =>
        response.url().endsWith('/git/history') &&
        response.request().postDataJSON()?.search === subject,
    )
    await selectors.historySearch(page).pressSequentially(subject ?? '', { delay: 10 })
    await searched
    await selectors.historyRows(page).first().waitFor()
    await step('find-commit')
    if ((await selectors.historyRows(page).count()) !== 1)
      throw createScriptError('Searching an exact commit subject did not filter the history list')
    await selectors.historyRows(page).first().click()
    const searchedCommit = await selectors.historyInformation(page).getAttribute('title')
    await page.reload({ waitUntil: 'domcontentloaded' })
    await selectors.historyRows(page).first().waitFor({ timeout: 20_000 })
    if ((await selectors.historySearch(page).inputValue()) !== subject)
      throw createScriptError('Refresh lost the history search')
    if ((await selectors.historyInformation(page).getAttribute('title')) !== searchedCommit)
      throw createScriptError('Refresh lost the selected search result')
    await step('search-after-refresh')
    await selectors.historyClearSearch(page).click()
    await selectors.historyRows(page).nth(1).waitFor()
    await selectors.historyExpand(page).click()
    await selectors.historyDialog(page).waitFor()
    await page.waitForTimeout(250)
    await step('expanded')
    await assertCircularCommitDots(page)
    if (await selectors.historyLoadMore(page).isVisible()) {
      const loaded = page.waitForResponse(
        (response) =>
          response.url().endsWith('/git/history') && response.request().method() === 'POST',
      )
      await selectors.historyLoadMore(page).click()
      await loaded
      await selectors.historyList(page).focus()
      await page.keyboard.press('End')
      await page.waitForTimeout(300)
      await step('older-history')
      const olderCommit = await selectors.historyInformation(page).getAttribute('title')
      const scrollTop = await selectors
        .historyList(page)
        .evaluate((element) => Number(Reflect.get(element, 'scrollTop')))
      await page.reload({ waitUntil: 'domcontentloaded' })
      await selectors.historyDialog(page).waitFor({ timeout: 20_000 })
      await selectors.historyList(page).waitFor({ timeout: 20_000 })
      if ((await selectors.historyInformation(page).getAttribute('title')) !== olderCommit)
        throw createScriptError('Refresh lost the older commit selection')
      const restoredTop = await selectors
        .historyList(page)
        .evaluate((element) => Number(Reflect.get(element, 'scrollTop')))
      if (Math.abs(restoredTop - scrollTop) > 24)
        throw createScriptError(
          `Refresh lost the graph scroll position: ${scrollTop} became ${restoredTop}`,
        )
      await step('older-history-after-refresh')
      const olderFound = page.waitForResponse(
        (response) =>
          response.url().endsWith('/git/history') &&
          response.request().postDataJSON()?.search === olderCommit,
      )
      await selectors.historySearch(page).fill(olderCommit ?? '')
      await olderFound
      await selectors.historyRows(page).first().waitFor()
      if (
        (await selectors.historyRows(page).first().getAttribute('data-history-commit')) !==
        olderCommit
      )
        throw createScriptError('Full history search missed the older commit')
      await step('search-older-commit')
      await selectors.historyClearSearch(page).click()
      await selectors.historyRows(page).nth(1).waitFor()
      await selectors.historyLoadedCount(page, 200).waitFor()
      await page.reload({ waitUntil: 'domcontentloaded' })
      await selectors.historyLoadedCount(page, 200).waitFor({ timeout: 20_000 })
      await step('cleared-search-after-refresh')
    }
    const currentLoaded = page.waitForResponse(
      (response) =>
        response.url().endsWith('/git/history') &&
        response.request().postDataJSON()?.ref === 'HEAD',
    )
    await selectors.historyCurrent(page).click()
    await currentLoaded
    await selectors.historyRows(page).first().waitFor()
    await step('current-branch')
    await page.reload({ waitUntil: 'domcontentloaded' })
    await selectors.historyDialog(page).waitFor({ timeout: 20_000 })
    await selectors.historyRows(page).first().waitFor({ timeout: 20_000 })
    if ((await selectors.historyReference(page).getAttribute('title')) !== 'HEAD')
      throw createScriptError('Refresh lost the selected branch filter')
    await step('current-branch-after-refresh')
    await selectors.historyReference(page).click()
    await selectors.historyAllRefs(page).click()
    await selectors.historyRows(page).first().click()
    await selectors.historyFiles(page).first().waitFor({ timeout: 15_000 })
    await selectors.historyFiles(page).first().press('Enter')
    await page.waitForURL(/historical/, { timeout: 15_000 })
    await selectors.historyDialog(page).waitFor({ state: 'hidden' })
    await step('historical-diff')
    await page.reload({ waitUntil: 'domcontentloaded' })
    await selectors.windowToolbar(page).waitFor({ timeout: 20_000 })
    if (!page.url().includes('historical'))
      throw createScriptError('Reload lost the historical diff source')
    await step('reloaded-diff')
  },
}

async function assertCircularCommitDots(page: Page) {
  const circles = await selectors.historyCircles(page).all()
  if (circles.length === 0) throw createScriptError('No commit dots rendered')
  for (const circle of circles) {
    const bounds = await circle.boundingBox()
    if (bounds && Math.abs(bounds.width - bounds.height) > 0.1)
      throw createScriptError(`Commit dot is distorted: ${bounds.width} × ${bounds.height}`)
  }
}
