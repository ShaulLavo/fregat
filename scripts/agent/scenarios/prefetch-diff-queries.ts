import { equal, ok } from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { Page } from 'playwright'
import { countBlankFrames } from '../blank-frames'
import {
  createGitFixture,
  fixtureGit,
  openFixtureWorkspace,
  releaseFixture,
} from '../fixture-workspace'
import { measurePress, pressStampScript } from '../press-timing'
import { diffContentRowSelector, openGitPanel, selectors } from '../selectors'
import { sampleEditorPaint } from './prefetch-first-paint'
import type { Scenario } from './index'

const evidence = new WeakMap<Page, unknown>()

async function toggleDiffPrefetch(page: Page) {
  await page.keyboard.press('Control+,')
  await selectors.settingsSearch(page).fill('prefetch')
  await Promise.all([
    page.waitForResponse((response) => response.url().endsWith('/settings/write') && response.ok()),
    selectors.settingsSwitch(page, 'Prefetch diffs').click(),
  ])
}

export const prefetchDiffQueries: Scenario = {
  name: 'prefetch-diff-queries',
  inspect: async (page) => evidence.get(page) ?? null,
  description:
    'Compare delayed diff opens with prefetch off and on, assert one read per open and no blank frame when switching loaded diffs.',
  async run(page, { step }) {
    const fixture = await createGitFixture('prefetch-diff-queries')
    const requests: string[] = []
    try {
      for (const name of ['cold', 'warm', 'next'])
        await writeFile(path.join(fixture, `${name}.ts`), `export const ${name} = 1\n`)
      await fixtureGit(fixture, ['add', '.'])
      await fixtureGit(fixture, ['commit', '--quiet', '-m', 'fixture'])
      for (const value of [0, 1]) {
        await writeFile(path.join(fixture, 'cold.ts'), `export const cold = ${value}\n`)
        await fixtureGit(fixture, ['commit', '--quiet', '-am', `cold ${value}`])
      }
      for (const name of ['cold', 'warm', 'next'])
        await writeFile(path.join(fixture, `${name}.ts`), `export const ${name} = 2\n`)
      await page.addInitScript(pressStampScript)
      await openFixtureWorkspace(page, fixture)
      await openGitPanel(page)
      await toggleDiffPrefetch(page)
      await page.route('**/git/diff?*', async (route) => {
        requests.push(route.request().url())
        await new Promise((resolve) => setTimeout(resolve, 300))
        await route.continue()
      })
      let blobs = 0
      let commands = 0
      page.on('request', (request) => {
        if (new URL(request.url()).pathname === '/git/diff/blob') blobs++
        if (request.method() === 'POST' && request.url().includes('/orchestration/')) commands++
      })
      const coldRow = selectors.gitChangeRow(page, 'cold.ts').first()
      await coldRow.hover()
      await page.waitForTimeout(650)
      equal(requests.length, 0, 'disabled surface does no speculative diff read')
      const cold = await measurePress(
        page,
        'diff prefetch off',
        sampleEditorPaint({ needle: 'cold = 2', kind: 'diff' }),
        () => coldRow.click(),
      )
      ok(cold.textMs !== null)
      equal(requests.length, 1)
      equal(blobs, 0, 'the diff response seeds its blob key')
      await step('disabled-one-read')
      await toggleDiffPrefetch(page)
      await coldRow.click()
      await page.locator(diffContentRowSelector).first().waitFor()
      const warmRow = selectors.gitChangeRow(page, 'warm.ts').first()
      await warmRow.hover()
      await page.waitForTimeout(650)
      equal(
        requests.filter((url) => new URL(url).searchParams.get('path')?.endsWith('/warm.ts'))
          .length,
        1,
        'hover started the warm read',
      )
      let warm: Awaited<ReturnType<typeof measurePress>> | undefined
      const blank = await countBlankFrames(page, diffContentRowSelector, async () => {
        warm = await measurePress(
          page,
          'diff prefetch on',
          sampleEditorPaint({ needle: 'warm = 2', kind: 'diff' }),
          () => warmRow.click(),
        )
      })
      ok(warm?.textMs !== null && warm?.textMs !== undefined)
      ok(
        cold.textMs - warm.textMs > 150,
        `prefetch should remove the delayed read: ${JSON.stringify({ cold, warm })}`,
      )
      equal(
        requests.filter((url) => new URL(url).searchParams.get('path')?.endsWith('/warm.ts'))
          .length,
        1,
        'the press shares the hovered answer',
      )
      equal(blobs, 0)
      equal(commands, 0, 'hover starts no provider command')
      equal(blank, 0, 'switching diffs retains loaded content')
      console.log(
        JSON.stringify({
          cold,
          warm,
          blankFrames: blank,
          diffReads: requests.length,
          blobReads: blobs,
          providerCommands: commands,
        }),
      )
      const caches = await page.evaluate(
        `Array.from(window.__fregatQueryClients?.values() ?? []).flatMap(client => client.getQueryCache().getAll().filter(query => query.queryKey[0] === 'git' && query.queryKey[1] === 'diffs').map(query => ({ key: query.queryKey, status: query.state.status, fetchStatus: query.state.fetchStatus, hasSources: query.state.data?.every(diff => typeof diff.oldText === 'string' && typeof diff.newText === 'string') })))`,
      )
      evidence.set(page, {
        cold,
        warm,
        blankFrames: blank,
        diffReads: requests.length,
        blobReads: blobs,
        providerCommands: commands,
        caches,
      })
      await step(`blank-frames-${blank}`)
      await verifyHistoryIntent(page)
      await step('history-neighbours-and-file')
      // Leave the fixture before releasing it, so watchers never race its removal.
      await page.goto('about:blank')
    } finally {
      await releaseFixture(fixture)
    }
  },
}

async function verifyHistoryIntent(page: Page) {
  const reads: string[] = []
  await page.route('**/git/history/commit?*', async (route) => {
    reads.push(new URL(route.request().url()).searchParams.get('commit') ?? '')
    await new Promise((resolve) => setTimeout(resolve, 300))
    await route.continue()
  })
  await selectors.graphButton(page).click()
  await selectors.historyRows(page).nth(2).waitFor()
  await selectors.historyRows(page).first().click()
  await selectors.historyFiles(page).first().waitFor()
  const middle = selectors.historyRows(page).nth(1)
  const last = selectors.historyRows(page).nth(2)
  const lastCommit = await last.getAttribute('data-history-commit')
  await middle.click()
  await selectors.historyFiles(page).first().waitFor()
  await page.waitForTimeout(650)
  equal(
    reads.filter((commit) => commit === lastCommit).length,
    1,
    'the cursor prefetches its next neighbour',
  )
  // Foresight also prepares rows a trajectory crosses, so reads are counted per file.
  const blobReads: string[] = []
  page.on('request', (request) => {
    const url = new URL(request.url())
    if (url.pathname === '/git/diff/blob') blobReads.push(url.searchParams.get('path') ?? '')
  })
  const blank = await countBlankFrames(page, selectors.historyFileSelector, async () => {
    await last.click()
    await page.waitForTimeout(450)
  })
  equal(blank, 0, 'commit details retain the displayed subject during selection')
  equal(
    reads.filter((commit) => commit === lastCommit).length,
    1,
    'selection reuses the neighbour read',
  )
  const file = selectors.historyFiles(page).first()
  const filePath = (await file.getAttribute('data-history-file')) ?? ''
  const readsOf = () => blobReads.filter((path) => path === filePath).length
  await file.hover()
  await page.waitForTimeout(650)
  equal(readsOf(), 1, 'a commit file hover prepares its blob pair')
  await file.click()
  await page.locator(diffContentRowSelector).first().waitFor()
  equal(readsOf(), 1, 'opening the commit file reuses its prepared blob pair')
}
