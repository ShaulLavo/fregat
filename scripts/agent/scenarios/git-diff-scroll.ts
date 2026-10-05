import { deepStrictEqual, strictEqual, ok } from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { Page, Route } from 'playwright'
import type { Scenario } from './index'
import type { Evidence } from '../evidence'
import { recordFrames } from '../blank-frames'
import { createScriptError } from '../../structured-errors'
import {
  createGitFixture,
  fixtureGit,
  openFixtureWorkspace,
  releaseFixture,
} from '../fixture-workspace'
import { openGitPanel, selectors } from '../selectors'

type Mode = 'stacked' | 'split'
type Position = { top: number; left: number; width: number; contentWidth: number }
type Subject = { tab: string; source: string; rows: string[] }
const files = ['b.txt', 'c.txt', 'split-b.txt', 'split-c.txt', 'late.txt', 'current.txt']
const inspection = new WeakMap<Page, unknown>()
const subjectSampler = `() => ({
  tab: document.querySelector(${JSON.stringify(selectors.selectedComparisonTabSelector)})?.textContent ?? '',
  source: location.pathname,
  rows: [...document.querySelectorAll(${JSON.stringify(selectors.comparisonRowsSelector)})]
    .filter(row => !row.hidden && row.getBoundingClientRect().height > 0)
    .map(row => row.textContent?.slice(0, 180) ?? '')
})`

export const gitDiffScroll: Scenario = {
  name: 'git-diff-scroll',
  requiresIsolatedServer: true,
  description:
    'Split and stacked diffs restore both scroll axes; an uncached late reply preserves the selected comparison.',
  inspect: async (page) => inspection.get(page) ?? null,
  async run(page, { step, evidence }) {
    const fixture = await createGitFixture('diff-scroll')
    const observations: unknown[] = []
    const reads: string[] = []
    inspection.set(page, { observations, reads })
    try {
      await prepareFixture(fixture)
      await page.route('**/git/diff?*', async (route) => {
        reads.push(route.request().url())
        await route.continue()
      })
      await openFixtureWorkspace(page, fixture)
      await openGitPanel(page)
      await disablePrefetch(page)
      for (const mode of ['stacked', 'split'] satisfies Mode[])
        await verifyMode(page, mode, observations, step)
      await verifyLateRead(page, evidence, reads, observations, step)
    } catch (error) {
      await capture(page, observations, 'failed-control')
      await page.screenshot({ path: evidence.file('failed-control.png') })
      throw error
    } finally {
      await evidence.json('scroll-observations.json', { observations, reads })
      await page.goto('about:blank')
      await releaseFixture(fixture)
    }
  },
}

async function verifyMode(
  page: Page,
  mode: Mode,
  observations: unknown[],
  step: (label: string) => Promise<void>,
) {
  await selectMode(page, mode)
  const first = mode === 'stacked' ? 'b.txt' : 'split-b.txt'
  const second = mode === 'stacked' ? 'c.txt' : 'split-c.txt'
  await selectors.gitChangeRow(page, first).dblclick()
  await waitForSubject(page, first, mode)
  await capture(page, observations, `${mode}-first-diff-top`)
  await step(`${mode}-first-diff-top`)
  await scrollers(page).first().hover()
  await page.mouse.wheel(0, 1800)
  await page.waitForTimeout(400)
  const vertical = await positions(page)
  ok(
    vertical.every(({ top }) => top > 500),
    `First diff must scroll: ${JSON.stringify(vertical)}`,
  )
  await page.mouse.wheel(900, 0)
  await page.waitForTimeout(400)
  const saved = await capture(page, observations, `${mode}-first-diff-scrolled`)
  ok(
    saved.every(({ left }) => left > 0),
    `First diff must scroll horizontally: ${JSON.stringify(saved)}`,
  )
  deepStrictEqual(
    saved.map(({ top }) => top),
    vertical.map(({ top }) => top),
    'Horizontal scroll preserves vertical offsets',
  )
  await step(`${mode}-first-diff-scrolled`)
  await selectors.gitChangeRow(page, second).dblclick()
  await waitForSubject(page, second, mode)
  await page.waitForTimeout(500)
  const fresh = await capture(page, observations, `${mode}-new-diff`)
  deepStrictEqual(
    fresh.map(({ top, left }) => ({ top, left })),
    fresh.map(() => ({ top: 0, left: 0 })),
    'An unvisited diff must start at the top and left',
  )
  await step(`${mode}-new-diff`)
  await selectors.gitChangeRow(page, first).click()
  await waitForSubject(page, first, mode)
  await page.waitForTimeout(400)
  const restored = await capture(page, observations, `${mode}-restored-first-diff`)
  deepStrictEqual(
    restored.map(({ top, left }) => ({ top, left })),
    saved.map(({ top, left }) => ({ top, left })),
    'A visited diff must restore its offset',
  )
  await step(`${mode}-restored-first-diff`)
}

async function prepareFixture(fixture: string) {
  for (const file of files) await writeFile(path.join(fixture, file), fixtureText(file, 'before'))
  await fixtureGit(fixture, ['add', '.'])
  await fixtureGit(fixture, ['commit', '--quiet', '-m', 'initial'])
  for (const file of files) await writeFile(path.join(fixture, file), fixtureText(file, 'after'))
}

function fixtureText(file: string, version: string) {
  return Array.from(
    { length: 300 },
    (_, i) => `${file} ${version} line ${i} ${`${file} ${version} wide `.repeat(20)}`,
  ).join('\n')
}

async function disablePrefetch(page: Page) {
  await page.keyboard.press('Control+,')
  await selectors.settingsSearch(page).fill('prefetch')
  const toggle = selectors.settingsSwitch(page, 'Prefetch diffs')
  if ((await toggle.getAttribute('aria-checked')) === 'true') {
    await Promise.all([
      page.waitForResponse(
        (response) => response.url().endsWith('/settings/write') && response.ok(),
      ),
      toggle.click(),
    ])
  }
  strictEqual(
    await toggle.getAttribute('aria-checked'),
    'false',
    'Cold sources have prefetch disabled through Settings',
  )
  await page.keyboard.press('Escape')
}

async function selectMode(page: Page, mode: Mode) {
  await page.keyboard.press('Control+,')
  await selectors.settingsSearch(page).fill('diff view mode')
  await selectors.settingsEnum(page, 'Diff view mode').click()
  await selectors.settingsEnumOption(page, mode === 'split' ? 'Side by side' : 'Stacked').click()
  await page.keyboard.press('Escape')
}

function scrollers(page: Page) {
  return selectors.diffPanes(page).locator(selectors.diffScrollerSelector)
}

function positions(page: Page) {
  return scrollers(page).evaluateAll((elements) =>
    elements.map((element) => ({
      top: element.scrollTop,
      left: element.scrollLeft,
      width: element.clientWidth,
      contentWidth: element.scrollWidth,
    })),
  )
}

async function capture(page: Page, observations: unknown[], label: string): Promise<Position[]> {
  const nativePositions = await positions(page)
  observations.push({
    label,
    positions: nativePositions,
    subject: await page.evaluate<Subject>(`(${subjectSampler})()`),
  })
  return nativePositions
}

async function waitForSubject(page: Page, file: string, mode: Mode) {
  const panes = selectors.diffPanes(page)
  await panes.nth(mode === 'split' ? 1 : 0).waitFor()
  strictEqual(await panes.count(), mode === 'split' ? 2 : 1, `Actual ${mode} pane count`)
  await selectors
    .diffRows(page)
    .filter({ hasText: `${file} ${mode === 'stacked' ? 'before' : 'after'}` })
    .first()
    .waitFor()
  if (mode === 'split')
    await selectors
      .diffRows(page)
      .filter({ hasText: `${file} before` })
      .first()
      .waitFor()
  assertSubject(await page.evaluate<Subject>(`(${subjectSampler})()`), file)
}

function assertSubject(subject: Subject, file: string) {
  ok(subject.tab.includes(file), `Selected tab must name ${file}: ${subject.tab}`)
  ok(
    subject.source.includes('d/worktree/live/') && subject.source.includes(file),
    `Selected source must name ${file}: ${subject.source}`,
  )
  ok(
    subject.rows.length > 0 && subject.rows.every((row) => row.includes(file)),
    `Installed rows must belong to ${file}: ${JSON.stringify(subject)}`,
  )
}

async function verifyLateRead(
  page: Page,
  evidence: Evidence,
  reads: string[],
  observations: unknown[],
  step: (label: string) => Promise<void>,
) {
  strictEqual(
    reads.filter((url) =>
      /\/(late|current)\.txt$/.test(new URL(url).searchParams.get('path') ?? ''),
    ).length,
    0,
    'Both rapid-switch sources are uncached',
  )
  const fetched = Promise.withResolvers<void>()
  const release = Promise.withResolvers<void>()
  const delivered = Promise.withResolvers<void>()
  const holdReply = async (route: Route) => {
    reads.push(route.request().url())
    const response = await route.fetch({ timeout: 10_000 })
    ok(response.ok(), `Actual late Git read succeeded: ${response.status()}`)
    const body = await response.body()
    await evidence.write('late-git-response.json', body)
    await evidence.json('late-git-response-meta.json', {
      url: route.request().url(),
      status: response.status(),
      bytes: body.length,
    })
    observations.push({ label: 'cold-former-reply-fetched', at: Date.now() })
    fetched.resolve()
    await release.promise
    await route.fulfill({ response, body })
    observations.push({ label: 'cold-former-reply-delivered', at: Date.now() })
    delivered.resolve()
  }
  await page.route('**/git/diff?*', async (route) => {
    if (new URL(route.request().url()).searchParams.get('path')?.endsWith('/late.txt')) {
      await holdReply(route)
      return
    }
    await route.fallback()
  })
  try {
    await selectors.gitChangeRow(page, 'late.txt').click()
    await bounded(fetched.promise, 'uncached Git response')
    await step('cold-former-reply-held')
    const frames = await recordFrames<Subject>(page, subjectSampler, async () => {
      await selectors.gitChangeRow(page, 'current.txt').click()
      await waitForSubject(page, 'current.txt', 'split')
      await capture(page, observations, 'cold-current-before-late-reply')
      await step('cold-current-before-late-reply')
      observations.push({ label: 'cold-former-reply-release', at: Date.now() })
      release.resolve()
      await bounded(delivered.promise, 'late Git reply delivery')
      await page.waitForTimeout(400)
      await waitForSubject(page, 'current.txt', 'split')
    })
    await evidence.json('cold-switch-frames.json', frames)
    ok(
      frames.every(({ rows }) => rows.every((row) => !row.includes('late.txt'))),
      'The superseded cold reply never installs former rows',
    )
    const current = frames.findIndex(({ tab }) => tab.includes('current.txt'))
    ok(current >= 0, 'Frame observer saw the selected current source')
    for (const frame of frames.slice(current)) assertSubject(frame, 'current.txt')
    strictEqual(
      reads.filter((url) => new URL(url).searchParams.get('path')?.endsWith('/late.txt')).length,
      1,
      'One actual former uncached read',
    )
    strictEqual(
      reads.filter((url) => new URL(url).searchParams.get('path')?.endsWith('/current.txt')).length,
      1,
      'One actual current uncached read',
    )
    const fresh = await capture(page, observations, 'cold-current-after-late-reply')
    ok(
      fresh.every(({ top, left }) => top === 0 && left === 0),
      'The cold current comparison starts at zero on both axes',
    )
    await step('cold-current-after-late-reply')
  } finally {
    release.resolve()
  }
}

async function bounded(promise: Promise<void>, operation: string) {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<void>((_, reject) => {
    timer = setTimeout(
      () => reject(createScriptError('Git scroll control timed out.', { internal: { operation } })),
      10_000,
    )
  })
  try {
    await Promise.race([promise, timeout])
  } finally {
    clearTimeout(timer)
  }
}
