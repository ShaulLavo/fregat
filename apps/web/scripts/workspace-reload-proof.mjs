import { fingerprint } from './reload-proof-fingerprint.mjs'
import { scenarioConfig, setupScenario, observeScenario } from './workspace-reload-search-chat.mjs'
import { chromium } from 'playwright'
import { mkdir, writeFile, realpath, rm } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { parseArgs } from 'node:util'
import {
  selectors,
  waitForApp,
  openGitPanel,
  openFileByName,
} from '../../../scripts/agent/selectors.ts'
import { createBenchmarkError } from './structured-errors.mjs'

const repository = fileURLToPath(new URL('../../..', import.meta.url))
const { values } = parseArgs({
  options: {
    url: { type: 'string', default: 'http://localhost:5173/' },
    'app-url': { type: 'string' },
    output: { type: 'string', default: '/work/tmp/platform-instaload/current' },
    scenario: { type: 'string', default: 'tree' },
    width: { type: 'string', default: '1440' },
    height: { type: 'string', default: '900' },
    check: { type: 'boolean', default: false },
    scroll: { type: 'boolean', default: false },
    'pending-scroll': { type: 'boolean', default: false },
    'measure-writes': { type: 'boolean', default: false },
    'hold-health': { type: 'boolean', default: false },
  },
})
if (values['app-url']) values.url = values['app-url']
if (values['pending-scroll'] && values.scenario !== 'tree')
  throw createBenchmarkError('Pending scroll proof requires the tree scenario')
if (values['pending-scroll']) values.scroll = true
if (
  values.scenario === 'all' ||
  values.scenario.startsWith('diff') ||
  values.scenario === 'terminal'
) {
  const scenarios =
    values.scenario === 'all'
      ? [
          'tree',
          'settings',
          'settings-json',
          'git',
          'editor',
          'search-compact',
          'search-full',
          'chat',
          'logs',
          'diagnostics',
          'diff-stacked',
          'diff-split',
          'diff-large-stacked',
          'diff-large-split',
          'terminal',
        ]
      : [values.scenario]
  const results = []
  for (const scenario of scenarios) {
    const native = scenario.startsWith('diff') || scenario === 'terminal'
    let filename = 'workspace-reload-proof.mjs'
    if (scenario.startsWith('diff')) filename = 'diff-reload-proof.mjs'
    if (scenario === 'terminal') filename = 'terminal-reload-proof.mjs'
    const output = values.scenario === 'all' ? `${values.output}/${scenario}` : values.output
    const args = [
      fileURLToPath(new URL(filename, import.meta.url)),
      '--url',
      values.url,
      '--output',
      output,
      '--width',
      values.width,
      '--height',
      values.height,
    ]
    if (values.check) args.push('--check')
    if (scenario.startsWith('diff'))
      args.push('--mode', scenario.endsWith('split') ? 'split' : 'stacked')
    if (scenario.includes('large')) args.push('--large')
    if (!native) args.push('--scenario', scenario)
    if (['tree', 'settings'].includes(scenario)) args.push('--scroll')
    if (!native && values['hold-health']) args.push('--hold-health')
    const result = spawnSync(process.execPath, args, { encoding: 'utf8', maxBuffer: 1024 * 1024 })
    results.push({
      scenario,
      passed: result.status === 0,
      output,
      stdout: result.stdout,
      stderr: result.stderr,
    })
    console.log(JSON.stringify({ scenario, passed: result.status === 0, output }))
  }
  await mkdir(values.output, { recursive: true })
  await writeFile(`${values.output}/matrix.json`, JSON.stringify(results, null, 2))
  process.exit(results.every((result) => result.passed) ? 0 : 1)
}

const browser = await chromium.launch({ headless: true })
const page = await browser.newPage({
  viewport: { width: Number(values.width), height: Number(values.height) },
})
page.setDefaultTimeout(15000)
const errors = []
const filmstrip = []
const filmstripWrites = []
let scenarioCleanup = async () => {}
let diagnosticFixture = null
let holdingStreams = false
let heldFrames = 0
const streamQueue = []
page.on('pageerror', (error) => errors.push(error.message))
await mkdir(values.output, { recursive: true })
try {
  const url = new URL(values.url)
  const apiUrl = new URL(url)
  if (apiUrl.port === '5173') apiUrl.port = '3001'
  const api = url.port === '5173' ? apiUrl.origin + '/' : new URL('api/', url).href
  if (values.scenario === 'logs')
    await page.route('**/_log/dashboard/live*', (route) => route.abort())
  const release = await page.request.get(`${api}release`).then((response) => response.json())
  const registration = await page.request.post(`${api}fs/workspace-address`, {
    data: { path: 'work/projects/platform' },
    headers: { Origin: url.origin },
  })
  if (!registration.ok()) throw createBenchmarkError('Workspace registration failed')
  const workspace = await registration.json()
  const addressed = `${values.url.replace(/\/$/, '')}/~${encodeURIComponent(`${workspace.name}.${workspace.id}`)}/workbench`
  await page.goto(url.pathname === '/' ? addressed : values.url)
  await waitForApp(page)
  await selectors.folderTree(page).getByRole('treeitem').first().waitFor()
  if (values.scenario.startsWith('settings')) {
    await page.keyboard.press('Control+,')
    await selectors.settingsSearch(page).waitFor()
    if (values.scenario === 'settings-json') {
      await page.getByRole('button', { name: 'settings.json', exact: true }).click()
      await selectors.editorInput(page).waitFor()
    } else if (!values.scroll) await selectors.settingsSearch(page).fill('font size')
  }
  if (values.scenario === 'git' || values.scenario === 'diff') {
    await openGitPanel(page)
    await selectors.gitPanel(page).getByRole('treeitem').first().waitFor()
    if (values.scenario === 'diff') {
      await selectors
        .gitPanel(page)
        .getByRole('treeitem', { name: /main.tsx/ })
        .first()
        .dblclick()
      await selectors.editorSurface(page).first().waitFor()
    }
  }
  if (values.scenario === 'logs') {
    await selectors.logsTab(page).click()
    await selectors.logRows(page).first().waitFor()
  }
  if (values.scenario === 'editor') await openFileByName(page, 'main.tsx')
  if (values.scenario === 'diagnostics') {
    const name = `reload-proof-${crypto.randomUUID()}.ts`
    diagnosticFixture = resolve(repository, 'apps/web/src', name)
    await writeFile(
      diagnosticFixture,
      'export const reloadProofDiagnostic: number = "intentional type mismatch"\n',
    )
    await openFileByName(page, name)
    await selectors.bottomTab(page, 'Problems').click()
    await page
      .getByText(/Type 'string' is not assignable to type 'number'/)
      .first()
      .waitFor({ timeout: 30000 })
  }
  if (scenarioConfig[values.scenario])
    scenarioCleanup = (await setupScenario(page, values.scenario)).cleanup
  await page.waitForTimeout(1500)
  if (values.scroll && values.scenario === 'tree') {
    for (const name of ['apps', 'web', 'src', 'features']) {
      const row = selectors.folderTree(page).getByRole('treeitem', { name, exact: true }).first()
      if ((await row.getAttribute('aria-expanded')) === 'true') continue
      await row.focus()
      await row.press('ArrowRight')
      await page.waitForTimeout(300)
    }
  }
  if (values.scroll) {
    const scroll =
      values.scenario === 'tree'
        ? page.locator('[data-file-tree-virtualized-scroll]')
        : page.getByRole('region', { name: 'Settings form', exact: true })
    await scroll.evaluate((element) => {
      element.scrollTop = 320
    })
    await page.waitForTimeout(100)
  }
  if (values.scenario === 'tree')
    await selectors
      .folderTree(page)
      .locator('[data-item-loading]')
      .first()
      .waitFor({ state: 'detached' })
  if (scenarioConfig[values.scenario]?.holdWebSockets || values.scenario === 'diagnostics') {
    await page.routeWebSocket('**/*', (socket) => {
      const server = socket.connectToServer()
      socket.onMessage((data) => server.send(data))
      server.onMessage((data) => {
        if (!holdingStreams) {
          socket.send(data)
          return
        }
        heldFrames += 1
        streamQueue.push(() => socket.send(data))
      })
    })
  }
  const writeMeasurements = values['measure-writes']
    ? await page.evaluate(() => {
        const samples = []
        Object.defineProperty(document, 'visibilityState', {
          configurable: true,
          get: () => 'hidden',
        })
        try {
          for (let index = 0; index < 25; index++) {
            document.dispatchEvent(new Event('visibilitychange'))
            samples.push(performance.getEntriesByName('workspace.reload.flush').at(-1)?.detail)
          }
        } finally {
          Reflect.deleteProperty(document, 'visibilityState')
          document.dispatchEvent(new Event('visibilitychange'))
        }
        return samples
      })
    : []
  const writeStress = values['measure-writes'] ? await page.evaluate(measureStorageStress) : null
  const control = await observe(page)
  await page.screenshot({ path: `${values.output}/control.png` })
  const session = await page.context().newCDPSession(page)
  const held = new Set()
  session.on('Page.screencastFrame', (event) => {
    const index = filmstrip.length
    if (index < 120) {
      const file = `frame-${String(index).padStart(3, '0')}.png`
      filmstrip.push({ file, ...event.metadata })
      filmstripWrites.push(writeFile(`${values.output}/${file}`, Buffer.from(event.data, 'base64')))
    }
    void session.send('Page.screencastFrameAck', { sessionId: event.sessionId })
  })
  await session.send('Page.startScreencast', { format: 'png', everyNthFrame: 1 })
  session.on('Fetch.requestPaused', (event) => {
    held.add(event.requestId)
  })
  holdingStreams = true
  await session.send('Fetch.enable', {
    patterns: [
      { urlPattern: `${api}fs/tree*`, requestStage: 'Response' },
      { urlPattern: `${api}settings`, requestStage: 'Response' },
      { urlPattern: `${api}git/*`, requestStage: 'Response' },
      { urlPattern: `${api}_log/dashboard/*`, requestStage: 'Response' },
      { urlPattern: `${api}fs/read*`, requestStage: 'Response' },
      ...(scenarioConfig[values.scenario]?.holdPaths ?? []).map((path) => ({
        urlPattern: `${api.replace(/\/$/, '')}${path}*`,
        requestStage: 'Response',
      })),
      ...(values['hold-health'] ? [{ urlPattern: `${api}health*`, requestStage: 'Response' }] : []),
    ],
  })
  await page.addInitScript(recordFrames, {
    scenario: values.scenario,
    contentSelector: scenarioConfig[values.scenario]?.contentSelector,
  })
  await page.reload({ waitUntil: 'commit' })
  await selectors.windowToolbar(page).waitFor({ timeout: 30000 })
  await page.waitForTimeout(1500)
  const saved = await observe(page)
  const frames = await page.evaluate(() => window.__reloadFrames ?? [])
  await page.screenshot({ path: `${values.output}/held.png` })
  let pendingScroll = null
  if (values['pending-scroll']) {
    await page.locator('[data-file-tree-virtualized-scroll]').evaluate((element) => {
      element.scrollTop += 64
    })
    await page.waitForTimeout(100)
    const edited = await observe(page)
    await page.reload({ waitUntil: 'commit' })
    await selectors.windowToolbar(page).waitFor({ timeout: 30000 })
    await page.waitForTimeout(1500)
    const repeated = await observe(page)
    pendingScroll = { edited: edited.scrollTop, repeated: repeated.scrollTop }
    await page.screenshot({ path: `${values.output}/pending-edited-reload.png` })
  }
  await session.send('Fetch.disable')
  holdingStreams = false
  for (const send of streamQueue.splice(0)) send()
  await page.waitForTimeout(1500)
  const live = await observe(page)
  await page.screenshot({ path: `${values.output}/live.png` })
  await session.send('Page.stopScreencast')
  await Promise.all(filmstripWrites)
  const restored = matchesSavedPresentation(control, saved)
  const firstShell = frames.find((frame) => frame.shell)
  const firstFrameRestored = Boolean(firstShell?.content)
  const scrollRestored = scenarioConfig[values.scenario]
    ? control.scenario.scrollTop > 0 &&
      Math.abs(control.scenario.scrollTop - saved.scenario.scrollTop) <= 1 &&
      Math.abs(control.scenario.scrollTop - live.scenario.scrollTop) <= 1
    : !values.scroll ||
      (control.scrollTop > 0 &&
        control.scrollTop === saved.scrollTop &&
        (pendingScroll?.edited ?? control.scrollTop) === live.scrollTop)
  const pendingScrollRestored =
    pendingScroll === null ||
    (pendingScroll.edited > control.scrollTop && pendingScroll.edited === pendingScroll.repeated)
  const result = {
    writeMeasurements,
    writeStress,
    pendingScroll,
    pendingScrollRestored,
    platform: await fingerprint(repository),
    editor: await fingerprint(
      resolve(
        await realpath(new URL('../node_modules/@singapore-editor/core', import.meta.url)),
        '../..',
      ),
    ),
    release,
    scenario: values.scenario,
    workspaceId: workspace.id,
    heldRequests: held.size,
    heldFrames,
    control,
    saved,
    live,
    restored,
    scrollRestored,
    firstFrameRestored,
    frames,
    filmstrip,
    errors,
  }
  await writeFile(`${values.output}/result.json`, JSON.stringify(result, null, 2))
  await writeFile(
    `${values.output}/budgets.json`,
    JSON.stringify(
      {
        records: saved.restoreMeasures,
        storageBytes: saved.storageBytes,
        aggregate: saved.restoreMeasures.find(
          (entry) => entry.name === 'workspace.reload.aggregate',
        ),
      },
      null,
      2,
    ),
  )
  console.log(
    JSON.stringify({
      restored,
      scrollRestored,
      firstFrameRestored,
      heldRequests: held.size,
      errors,
      output: values.output,
    }),
  )
  if (
    values.check &&
    (!restored ||
      !scrollRestored ||
      !pendingScrollRestored ||
      !firstFrameRestored ||
      held.size === 0 ||
      errors.length)
  )
    process.exitCode = 1
} finally {
  await scenarioCleanup()
  if (diagnosticFixture) await rm(diagnosticFixture, { force: true })
  await browser.close()
}

function matchesSavedPresentation(control, saved) {
  if (scenarioConfig[values.scenario])
    return (
      control.scenario.rows.length > 0 &&
      JSON.stringify(control.scenario.rows) === JSON.stringify(saved.scenario.rows)
    )
  if (['git', 'logs', 'editor', 'diff', 'diagnostics'].includes(values.scenario))
    return (
      control.surface.length > 0 &&
      JSON.stringify(control.surface) === JSON.stringify(saved.surface)
    )
  if (values.scenario === 'settings-json')
    return (
      control.jsonPaint.length > 0 &&
      JSON.stringify(control.jsonPaint) === JSON.stringify(saved.jsonPaint)
    )
  const field = values.scenario.startsWith('settings') ? 'settings' : 'rows'
  return (
    control[field].length > 0 &&
    JSON.stringify(control[field]) === JSON.stringify(saved[field]) &&
    control.search === saved.search &&
    control.fontSize === saved.fontSize
  )
}

async function visibleText(page, selector) {
  return page.locator(selector).evaluateAll((elements) =>
    elements
      .filter((element) => {
        const rect = element.getBoundingClientRect()
        const viewport = element.closest('.editor-virtualized')?.getBoundingClientRect()
        const top = viewport?.top ?? 0
        const bottom = viewport?.bottom ?? window.innerHeight
        return rect.height > 0 && rect.bottom > top && rect.top < bottom
      })
      .map((element) => element.textContent),
  )
}

async function observe(page) {
  const surfaceSelector = {
    git: '[aria-label="Git changes"] [role="treeitem"]',
    logs: '[data-log-row-summary]',
    editor: '.editor-virtualized-row',
    diff: '.editor-diff-pane .editor-virtualized-row',
    diagnostics: '[aria-label="Diagnostics"] > div',
  }[values.scenario]
  return {
    scenario: scenarioConfig[values.scenario] ? await observeScenario(page, values.scenario) : null,
    surface: surfaceSelector ? await visibleText(page, surfaceSelector) : [],
    scrollTop: await page
      .locator(
        values.scenario === 'tree'
          ? '[data-file-tree-virtualized-scroll]'
          : '[aria-label="Settings form"]',
      )
      .evaluateAll((elements) => elements.at(-1)?.scrollTop ?? 0),
    rows: await selectors.folderTree(page).getByRole('treeitem').allTextContents(),
    settings: await page.locator('label[for="editor.fontSize"]').allTextContents(),
    fontSize: await optionalInput(page.locator('[id="editor.fontSize"]')),
    jsonPaint: await visibleText(page, '.editor-virtualized-row'),
    display: await page
      .locator('[data-settings-display]')
      .evaluateAll((elements) => elements[0]?.getAttribute('data-settings-display') ?? null),
    search: await optionalInput(selectors.settingsSearch(page)),
    restoreMeasures: await page.evaluate(() =>
      performance
        .getEntriesByType('measure')
        .filter((entry) => entry.name.startsWith('workspace.reload.'))
        .map((entry) => ({ name: entry.name, durationMs: entry.duration, ...entry.detail })),
    ),
    admissions: await page.evaluate(() =>
      performance.getEntriesByName('editor.snapshot.admission').map((entry) => entry.detail),
    ),
    savedViews: await page.evaluate(() =>
      Object.keys(sessionStorage)
        .filter((key) => key.endsWith('settings.display.v1'))
        .map((key) => JSON.parse(sessionStorage.getItem(key)).view),
    ),
    storageBytes: await page.evaluate(() =>
      Object.fromEntries(
        Object.keys(sessionStorage)
          .filter((key) => key.endsWith('.display.v1') || key.endsWith('tree-display.v1'))
          .map((key) => [key, (sessionStorage.getItem(key)?.length ?? 0) * 2]),
      ),
    ),
  }
}

async function optionalInput(locator) {
  return (await locator.count()) ? locator.inputValue() : null
}

function recordFrames({ scenario, contentSelector }) {
  const frames = []
  window.__reloadFrames = frames
  let remaining = 240
  function find(root, selector) {
    const match = root.querySelector(selector)
    if (match) return match
    for (const element of root.querySelectorAll('*')) {
      if (!element.shadowRoot) continue
      const nested = find(element.shadowRoot, selector)
      if (nested) return nested
    }
    return null
  }
  function frame() {
    const shell = Boolean(document.querySelector('[aria-label="Window toolbar"]'))
    const selector =
      contentSelector ??
      {
        diagnostics: '[aria-label="Diagnostics"] > div',
        git: '[aria-label="Git changes"] [role="treeitem"]',
        logs: '[data-log-row-summary]',
        editor: '.editor-virtualized-row',
        diff: '.editor-diff-pane .editor-virtualized-row',
      }[scenario] ??
      (scenario === 'tree' ? '[role="treeitem"]' : '[data-settings-display]')
    const surface = find(document, selector)
    const content =
      scenario === 'settings-json'
        ? Boolean(document.querySelector('.editor-virtualized-viewport')?.textContent?.trim())
        : Boolean(surface)
    const observation = { at: performance.now(), shell, content }
    const previous = frames.at(-1)
    if (!previous || previous.shell !== shell || previous.content !== content)
      frames.push(observation)
    if (--remaining > 0) requestAnimationFrame(frame)
  }
  requestAnimationFrame(frame)
}

function measureStorageStress() {
  const records = Array.from({ length: 13 }, () => ({ text: 'x'.repeat(80_000) }))
  const samples = []
  let bytes = 0
  function writeRecords() {
    let total = 0
    for (let index = 0; index < records.length; index++) {
      const value = JSON.stringify(records[index])
      total += value.length * 2
      sessionStorage.setItem('_reload-write-proof-' + index, value)
    }
    return total
  }
  try {
    for (let run = 0; run < 25; run++) {
      const start = performance.now()
      bytes = writeRecords()
      samples.push(performance.now() - start)
    }
  } finally {
    for (let index = 0; index < records.length; index++)
      sessionStorage.removeItem('_reload-write-proof-' + index)
  }
  return { records: records.length, bytes, durationMs: samples }
}
