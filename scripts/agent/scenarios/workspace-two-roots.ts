import { ok } from 'node:assert/strict'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { Page } from 'playwright'

import { fixtureApiBase, openFixtureWorkspace, releaseFixture } from '../fixture-workspace'
import { readLogs, type LogEvent } from '../logs'
import { chords, selectors, waitForApp } from '../selectors'
import { createScriptError } from '../../structured-errors'
import type { Scenario } from './index'

type IndexStatus = { holderCount: number; readiness: string; scanRoot: string | null }

async function twoRootFixture() {
  const root = await mkdtemp('/work/tmp/fregat-two-roots-')
  for (const name of ['alpha', 'beta']) {
    await mkdir(path.join(root, name, 'src'), { recursive: true })
    await writeFile(path.join(root, name, 'src', `${name}-marker.ts`), `export const ${name} = 1\n`)
  }
  return { root, alpha: path.join(root, 'alpha'), beta: path.join(root, 'beta') }
}

async function indexStatuses(page: Page): Promise<IndexStatus[]> {
  const response = await page.request.get(`${fixtureApiBase(page)}/health`, {
    headers: { Origin: new URL(page.url()).origin },
  })
  const health = (await response.json()) as { workspaceIndexes: IndexStatus[] }
  return health.workspaceIndexes
}

async function waitForReadyIndexes(page: Page, roots: readonly string[]) {
  const deadline = Date.now() + 20_000
  while (Date.now() < deadline) {
    const statuses = await indexStatuses(page)
    const ready = roots.every((root) =>
      statuses.some((status) => status.scanRoot === root && status.readiness === 'ready'),
    )
    if (ready) return statuses
    await page.waitForTimeout(200)
  }
  throw createScriptError(
    `Indexes never became ready for ${roots.join(', ')}: ${JSON.stringify(await indexStatuses(page))}`,
  )
}

async function quickOpen(page: Page, name: string) {
  await page.keyboard.press(chords.commandPalette)
  const input = selectors.paletteInput(page)
  await input.waitFor({ timeout: 5_000 })
  await input.fill(name)
  await selectors.commandOption(page, `${name}.ts`).first().waitFor({ timeout: 10_000 })
}

/** The quick-open search's wide event for `root`, written after `since`. */
async function searchProvider(root: string, since: Date) {
  const relative = root.slice(1)
  const deadline = Date.now() + 10_000
  while (Date.now() < deadline) {
    const event = (await readLogs({ area: 'fs', since })).findLast((entry) =>
      isNameSearchIn(entry, relative),
    )
    if (event) return (event.search as { provider?: string }).provider
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
  throw createScriptError(`No quick-open search event for ${relative}`)
}

function isNameSearchIn(event: LogEvent, relativeRoot: string) {
  if (event.operation !== 'search_events') return false
  const search = event.search as { includeNames?: boolean } | undefined
  if (!search?.includeNames) return false
  const operations = (event.fs as { operations?: { path?: string }[] } | undefined)?.operations
  return operations?.some((operation) => operation.path === relativeRoot) ?? false
}

async function expectIndexedSearch(page: Page, root: string, name: string) {
  const since = new Date()
  await quickOpen(page, name)
  const provider = await searchProvider(root, since)
  await page.keyboard.press('Escape')
  ok(provider === 'index', `${name} searched through ${provider}, expected index`)
}

export const workspaceTwoRoots: Scenario = {
  name: 'workspace-two-roots',
  description:
    'Two windows open two roots on one server: both quick-open searches use their own index, and reloading one leaves the other indexed.',
  async run(page, { server, step }) {
    const fixture = await twoRootFixture()
    const browser = page.context().browser()
    ok(browser, 'The scenario browser is unavailable')
    // Its own context: tabs of one profile share six HTTP/1.1 connections, and each tab holds four streams.
    const secondContext = await browser.newContext({ viewport: page.viewportSize() })
    // The run's throwaway API server; without it the second window talks to the dev API.
    if (server)
      await secondContext.addInitScript(
        `window.platformDevServerUrl = ${JSON.stringify(server.origin)}`,
      )
    try {
      await openFixtureWorkspace(page, fixture.alpha)
      const second = await secondContext.newPage()
      await second.goto(page.url())
      await waitForApp(second)
      await openFixtureWorkspace(second, fixture.beta)

      const statuses = await waitForReadyIndexes(page, [fixture.alpha, fixture.beta])
      const held = statuses.filter((status) => status.holderCount > 0).map((s) => s.scanRoot)
      ok(
        held.includes(fixture.alpha) && held.includes(fixture.beta),
        `Each window should hold its root's index: ${JSON.stringify(statuses)}`,
      )
      await step('both-roots-indexed')

      await expectIndexedSearch(page, fixture.alpha, 'alpha-marker')
      await expectIndexedSearch(second, fixture.beta, 'beta-marker')
      await step('beta-searched-by-index', second)

      await page.reload()
      await waitForApp(page)
      await selectors
        .projectSwitcher(page)
        .and(page.locator(`[title^="${fixture.alpha.slice(1)}"]`))
        .waitFor({ timeout: 20_000 })
      await expectIndexedSearch(second, fixture.beta, 'beta-marker')
      await expectIndexedSearch(page, fixture.alpha, 'alpha-marker')
      await step('alpha-reloaded-both-indexed')
    } finally {
      await secondContext.close()
      await releaseFixture(fixture.root)
    }
  },
}
