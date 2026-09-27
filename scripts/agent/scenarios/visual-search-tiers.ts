import { ok } from 'node:assert'
import type { Page } from 'playwright'

import { openFileByName, selectors } from '../selectors'
import type { Scenario } from './index'
import { paintVisualSearch, settledVisualSearch } from './visual-search-drive'

type Tier = {
  readonly name: string
  readonly query: string
  /** Keeps a dense tier under the backend's 20,000-match cap, so every run sees the same files. */
  readonly include?: string
  readonly opening: string
}
type PhaseCounters = {
  readonly tier: string
  readonly phase: string
  readonly elapsedMs: number
  readonly frames: number
  readonly longTasks: number
  readonly worstTaskMs: number
  readonly editorHostsMounted: number
  readonly editorHostsRemoved: number
  readonly editorHostsLive: number
  readonly nodesAdded: number
  readonly nodesRemoved: number
  readonly highlightRanges: number
  readonly scrollHeight: number
  readonly summary: string | null
}

const TIERS: readonly Tier[] = [
  { name: 'narrow', query: 'createError', opening: 'useSettingValue' },
  { name: 'broad', query: 'useState', opening: 'useSettingValue' },
  // About 17,000 matches in 32 files: few files, each with hundreds of matches.
  { name: 'pathological', query: 'a', include: 'apps/server/src/fs/tests/**', opening: 'expect' },
]
const EDITOR_HOST_CLASS = 'search-result-file-editor-host'
const inspections = new WeakMap<Page, PhaseCounters[]>()

// Page scripts are strings: the scripts project compiles without the DOM lib.
const installProbe = `(() => {
  const probe = { frames: 0, longTasks: [], mounted: 0, removed: 0, added: 0, dropped: 0, running: true }
  window.__searchViewProbe = probe
  const frame = () => {
    if (!probe.running) return
    probe.frames += 1
    requestAnimationFrame(frame)
  }
  requestAnimationFrame(frame)
  new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) probe.longTasks.push(entry.duration)
  }).observe({ type: 'longtask' })
  const countHosts = (nodes) => {
    let count = 0
    for (const node of nodes) {
      if (!(node instanceof Element)) continue
      if (node.classList.contains('${EDITOR_HOST_CLASS}')) count += 1
      count += node.getElementsByClassName('${EDITOR_HOST_CLASS}').length
    }
    return count
  }
  new MutationObserver((records) => {
    for (const record of records) {
      probe.mounted += countHosts(record.addedNodes)
      probe.removed += countHosts(record.removedNodes)
      probe.added += record.addedNodes.length
      probe.dropped += record.removedNodes.length
    }
  }).observe(document.body, { childList: true, subtree: true })
})()`

const readProbe = `(() => {
  const probe = window.__searchViewProbe
  const snapshot = {
    frames: probe.frames,
    longTasks: probe.longTasks.length,
    worstTaskMs: Math.round(Math.max(0, ...probe.longTasks)),
    mounted: probe.mounted,
    removed: probe.removed,
    live: document.getElementsByClassName('${EDITOR_HOST_CLASS}').length,
    nodesAdded: probe.added,
    nodesRemoved: probe.dropped,
    highlightRanges: Array.from(CSS.highlights.values()).reduce((count, highlight) => count + highlight.size, 0),
  }
  probe.frames = 0
  probe.longTasks = []
  probe.mounted = 0
  probe.removed = 0
  probe.added = 0
  probe.dropped = 0
  return snapshot
})()`

type ProbeSnapshot = {
  readonly frames: number
  readonly longTasks: number
  readonly worstTaskMs: number
  readonly mounted: number
  readonly removed: number
  readonly live: number
  readonly nodesAdded: number
  readonly nodesRemoved: number
  readonly highlightRanges: number
}

/**
 * Plan 182's probe, one scenario per tier so each trace fits Chrome's buffer: the tier's query
 * retyped into the open search editor, then flung, read, jumped, and the sidebar list flung and stepped.
 */
export const visualSearchTiers: readonly Scenario[] = TIERS.map((tier) => ({
  name: `visual-search-${tier.name}`,
  readOnly: true,
  description: `Retype "${tier.query}" into the open search editor, fling it, wheel slowly, jump halfway, fling the sidebar list and press ArrowDown 20 times in it.`,
  capture: { width: 1440, height: 1000 },
  run: (page, { step }) => runTier(page, tier, step),
  async inspect(page) {
    return { tier, phases: inspections.get(page) ?? [] }
  },
}))

async function runTier(page: Page, tier: Tier, step: (label: string) => Promise<void>) {
  const counters: PhaseCounters[] = []
  inspections.set(page, counters)
  await openFileByName(page, 'README.md')
  await selectors.sidebarTab(page, 'Search').click()
  if (tier.include) {
    await selectors.searchFilterToggle(page).click()
    await selectors.searchInclude(page).fill(tier.include)
  }
  await selectors.workspaceSearch(page).fill(tier.opening)
  await settledVisualSearch(page)
  await selectors.openSearchEditor(page).click()
  await paintedRows(page)
  await page.evaluate(installProbe)
  await page.evaluate(readProbe)

  const phase = async (name: string, run: () => Promise<void>) => {
    await step(`${name}-begin`)
    const started = performance.now()
    await run()
    await paintVisualSearch(page)
    const elapsedMs = Math.round(performance.now() - started)
    await step(`${name}-end`)
    const probe = await page.evaluate<ProbeSnapshot>(readProbe)
    const summary = await selectors.searchSummary(page).first().getAttribute('title')
    counters.push({
      tier: tier.name,
      phase: name,
      elapsedMs,
      frames: probe.frames,
      longTasks: probe.longTasks,
      worstTaskMs: probe.worstTaskMs,
      editorHostsMounted: probe.mounted,
      editorHostsRemoved: probe.removed,
      editorHostsLive: probe.live,
      nodesAdded: probe.nodesAdded,
      nodesRemoved: probe.nodesRemoved,
      highlightRanges: probe.highlightRanges,
      scrollHeight: await selectors.searchEditor(page).evaluate((element) => element.scrollHeight),
      summary: summary?.split(' · ')[0] ?? null,
    })
  }

  await phase('retype', async () => {
    const input = selectors.searchEditorInput(page)
    await input.click()
    await input.press('ControlOrMeta+a')
    await page.keyboard.type(tier.query, { delay: 120 })
    await settledVisualSearch(page)
    await paintedRows(page)
  })
  await hoverCentre(page, selectors.searchEditor(page))
  await phase('wheel-fast', () => wheel(page, 20, 1_200))
  await phase('wheel-reading', () => wheel(page, 40, 120))
  await phase('jump', async () => {
    await selectors.searchEditor(page).evaluate((element) => {
      element.scrollTop = (element.scrollHeight - element.clientHeight) / 2
    })
    await paintedRows(page)
  })
  await hoverCentre(page, selectors.searchResultTree(page))
  await phase('sidebar-wheel-fast', () => wheel(page, 20, 1_200))
  await phase('sidebar-arrows', async () => {
    await selectors.searchResultTree(page).focus()
    for (let index = 0; index < 20; index += 1) {
      await page.keyboard.press('ArrowDown')
      await page.waitForTimeout(16)
    }
  })
}

async function wheel(page: Page, steps: number, deltaY: number) {
  for (let index = 0; index < steps; index += 1) {
    await page.mouse.wheel(0, deltaY)
    await page.waitForTimeout(16)
  }
}

async function hoverCentre(page: Page, locator: ReturnType<Page['locator']>) {
  const box = await locator.boundingBox()
  ok(box, 'The scroller to wheel has a box')
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
}

// Rows only: a tier can open on a file with no grammar, which never gets syntax tokens.
async function paintedRows(page: Page) {
  await selectors.searchEditorVisibleRows(page).first().waitFor({ timeout: 90_000 })
  await paintVisualSearch(page)
}
