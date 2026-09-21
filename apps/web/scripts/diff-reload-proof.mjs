import { fingerprint } from './reload-proof-fingerprint.mjs'
import { chromium } from 'playwright'
import { mkdir, mkdtemp, writeFile, readFile, realpath, rm } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { execFileSync } from 'node:child_process'
import { parseArgs } from 'node:util'
import { selectors, waitForApp, openGitPanel } from '../../../scripts/agent/selectors.ts'
import { createBenchmarkError } from './structured-errors.mjs'

const { values } = parseArgs({
  options: {
    url: { type: 'string', default: 'http://localhost:5173/' },
    width: { type: 'string', default: '1440' },
    height: { type: 'string', default: '1000' },
    output: {
      type: 'string',
      default: '/work/tmp/platform-instaload/all-slices/diff',
    },
    mode: { type: 'string', default: 'stacked' },
    large: { type: 'boolean', default: false },
    check: { type: 'boolean', default: false },
    'fail-revalidation': { type: 'boolean', default: false },
  },
})
await mkdir(values.output, { recursive: true })
const fixture = await mkdtemp(`${values.output}/fixture-`)
const url = new URL(values.url)
const apiUrl = new URL(url.port === '5173' ? '/' : 'api/', url)
if (url.port === '5173') apiUrl.port = '3001'
const api = apiUrl.href
const git = (...args) =>
  execFileSync('git', ['-C', fixture, ...args], { stdio: 'pipe' })
    .toString()
    .trim()
git('init', '-q')
const lines = Array.from(
  { length: values.large ? 6500 : 120 },
  (_, index) => `export const value${index} = "before ${'x'.repeat(values.large ? 110 : 15)}";`,
)
await writeFile(`${fixture}/sample.ts`, lines.join('\n'))
git('add', 'sample.ts')
git(
  '-c',
  'user.name=Reload proof',
  '-c',
  'user.email=reload-proof@localhost',
  'commit',
  '-qm',
  'Fixture baseline',
)
await writeFile(
  `${fixture}/sample.ts`,
  lines.map((line, index) => (index % 9 === 0 ? line.replace('before', 'after') : line)).join('\n'),
)
const browser = await chromium.launch({ headless: true })
const context = await browser.newContext({
  viewport: { width: Number(values.width), height: Number(values.height) },
})
const page = await context.newPage()
page.setDefaultTimeout(15000)
const errors = []
const terminalOwners = new Map()
const fixtureWorktrees = new Set()
const registrations = []
page.on('response', (response) => {
  if (!response.url().endsWith('/orchestration/commands')) return
  const request = response.request()
  const command = request.postDataJSON()
  if (
    command?.type !== 'project.create' ||
    command.workspaceRoot?.replace(/^\//, '') !== fixture.replace(/^\//, '')
  )
    return
  registrations.push(
    response.json().then((receipt) => {
      if (receipt.result?.worktreeId) fixtureWorktrees.add(receipt.result.worktreeId)
    }),
  )
})
page.on('websocket', (socket) => {
  const address = new URL(socket.url())
  if (!address.pathname.endsWith('/terminal')) return
  const worktreeId = address.searchParams.get('worktreeId')
  const terminalId = address.searchParams.get('terminalId')
  if (!worktreeId || !terminalId) return
  terminalOwners.set(`${worktreeId}:${terminalId}`, { worktreeId, terminalId })
})
page.on('pageerror', (error) => errors.push(error.message))
let initialMode = null
let session
try {
  const registration = await page.request.post(`${api}fs/workspace-address`, {
    data: { path: fixture.replace(/^\//, '') },
    headers: { Origin: url.origin },
  })
  if (!registration.ok()) throw createBenchmarkError('Fixture registration failed')
  const workspace = await registration.json()
  await page.goto(
    `${values.url.replace(/\/$/, '')}/~${encodeURIComponent(`${workspace.name}.${workspace.id}`)}/workbench`,
  )
  await waitForApp(page)
  await openGitPanel(page)
  await selectors.gitChangeRow(page, 'sample.ts').dblclick()
  await page.locator('.editor-diff-pane .editor-virtualized-row').first().waitFor()
  initialMode = (await page
    .getByRole('button', { name: 'Switch to split diff', exact: true })
    .count())
    ? 'stacked'
    : 'split'
  if (initialMode !== values.mode)
    await page
      .getByRole('button', {
        name: `Switch to ${values.mode} diff`,
        exact: true,
      })
      .click()
  await page.waitForTimeout(3000)
  await page.locator('.editor-diff-pane .editor-virtualized').evaluateAll((elements) =>
    elements.forEach((element) => {
      element.scrollTop = 620
    }),
  )
  await page.waitForTimeout(250)
  const target = await page
    .locator('.editor-diff-pane')
    .last()
    .evaluate((pane) => {
      const bounds = pane.querySelector('.editor-virtualized').getBoundingClientRect()
      const row = [...pane.querySelectorAll('.editor-virtualized-row')]
        .filter(
          (row) =>
            row.getBoundingClientRect().top > bounds.top + 50 &&
            row.textContent.startsWith('export const'),
        )
        .sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top)[0]
      const rect = row.getBoundingClientRect()
      return { x: rect.left + 160, y: rect.top + rect.height / 2 }
    })
  await page.mouse.dblclick(target.x, target.y)
  await page.waitForTimeout(100)
  const selectedText = await page.evaluate(() => window.getSelection()?.toString() ?? '')
  if (!selectedText) throw createBenchmarkError('Real diff selection did not select text')
  const control = await observe(page)
  if (!control.panes.some((pane) => pane.selection.length > 0))
    throw createBenchmarkError('Real diff selection has no visible native paint')
  if (control.panes.length === 0 || control.panes.some((pane) => pane.rows.length === 0))
    throw createBenchmarkError('Settled diff has no rows')
  await page.screenshot({ path: `${values.output}/control.png` })
  await page.locator('.editor-diff-view').screenshot({ path: `${values.output}/control-pane.png` })
  session = await page.context().newCDPSession(page)
  let held = 0
  const paused = []
  let failing = false
  const failResponse = (request) =>
    session.send('Fetch.fulfillRequest', {
      requestId: request.requestId,
      responseCode: 503,
      responseHeaders: [
        { name: 'Content-Type', value: 'application/json' },
        { name: 'Access-Control-Allow-Origin', value: url.origin },
        { name: 'Access-Control-Allow-Credentials', value: 'true' },
      ],
      body: Buffer.from(
        JSON.stringify({ code: 'proof.DIFF_UNAVAILABLE', message: 'Diff reload proof failure' }),
      ).toString('base64'),
    })
  session.on('Fetch.requestPaused', (request) => {
    held += 1
    if (failing && request.request.url.startsWith(`${api}git/`)) {
      void failResponse(request)
      return
    }
    paused.push(request)
  })
  await session.send('Fetch.enable', {
    patterns: [
      { urlPattern: `${api}git/*`, requestStage: 'Response' },
      { urlPattern: `${api}settings*`, requestStage: 'Response' },
    ],
  })
  await page.addInitScript(() => {
    window.__diffFrames = []
    const sample = () => {
      const panes = Array.from(document.querySelectorAll('.editor-diff-pane'))
      if (panes.length)
        window.__diffFrames.push({
          time: performance.now(),
          rows: panes.map((pane) =>
            Array.from(pane.querySelectorAll('.editor-virtualized-row'))
              .filter((row) =>
                row.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }),
              )
              .map((row) => row.textContent),
          ),
          provisional: panes.map((pane) =>
            pane.querySelector('.editor-virtualized')?.getAttribute('data-editor-presentation'),
          ),
        })
      if (window.__diffFrames.length < 500) requestAnimationFrame(sample)
    }
    requestAnimationFrame(sample)
  })
  await page.reload({ waitUntil: 'commit' })
  await selectors.windowToolbar(page).waitFor()
  await page.waitForTimeout(2500)
  const saved = await observe(page)
  await page.screenshot({ path: `${values.output}/held.png` })
  await page.locator('.editor-diff-view').screenshot({ path: `${values.output}/held-pane.png` })
  let failed = null
  if (values['fail-revalidation']) {
    failing = true
    await Promise.all(
      paused.filter((request) => request.request.url.startsWith(`${api}git/`)).map(failResponse),
    )
    await page
      .getByText(/Diff reload proof failure|Something unexpected went wrong/)
      .first()
      .waitFor()
    failed = await observe(page)
    await page.screenshot({ path: `${values.output}/failed.png` })
    await page.locator('.editor-diff-view').screenshot({ path: `${values.output}/failed-pane.png` })
  }
  await session.send('Fetch.disable')
  if (failed)
    await page.evaluate(() => {
      window.dispatchEvent(new Event('offline'))
      window.dispatchEvent(new Event('online'))
    })
  await page.waitForTimeout(3500)
  const live = await observe(page)
  await page
    .context()
    .grantPermissions(['clipboard-read', 'clipboard-write'], { origin: url.origin })
  await page.locator('.editor-diff-pane').last().locator('textarea').focus()
  await page.keyboard.press('Control+c')
  const copiedText = await page.evaluate(() => navigator.clipboard.readText())
  await page.screenshot({ path: `${values.output}/live.png` })
  await page.locator('.editor-diff-view').screenshot({ path: `${values.output}/live-pane.png` })
  const frames = await page.evaluate(() => window.__diffFrames)
  const sameRows = (a, b) =>
    JSON.stringify(a.panes.map((pane) => pane.rows)) ===
    JSON.stringify(b.panes.map((pane) => pane.rows))
  const sameScroll = (a, b) =>
    JSON.stringify(a.panes.map((pane) => pane.scroll)) ===
    JSON.stringify(b.panes.map((pane) => pane.scroll))
  const samePaint = (a, b) =>
    JSON.stringify(a.panes.map(({ gutters, colors }) => ({ gutters, colors }))) ===
    JSON.stringify(b.panes.map(({ gutters, colors }) => ({ gutters, colors })))
  const result = {
    platform: await fingerprint(fileURLToPath(new URL('../../..', import.meta.url))),
    editor: await fingerprint(
      resolve(
        await realpath(new URL('../node_modules/@singapore-editor/core', import.meta.url)),
        '../..',
      ),
    ),
    fixtureHash: createHash('sha256')
      .update(await readFile(`${fixture}/sample.ts`))
      .digest('hex'),
    viewport: page.viewportSize(),
    failed,
    failureRetained:
      failed === null ||
      (sameRows(control, failed) &&
        sameScroll(control, failed) &&
        samePaint(control, failed) &&
        sameSelectionPaint(control, failed)),
    selectedText,
    copiedText,
    selectionRestored: sameSelectionPaint(control, saved),
    selectionReconciled: sameSelectionPaint(control, live) && copiedText === selectedText,
    mode: values.mode,
    large: values.large,
    held,
    errors,
    restored: sameRows(control, saved) && sameScroll(control, saved) && samePaint(control, saved),
    reconciled: sameRows(control, live) && sameScroll(control, live) && samePaint(control, live),
    blankFrames: frames.filter((frame) => frame.rows.some((rows) => rows.length === 0)).length,
    control,
    saved,
    live,
    frames,
  }
  await writeFile(`${values.output}/result.json`, JSON.stringify(result, null, 2))
  console.log(
    JSON.stringify(
      {
        failureRetained: result.failureRetained,
        selectionRestored: result.selectionRestored,
        selectionReconciled: result.selectionReconciled,
        restored: result.restored,
        reconciled: result.reconciled,
        blankFrames: result.blankFrames,
        errors,
        held,
        admissions: saved.admissions,
        caches: saved.caches,
      },
      null,
      2,
    ),
  )
  if (
    values.check &&
    (!result.failureRetained ||
      !result.restored ||
      !result.reconciled ||
      !result.selectionRestored ||
      !result.selectionReconciled ||
      result.blankFrames ||
      errors.length)
  )
    process.exitCode = 1
} finally {
  if (session) await session.send('Fetch.disable').catch(() => {})
  if (initialMode && initialMode !== values.mode)
    await page
      .getByRole('button', {
        name: `Switch to ${initialMode} diff`,
        exact: true,
      })
      .click()
      .catch(() => {})
  try {
    await page.close()
    await Promise.allSettled(registrations)
    const terminalCleanup = await Promise.all([...terminalOwners.values()].map(cleanupTerminal))
    if (terminalCleanup.some((entry) => !entry.confirmed)) process.exitCode = 1
    await writeFile(
      `${values.output}/terminal-cleanup.json`,
      JSON.stringify(terminalCleanup, null, 2),
    )
  } finally {
    await browser.close().finally(() => rm(fixture, { recursive: true, force: true }))
  }
}

async function cleanupTerminal(owner) {
  if (!fixtureWorktrees.has(owner.worktreeId))
    return {
      ...owner,
      confirmed: false,
      reason: 'Fixture ownership was not confirmed; no kill attempted',
    }
  try {
    const response = await context.request.post(`${api}terminal/kill`, {
      data: owner,
      headers: { Origin: url.origin },
    })
    const result = await response.json()
    return {
      ...owner,
      status: response.status(),
      result,
      confirmed: response.ok() && result.killed === true,
    }
  } catch (error) {
    return { ...owner, confirmed: false, reason: String(error) }
  }
}

async function observe(page) {
  return page.evaluate(() => ({
    selectedText: window.getSelection()?.toString() ?? '',
    panes: Array.from(document.querySelectorAll('.editor-diff-pane')).map((pane) => {
      const scroll = pane.querySelector('.editor-virtualized')
      const bounds = scroll?.getBoundingClientRect()
      const visible = (selector) =>
        Array.from(pane.querySelectorAll(selector))
          .filter((element) => {
            const rect = element.getBoundingClientRect()
            return (
              bounds &&
              element.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }) &&
              rect.bottom > bounds.top &&
              rect.top < bounds.bottom
            )
          })
          .sort(
            (left, right) => left.getBoundingClientRect().top - right.getBoundingClientRect().top,
          )
      const rows = visible('.editor-virtualized-row')
      return {
        side: pane.className,
        scroll: scroll?.scrollTop,
        provisional: scroll?.getAttribute('data-editor-presentation'),
        rows: rows.map((row) => row.textContent),
        gutters: visible('.editor-diff-gutter').map((cell) => cell.textContent),
        colors: rows.map((row) => getComputedStyle(row).backgroundColor),
        selection: visible(
          '.editor-virtualized-selection-range, [data-editor-saved-paint-layer="editor.selection"]',
        ).map((element) => {
          const rect = element.getBoundingClientRect()
          return {
            left: rect.left - bounds.left,
            top: rect.top - bounds.top,
            width: rect.width,
            height: rect.height,
            color: getComputedStyle(element).backgroundColor,
          }
        }),
      }
    }),
    admissions: performance
      .getEntriesByName('editor.snapshot.admission')
      .map((entry) => entry.detail),
    caches: Object.keys(sessionStorage)
      .filter((key) => /diff.paint|git.display/.test(key))
      .map((key) => ({ key, bytes: sessionStorage.getItem(key).length * 2 })),
  }))
}

function sameSelectionPaint(left, right) {
  return (
    JSON.stringify(left.panes.map((pane) => pane.selection)) ===
    JSON.stringify(right.panes.map((pane) => pane.selection))
  )
}
