import { createHash } from 'node:crypto'
import { selectors, runPaletteCommand } from '../../../scripts/agent/selectors.ts'
import { createBenchmarkError } from './structured-errors.mjs'

export const scenarioConfig = {
  'search-compact': {
    contentSelector: '[role="tree"][aria-label="Search results"] [role="treeitem"]',
    viewportSelector: '[role="tree"][aria-label="Search results"]',
    holdPaths: ['/fs/search/events'],
    holdWebSockets: false,
  },
  'search-full': {
    contentSelector: '[aria-label="Search result editor"] .editor-virtualized-row',
    viewportSelector: '[aria-label="Search result editor"]',
    holdPaths: ['/fs/search/events'],
    holdWebSockets: false,
  },
  chat: {
    contentSelector: '[role="log"][aria-label="Messages"] [data-timeline-row-id]',
    viewportSelector: '[role="log"][aria-label="Messages"]',
    holdPaths: ['/orchestration/shell-snapshot', '/orchestration/session-detail'],
    holdWebSockets: true,
  },
}

export async function setupScenario(page, scenario) {
  if (!scenarioConfig[scenario]) throw createBenchmarkError(`Unknown reload scenario: ${scenario}`)
  if (scenario === 'chat') return setupChat(page)
  await selectors.sidebarTab(page, 'Search').click()
  await selectors.workspaceSearch(page).first().fill('useState')
  await selectors.searchSummary(page).first().waitFor({ timeout: 90_000 })
  await page.waitForFunction(() => !document.body.textContent?.includes('Searching'))
  if (scenario === 'search-full') {
    await selectors.openSearchEditor(page).click()
    await selectors.searchEditorVisibleRows(page).first().waitFor()
  } else await selectors.searchResultTree(page).getByRole('treeitem').first().waitFor()
  const viewport = page.locator(scenarioConfig[scenario].viewportSelector)
  await viewport.evaluate((element) => {
    element.scrollTop = Math.min(640, (element.scrollHeight - element.clientHeight) / 3)
  })
  await settle(page)
  const observation = await observeScenario(page, scenario)
  if (!observation.rows.length || observation.scrollTop <= 0)
    throw createBenchmarkError(`${scenario} needs nonempty results and a scrolled viewport`)
  return { source: 'workspace-search', query: 'useState', cleanup: async () => {} }
}

async function setupChat(page) {
  await runPaletteCommand(page, 'Chat mode')
  const sessions = selectors.sessionRows(page)
  try {
    await sessions.first().waitFor({ timeout: 15_000 })
  } catch {
    throw createBenchmarkError(
      'Chat reload proof has no existing session to inspect; no provider was invoked',
    )
  }
  const count = Math.min(await sessions.count(), 20)
  for (let index = 0; index < count; index += 1) {
    await sessions.nth(index).click()
    const viewport = selectors.chatMessages(page)
    try {
      await viewport.waitFor({ timeout: 8_000 })
      await selectors.timelineRows(page).first().waitFor({ timeout: 8_000 })
    } catch {
      continue
    }
    await settle(page)
    const scrollable = await viewport.evaluate(
      (element) => element.scrollHeight > element.clientHeight * 2,
    )
    if (!scrollable) continue
    await viewport.focus()
    await page.keyboard.press('Control+Home')
    await page.keyboard.press('PageDown')
    await settle(page)
    const observation = await observeScenario(page, 'chat')
    if (!observation.rows.length || observation.scrollTop <= 0 || observation.distanceToEnd <= 40)
      continue
    return { source: 'existing-session', inspectedSessions: index + 1, cleanup: async () => {} }
  }
  throw createBenchmarkError(
    `Chat reload proof found no sufficiently long transcript in ${count} existing sessions; no provider was invoked`,
  )
}

export async function observeScenario(page, scenario) {
  const config = scenarioConfig[scenario]
  if (!config) throw createBenchmarkError(`Unknown reload scenario: ${scenario}`)
  const observation = await page.evaluate(({ contentSelector, viewportSelector }) => {
    const viewport = document.querySelector(viewportSelector)
    if (!viewport) return { rows: [], scrollTop: null, distanceToEnd: null, height: 0, width: 0 }
    const bounds = viewport.getBoundingClientRect()
    const rows = Array.from(document.querySelectorAll(contentSelector)).flatMap((row) => {
      const rect = row.getBoundingClientRect()
      if (rect.bottom <= bounds.top || rect.top >= bounds.bottom || rect.height === 0) return []
      return [
        {
          id:
            row.getAttribute('data-timeline-row-id') ??
            row.getAttribute('title') ??
            row.getAttribute('data-line') ??
            '',
          value: row.textContent ?? '',
          offset: Math.round((rect.top - bounds.top) * 100) / 100,
          height: Math.round(rect.height * 100) / 100,
        },
      ]
    })
    return {
      rows,
      scrollTop: viewport.scrollTop,
      distanceToEnd: viewport.scrollHeight - viewport.clientHeight - viewport.scrollTop,
      height: viewport.clientHeight,
      width: viewport.clientWidth,
    }
  }, config)
  return {
    ...observation,
    rows: observation.rows.map(({ value, ...row }) => ({
      ...row,
      hash: createHash('sha256').update(value).digest('hex'),
    })),
  }
}

async function settle(page) {
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  )
  await page.waitForTimeout(200)
}
