import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { basename, join, relative, resolve, sep } from 'node:path'
import { chromium, firefox, webkit, expect } from 'playwright/test'
import { createBenchmarkError } from './structured-errors.mjs'

const options = parseOptions(process.argv.slice(2))
const instanceId = randomUUID()
const machineEvents = new AbortController()
let drainMachineEvents = null
const browsers = { chromium, firefox, webkit }
const report = {
  startedAt: new Date().toISOString(),
  options,
  clientInstanceId: instanceId,
  cases: [],
  prerequisites: {},
  cleanup: [],
}
mkdirSync(options.outputDir, { recursive: true })
let fixture = null
let secondFixture = null

try {
  report.prerequisites.server = await api('health')
  if (!options.historyOnly) {
    await verifyConfiguredApp()
    fixture = await createFixture(report.prerequisites.server)
    if (options.secondMachine) {
      await startMachineEvents()
      secondFixture = await createSecondFixture()
    }
  }
  for (const name of options.browsers) await verifyBrowser(name)
} catch (error) {
  report.cases.push({ name: 'prerequisites', status: 'failed', error: error.message })
} finally {
  if (secondFixture) await cleanupSecondFixture(secondFixture)
  if (fixture) await cleanupFixture(fixture)
  machineEvents.abort()
  await drainMachineEvents
  report.finishedAt = new Date().toISOString()
  report.status = report.cases.some((entry) => entry.status === 'failed') ? 'failed' : 'passed'
  writeFileSync(join(options.outputDir, 'results.json'), JSON.stringify(report, null, 2))
  process.stdout.write(`${report.status}: ${join(options.outputDir, 'results.json')}\n`)
  if (report.status === 'failed') process.exitCode = 1
}

function parseOptions(args) {
  const result = {
    appUrl: null,
    serverUrl: null,
    outputDir: null,
    browsers: ['chromium', 'firefox', 'webkit'],
    historyOnly: false,
    caseFilter: null,
    webkitEndpoint: null,
    secondMachine: null,
    secondFixtureParent: null,
  }
  for (let index = 0; index < args.length; index++) {
    const [key, inline] = args[index].split('=', 2)
    if (key === '--history-only') {
      result.historyOnly = true
      continue
    }
    const value = inline ?? args[++index]
    if (key === '--app-url') result.appUrl = value
    if (key === '--server-url') result.serverUrl = value
    if (key === '--output-dir') result.outputDir = value
    if (key === '--browsers') result.browsers = value.split(',')
    if (key === '--case') result.caseFilter = value
    if (key === '--webkit-endpoint') result.webkitEndpoint = value
    if (key === '--second-machine') result.secondMachine = value
    if (key === '--second-fixture-parent') result.secondFixtureParent = value
  }
  if (!result.appUrl || !result.serverUrl || !result.outputDir)
    throw createBenchmarkError(
      'Required: --app-url URL --server-url URL --output-dir /work/tmp/DIRECTORY',
    )
  result.outputDir = resolve(result.outputDir)
  if (!result.outputDir.startsWith('/work/tmp/'))
    throw createBenchmarkError('Verification output must be inside /work/tmp')
  if (Boolean(result.secondMachine) !== Boolean(result.secondFixtureParent))
    throw createBenchmarkError(
      '--second-machine and --second-fixture-parent must be supplied together',
    )
  result.appUrl = `${result.appUrl.replace(/\/+$/, '')}/`
  result.serverUrl = `${result.serverUrl.replace(/\/+$/, '')}/`
  return result
}

async function api(path, body) {
  const response = await fetch(new URL(path, options.serverUrl), {
    method: body ? 'POST' : 'GET',
    headers: {
      Origin: new URL(options.appUrl).origin,
      'Content-Type': 'application/json',
      'x-client-instance': instanceId,
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  if (!response.ok)
    throw createBenchmarkError(`${path} returned HTTP ${response.status}: ${await response.text()}`)
  return response.json()
}

async function dispatch(command) {
  return api('orchestration/commands', {
    ...command,
    commandId: `navigation-proof-${randomUUID()}`,
  })
}

async function startMachineEvents() {
  const response = await fetch(new URL('machines/events', options.serverUrl), {
    headers: {
      Origin: new URL(options.appUrl).origin,
      'x-client-instance': instanceId,
    },
    signal: machineEvents.signal,
  })
  if (!response.ok) throw createBenchmarkError(`Machine events returned HTTP ${response.status}`)
  drainMachineEvents = response.body.pipeTo(new WritableStream()).then(
    () => recordMachineEventsFailure('Machine events ended before verification cleanup'),
    (error) => recordMachineEventsFailure(error.message),
  )
}

function recordMachineEventsFailure(error) {
  if (machineEvents.signal.aborted) return
  report.cases.push({ name: 'machine events lifetime', status: 'failed', error })
}

async function verifyConfiguredApp() {
  const browser = await chromium.launch({ headless: true })
  try {
    const page = await browser.newPage()
    const response = page.waitForResponse(
      (item) => item.url().split('?')[0].endsWith('/health') && item.status() === 200,
      { timeout: 20_000 },
    )
    await page.goto(options.appUrl)
    const health = await (await response).json()
    expect(health.environmentId).toBe(report.prerequisites.server.environmentId)
    report.prerequisites.appEnvironmentId = health.environmentId
    report.prerequisites.appAssets = await page
      .locator('script[src]')
      .evaluateAll((scripts) => scripts.map((script) => script.src))
  } finally {
    await browser.close()
  }
}

async function createFixture(health) {
  const directory = mkdtempSync('/work/tmp/platform-navigation-')
  const rootPath = relative(health.workspaceRoot, directory).split(sep).join('/')
  if (rootPath.startsWith('..'))
    throw createBenchmarkError('The server workspace does not contain /work/tmp')
  const record = { directory, rootPath, sessionIds: [], projectId: null }
  fixture = record
  execFileSync('git', ['init', '--quiet', '-b', 'main'], { cwd: directory })
  execFileSync(
    'git',
    [
      'remote',
      'add',
      'origin',
      `https://example.invalid/navigation-proof/${basename(directory)}.git`,
    ],
    { cwd: directory },
  )
  for (const name of ['a.ts', 'b.ts', 'c.ts', 'delayed.ts'])
    writeFileSync(
      join(directory, name),
      `export const ${name.split('.')[0]} = 'navigation proof';\n`,
    )
  const workspace = await api('fs/workspace-address', { path: rootPath })
  const providers = await api('providers')
  const provider = providers.providers.find(
    (candidate) => candidate.enabled && candidate.installed && candidate.models?.length,
  )
  if (!provider)
    throw createBenchmarkError(
      'No installed provider model is available for metadata-only session fixtures',
    )
  const registration = await dispatch({
    type: 'project.create',
    workspaceRoot: rootPath,
    title: `Navigation proof ${basename(directory)}`,
    defaultModelSelection: null,
  })
  if (!registration.result?.projectId || !registration.result?.worktreeId)
    throw createBenchmarkError('Project registration omitted its identity')
  record.projectId = registration.result.projectId
  record.worktreeId = registration.result.worktreeId
  record.workspace = `${workspace.name}.${workspace.id}`
  record.mainTitle = `Navigation proof main ${randomUUID().slice(0, 8)}`
  record.sidebarTitle = `Navigation proof sidebar ${randomUUID().slice(0, 8)}`
  record.archivedTitle = `Navigation proof archived ${randomUUID().slice(0, 8)}`
  for (const title of [record.mainTitle, record.sidebarTitle, record.archivedTitle]) {
    const sessionId = randomUUID()
    await dispatch({
      type: 'session.create',
      sessionId,
      title,
      worktreeTarget: { kind: 'current', worktreeId: record.worktreeId },
      modelSelection: {
        providerInstanceId: provider.providerInstanceId,
        model: provider.models[0].slug,
      },
      runtimeMode: 'approval-required',
      interactionMode: 'default',
    })
    record.sessionIds.push(sessionId)
  }
  await dispatch({ type: 'session.archive', sessionId: record.sessionIds[2] })
  report.prerequisites.fixture = {
    rootPath,
    workspace: record.workspace,
    projectId: record.projectId,
    worktreeId: record.worktreeId,
    sessionIds: record.sessionIds,
    providerInstanceId: provider.providerInstanceId,
  }
  return record
}

async function cleanupFixture(record) {
  for (const sessionId of record.sessionIds)
    await cleanupCommand({ type: 'session.delete', sessionId })
  if (record.projectId)
    await cleanupCommand({ type: 'project.delete', projectId: record.projectId, force: false })
  rmSync(record.directory, { recursive: true, force: true })
  report.cleanup.push({ directory: record.directory, status: 'removed' })
}

async function cleanupCommand(command) {
  try {
    await dispatch(command)
    report.cleanup.push({ ...command, status: 'removed' })
  } catch (error) {
    report.cleanup.push({ ...command, status: 'failed', error: error.message })
    report.cases.push({ name: 'fixture cleanup', status: 'failed', error: error.message })
  }
}

async function createSecondFixture() {
  const machinePath = `machines/${encodeURIComponent(options.secondMachine)}`
  const connection = await api(`${machinePath}/connect`, {})
  if (connection.phase !== 'live')
    throw createBenchmarkError(`Second machine did not connect: ${connection.phase}`)
  const endpoint = `${machinePath}/proxy/`
  const health = await api(`${endpoint}health`)
  expect(health.environmentId).not.toBe(report.prerequisites.server.environmentId)
  const directory = join(options.secondFixtureParent, `navigation-proof-${randomUUID()}`)
  const rootPath = relative(health.workspaceRoot, directory).split(sep).join('/')
  if (rootPath.startsWith('..'))
    throw createBenchmarkError('The second fixture must be inside its server workspace')
  const record = { machinePath, endpoint, health, directory, rootPath }
  secondFixture = record
  await api(`${endpoint}fs/create-folder`, { path: rootPath, recursive: true })
  await api(`${endpoint}fs/create-file`, {
    path: `${rootPath}/remote.ts`,
    content: "export const remote = 'second environment navigation proof';\n",
  })
  const workspace = await api(`${endpoint}fs/workspace-address`, { path: rootPath })
  const settings = await api('settings')
  record.label =
    settings.values['environments.machines'][options.secondMachine].label ?? options.secondMachine
  record.workspace = `${workspace.name}.${workspace.id}`
  report.prerequisites.secondEnvironment = record
  return record
}

async function cleanupSecondFixture(record) {
  try {
    await api(`${record.endpoint}fs/delete`, { path: record.rootPath, recursive: true })
    report.cleanup.push({ directory: record.directory, status: 'removed' })
  } catch (error) {
    report.cases.push({ name: 'second fixture cleanup', status: 'failed', error: error.message })
  } finally {
    await api(`${record.machinePath}/disconnect`, {}).catch((error) => {
      report.cases.push({ name: 'second machine cleanup', status: 'failed', error: error.message })
    })
  }
}

async function verifyBrowser(name) {
  const type = browsers[name]
  const endpoint = name === 'webkit' ? options.webkitEndpoint : null
  if (!type || (!endpoint && !existsSync(type.executablePath()))) {
    report.cases.push({
      browser: name,
      name: 'browser executable',
      status: 'failed',
      error: 'Configured browser is unavailable',
    })
    return
  }
  const browser = endpoint ? await type.connect(endpoint) : await type.launch({ headless: true })
  try {
    await runCase(browser, name, 'native history flush control', nativeHistoryControl, false)
    if (options.historyOnly) return
    await runCase(browser, name, 'running app identity', verifyAppIdentity, false)
    await runCase(
      browser,
      name,
      'folderless settings deep link category Back Forward and close',
      folderlessSettings,
      false,
    )
    await runCase(browser, name, 'file chat Back Forward', fileChatHistory)
    await runCase(
      browser,
      name,
      'sidebar utility changes stay outside file chat history',
      sidebarUtilityHistory,
    )
    await runCase(
      browser,
      name,
      'clean open tabs and reordered collection survive Back Forward',
      cleanTabHistory,
      false,
    )
    await runCase(
      browser,
      name,
      'explicitly closed tabs stay closed until destination revisit',
      closedTabHistory,
      false,
    )
    await runCase(browser, name, 'successive closed editors reopen in order', reopenClosedEditors)
    await runCase(
      browser,
      name,
      'file selection reveals a closed chat editor tool',
      revealChatEditor,
    )
    await runCase(browser, name, 'archived rail row and palette selections', archivedSelection)
    await runCase(
      browser,
      name,
      'automatic chat diff scope pins the visible session',
      automaticDiffScope,
      false,
    )
    await runCase(
      browser,
      name,
      'invalid cached root clears and bare startup stays folderless',
      invalidCachedRoot,
      false,
    )
    await runCase(browser, name, 'rapid completed selections', rapidSelections)
    await runCase(browser, name, 'paused and sustained filter replacements', filterHistory)
    await runCase(browser, name, 'reload before filter URL publication', earlyFilterReload, false)
    await runCase(
      browser,
      name,
      'search glob edits persist across file traversal',
      searchGlobFilters,
    )
    await runCase(browser, name, 'delayed file application loses to Back', delayedApplication)
    await runCase(browser, name, 'tab order traversal reload and additive startup', tabOrder)
    await runCase(
      browser,
      name,
      'dirty tabs survive addressed collection traversal',
      dirtyTabs,
      false,
    )
    await runCase(
      browser,
      name,
      'reached address persists after Back and bare startup',
      reachedPersistence,
    )
    await runCase(
      browser,
      name,
      'sidebar conversations stay navigable after utility switches',
      sidebarHistory,
    )
    await runCase(
      browser,
      name,
      'incidental sidebar selection survives file traversal',
      incidentalSidebarHistory,
    )
    await runCase(browser, name, 'immediate copy matches current view', copyCurrentView)
    if (secondFixture)
      await runCase(browser, name, 'second configured environment', secondEnvironment, false)
    else
      report.cases.push({
        browser: name,
        name: 'second configured environment',
        status: 'unverified',
        reason:
          'Supply --second-machine and --second-fixture-parent to verify a configured machine.',
      })
  } finally {
    await browser.close()
  }
}

async function runCase(browser, browserName, name, verify, initialize = true) {
  if (options.caseFilter && !options.caseFilter.split(',').some((filter) => name.includes(filter)))
    return
  const context = await browser.newContext({ viewport: { width: 1440, height: 960 } })
  if (browserName === 'chromium')
    await context.grantPermissions(['clipboard-read', 'clipboard-write'], {
      origin: new URL(options.appUrl).origin,
    })
  const page = await context.newPage()
  page.setDefaultTimeout(15_000)
  const entry = { browser: browserName, name, status: 'pending', reached: [], errors: [] }
  page.on('pageerror', (error) => entry.errors.push(error.message))
  const record = async (label) => {
    const position = await historyPosition(page)
    entry.reached.push({
      label,
      href: page.url(),
      historyLength: position.length,
      historyIndex: position.index,
      tabs: await visibleTabs(page),
    })
  }
  try {
    if (initialize) await openInitial(page)
    await verify({ page, context, record, entry })
    entry.status = 'passed'
  } catch (error) {
    entry.status = 'failed'
    entry.error = error.message
    const file = `${browserName}-${name.replaceAll(/[^a-z0-9]+/gi, '-')}`
    await page
      .screenshot({ path: join(options.outputDir, `${file}.png`), fullPage: true })
      .catch(() => {})
    entry.body = (
      await page
        .locator('body')
        .innerText()
        .catch(() => '')
    ).slice(0, 6000)
    entry.href = page.url()
  } finally {
    report.cases.push(entry)
    writeFileSync(join(options.outputDir, 'results.json'), JSON.stringify(report, null, 2))
    process.stdout.write(`${browserName}: ${name}: ${entry.status}\n`)
    await context.close()
  }
}

async function nativeHistoryControl({ page, entry }) {
  const require = createRequire(import.meta.resolve('@tanstack/react-router'))
  const historyFile = require
    .resolve('@tanstack/history')
    .replace('/cjs/index.cjs', '/esm/index.js')
  const source = readFileSync(historyFile, 'utf8')
  const href = new URL('__history_control', options.appUrl).href
  await page.route(href, (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: '<!doctype html><title>History control</title>',
    }),
  )
  await page.goto(href)
  entry.control = await page.evaluate(
    async ({ source, href }) => {
      const moduleUrl = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }))
      const module = await import(moduleUrl)
      URL.revokeObjectURL(moduleUrl)
      const control = module.createBrowserHistory()
      window.navigationHistoryControl = control
      const initial = history.length
      control.push(`${href}?step=A`)
      control.flush()
      control.push(`${href}?step=B`)
      control.flush()
      return { initial, length: history.length }
    },
    { source, href },
  )
  expect(entry.control.length).toBe(entry.control.initial + 2)
  await page.evaluate(() => window.navigationHistoryControl.back())
  await page.waitForURL('**?step=A')
  entry.control.reachedA = page.url()
  await page.evaluate(() => window.navigationHistoryControl.forward())
  await page.waitForURL('**?step=B')
  entry.control.reachedB = page.url()
  await page.evaluate(() => window.navigationHistoryControl.destroy())
}

async function secondEnvironment({ page, record, entry }) {
  await page.addInitScript((name) => {
    localStorage.setItem('platform.environments.connected.v1', JSON.stringify([name]))
  }, options.secondMachine)
  await openInitial(page)
  await palette(page, '> Switch machine', 'Switch machine')
  const picker = page.getByRole('dialog', { name: 'Switch machine', exact: true })
  await expect(picker.getByRole('button').filter({ hasText: secondFixture.label })).toBeEnabled({
    timeout: 25_000,
  })
  await page.keyboard.press('Escape')
  await expect(picker).toHaveCount(0)
  const remoteHref = new URL(
    `@${secondFixture.health.environmentId}/~${secondFixture.workspace}/workbench/f/remote.ts?tabs=@`,
    options.appUrl,
  ).href
  await page.goto(remoteHref)
  await expectFile(page, 'remote.ts', 25_000)
  await dirtyCurrentFile(page, 'unsaved remote environment proof')
  await record('remote B has an unsaved document')
  await switchMachine(page, report.prerequisites.server.label)
  await expectFile(page, 'a.ts')
  await dirtyCurrentFile(page, 'unsaved primary environment proof')
  await record('primary A has an independent unsaved document')
  await switchMachine(page, secondFixture.label)
  await expectRetainedFile(page, 'remote.ts', 'unsaved remote environment proof')
  await expect(fileTab(page, 'a.ts')).toHaveCount(0)
  await record('return to B retains its dirty buffer and isolates A tabs')
  await page.goBack()
  await expectRetainedFile(page, 'a.ts', 'unsaved primary environment proof')
  await expect(fileTab(page, 'remote.ts')).toHaveCount(0)
  await record('Back A retains its dirty buffer')
  await page.goForward()
  await expectRetainedFile(page, 'remote.ts', 'unsaved remote environment proof')
  await record('Forward B remains available with its dirty buffer')
  await switchMachine(page, report.prerequisites.server.label)
  await expectRetainedFile(page, 'a.ts', 'unsaved primary environment proof')
  await delayedEnvironmentApplication(page, record)
  expect(entry.errors).toEqual([])
}

async function switchMachine(page, label) {
  await palette(page, '> Switch machine', 'Switch machine')
  const picker = page.getByRole('dialog', { name: 'Switch machine', exact: true })
  await picker.getByRole('button').filter({ hasText: label }).click()
  await expect(picker).toHaveCount(0)
}

async function dirtyCurrentFile(page, marker) {
  const editor = page.locator('.editor-virtualized').first()
  await editor.click()
  await page.keyboard.press('Control+End')
  await page.keyboard.insertText(`\n// ${marker}`)
  await expect(editor).toContainText(marker)
}

async function expectRetainedFile(page, name, marker) {
  await expectFile(page, name)
  await expect(page.locator('.editor-virtualized').first()).toContainText(marker)
}

async function delayedEnvironmentApplication(page, record) {
  const gate = Promise.withResolvers()
  let observed = false
  await page.route('**/fs/read?**', async (route) => {
    if (!new URL(route.request().url()).searchParams.get('path')?.endsWith('/delayed.ts'))
      return route.continue()
    observed = true
    await gate.promise
    await route.continue().catch(() => {})
  })
  try {
    await palette(page, 'delayed.ts', 'delayed.ts')
    await expect.poll(() => observed).toBe(true)
    await switchMachine(page, secondFixture.label)
    await expectRetainedFile(page, 'remote.ts', 'unsaved remote environment proof')
    gate.resolve()
    await page.waitForTimeout(400)
    await expectRetainedFile(page, 'remote.ts', 'unsaved remote environment proof')
    await expect(fileTab(page, 'delayed.ts')).toHaveCount(0)
    await record('late A file completion cannot replace the active B environment')
    await page.goBack()
    await expectFile(page, 'delayed.ts')
    await page.goBack()
    await expectRetainedFile(page, 'a.ts', 'unsaved primary environment proof')
    await page.goForward()
    await expectFile(page, 'delayed.ts')
    await page.goForward()
    await expectRetainedFile(page, 'remote.ts', 'unsaved remote environment proof')
    await record('cross-environment Back and Forward survive the superseded A operation')
  } finally {
    gate.resolve()
  }
}

async function verifyAppIdentity({ page, entry }) {
  const response = page.waitForResponse(
    (item) => item.url().split('?')[0].endsWith('/health') && item.status() === 200,
  )
  await page.goto(options.appUrl)
  const health = await (await response).json()
  expect(health.environmentId).toBe(report.prerequisites.server.environmentId)
  entry.environmentId = health.environmentId
}

async function folderlessSettings({ page, record, entry }) {
  const settings = page.getByRole('dialog', { name: 'Settings', exact: true })
  const clearCategory = settings.getByRole('button', {
    name: 'Clear the Machines filter and show every setting',
    exact: true,
  })
  await page.goto(new URL('~-/workbench/settings?settings=machines', options.appUrl).href)
  await expect(settings).toBeVisible()
  await expect(settings.getByRole('tab', { name: 'Workspace', exact: true })).toBeDisabled()
  await expect.poll(() => new URL(page.url()).searchParams.get('settings')).toBe('machines')
  await expect(clearCategory).toBeVisible()
  await expect(
    settings.getByRole('heading', { level: 2, name: 'Machines', exact: true }),
  ).toBeVisible()
  await expect(
    settings.getByRole('heading', { level: 2, name: 'Appearance', exact: true }),
  ).toHaveCount(0)
  entry.screenshot = join(options.outputDir, `${entry.browser}-folderless-settings.png`)
  await settings.screenshot({ path: entry.screenshot })
  await record('folderless Machines deep link')
  const initialLength = await page.evaluate(() => history.length)

  await clearCategory.click()
  await expect.poll(() => new URL(page.url()).searchParams.get('settings')).toBeNull()
  await expect(clearCategory).toHaveCount(0)
  await expect(
    settings.getByRole('heading', { level: 2, name: 'Appearance', exact: true }),
  ).toBeVisible()
  expect(await page.evaluate(() => history.length)).toBe(initialLength)
  await record('category clear replaces')

  await settings.getByRole('button', { name: 'Close', exact: true }).click()
  await expect(settings).toHaveCount(0)
  await expect
    .poll(() => new URL(page.url()).pathname)
    .toBe(new URL('~-/workbench', options.appUrl).pathname)
  expect(await page.evaluate(() => history.length)).toBe(initialLength + 1)
  await record('close removes settings destination and modal')

  await page.goBack()
  await expect(settings).toBeVisible()
  await expect(page).toHaveURL(/\/~-\/workbench\/settings(?:[?#]|$)/)
  await expect(clearCategory).toHaveCount(0)
  await record('Back restores settings with cleared category')
  await page.goForward()
  await expect(settings).toHaveCount(0)
  await record('Forward restores closed folderless workbench')

  await palette(page, '> Settings', 'Settings')
  await expect(settings).toBeVisible()
  await expect(page).toHaveURL(/\/~-\/workbench\/settings(?:[?#]|$)/)
  await expect(
    settings.getByRole('textbox', { name: 'Search settings', exact: true }),
  ).toBeFocused()
  expect(await page.evaluate(() => history.length)).toBe(initialLength + 2)
  await record('trusted Settings command opens addressed folderless dialog')
  await settings.getByRole('button', { name: 'Close', exact: true }).click()
  await expect(settings).toHaveCount(0)
  await expect
    .poll(() => new URL(page.url()).pathname)
    .toBe(new URL('~-/workbench', options.appUrl).pathname)
  await record('command-opened settings closes')
  expect(entry.errors).toEqual([])
}

function address(suffix = '/workbench/f/a.ts', query = '?tabs=@~f/b.ts~f/c.ts') {
  return new URL(`~${fixture.workspace}${suffix}${query}`, options.appUrl).href
}

async function openInitial(page, query) {
  await page.goto(address('/workbench/f/a.ts', query))
  await expectFile(page, 'a.ts', 25_000)
}

async function automaticDiffScope({ page, record, entry }) {
  await page.goto(address('/chat', '?tool=git'))
  const scopes = page.getByRole('group', { name: 'Diff scope', exact: true })
  const workingTree = scopes.getByRole('button', { name: 'Working tree', exact: true })
  await expect(scopes).toBeVisible()
  await expect(workingTree).toHaveAttribute('aria-pressed', 'true')
  await expect(scopes.getByRole('button', { name: 'Turn', exact: true })).toBeDisabled()
  await expect(page).toHaveURL(/\/chat(?:[?#]|$)/)
  const initialLength = await page.evaluate(() => history.length)
  await record('automatic session visible before an explicit scope action')
  await workingTree.click()
  await expect(page).toHaveURL(new RegExp(`/chat/t/${fixture.sessionIds[1]}(?:[?#]|$)`))
  await expect(workingTree).toHaveAttribute('aria-pressed', 'true')
  expect(await page.evaluate(() => history.length)).toBe(initialLength)
  await record('working-tree scope pins the newest active session and replaces history')
  await page.reload()
  await expect(scopes).toBeVisible()
  await expect(workingTree).toHaveAttribute('aria-pressed', 'true')
  await expect(page).toHaveURL(new RegExp(`/chat/t/${fixture.sessionIds[1]}(?:[?#]|$)`))
  entry.turnScope = 'Unavailable in metadata-only fixtures; Turn remains disabled.'
  await record('pinned session and working-tree scope survive reload')
  expect(entry.errors).toEqual([])
}

async function invalidCachedRoot({ page, record, entry }) {
  const directory = mkdtempSync(join(fixture.directory, 'invalid-cache-'))
  const rootPath = relative(report.prerequisites.server.workspaceRoot, directory)
    .split(sep)
    .join('/')
  const fileName = 'cached.ts'
  writeFileSync(join(directory, fileName), 'export const cached = true;\n')
  const workspace = await api('fs/workspace-address', { path: rootPath })
  const href = new URL(
    `~${workspace.name}.${workspace.id}/workbench/f/${fileName}?tabs=@`,
    options.appUrl,
  ).href
  try {
    await page.goto(href)
    await expectFile(page, fileName)
    await expect.poll(() => cachedRoot(page)).toMatchObject({ path: rootPath })
    await record('valid workspace persisted before its directory disappears')
    const unloaded = new URL(`__navigation_cache_unloaded/${randomUUID()}`, options.appUrl).href
    await page.route(unloaded, (route) =>
      route.fulfill({
        contentType: 'text/html',
        body: '<!doctype html><title>Workspace cache unload</title>',
      }),
    )
    await page.goto(unloaded)
    rmSync(directory, { recursive: true, force: true })
    await page.goto(options.appUrl)
    const chooseFolder = page.getByRole('button', { name: 'Choose folder', exact: true })
    await expect(chooseFolder).toBeVisible()
    await expect(fileTab(page, fileName)).toHaveCount(0)
    await expect.poll(() => cachedRoot(page)).toBeNull()
    await expect
      .poll(() => page.evaluate(() => localStorage.getItem('platform.address.v2')))
      .toContain('/~-/')
    await record('missing cached root clears the active workspace and persisted destination')
    await chooseFolder.click()
    await expect(page.getByRole('dialog')).toBeVisible()
    await page.keyboard.press('Escape')
    await page.goto(options.appUrl)
    await expect(chooseFolder).toBeVisible()
    await expect(page).toHaveURL(/\/~-\/workbench(?:[?#]|$)/)
    await expect.poll(() => cachedRoot(page)).toBeNull()
    await expect(fileTab(page, fileName)).toHaveCount(0)
    await record('subsequent bare startup keeps the folderless fallback')
    expect(entry.errors).toEqual([])
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
}

function cachedRoot(page) {
  return page.evaluate((environmentId) => {
    const key = Object.keys(localStorage).find(
      (key) =>
        key.startsWith(`env:${environmentId}|platform.workspace-state.v`) &&
        key.endsWith('.rootFolder'),
    )
    return key ? JSON.parse(localStorage.getItem(key)).folder : null
  }, report.prerequisites.server.environmentId)
}

function fileTab(page, name) {
  return page.locator(`[data-editor-tab-path$="/${name}"]`)
}

async function expectFile(page, name, timeout = 5_000) {
  await expect(fileTab(page, name)).toHaveAttribute('aria-selected', 'true', { timeout })
  await expect(fileTab(page, name)).not.toHaveAttribute('data-editor-tab-loading', 'true', {
    timeout,
  })
  await expect(page).toHaveURL(new RegExp(`/workbench/f/${name.replace('.', '\\.')}(?:[?#]|$)`))
}

async function visibleTabs(page) {
  return page
    .locator('[data-editor-tab-path]')
    .evaluateAll((tabs) =>
      tabs.map((tab) => tab.getAttribute('data-editor-tab-path').split('/').at(-1)),
    )
}

async function historyPosition(page) {
  const position = await page.evaluate(() => ({
    length: history.length,
    index: history.state?.__TSR_index,
  }))
  expect(Number.isInteger(position.index)).toBe(true)
  return position
}

async function selectFile(page, name) {
  const tab = fileTab(page, name)
  if (await tab.count()) await tab.click()
  else await palette(page, name, name)
  await expectFile(page, name)
}

async function palette(page, query, label) {
  await page.keyboard.press(query.startsWith('>') ? 'ControlOrMeta+Shift+p' : 'ControlOrMeta+p')
  await page.locator('[cmdk-input]').fill(query)
  await page.locator('[cmdk-item]').filter({ hasText: label }).first().click()
}

async function selectMainChat(page) {
  await palette(page, `sess ${fixture.mainTitle}`, fixture.mainTitle)
  await expect(page).toHaveURL(new RegExp(`/chat/t/${fixture.sessionIds[0]}(?:[?#]|$)`))
  await expect(page.locator(`[title="${fixture.mainTitle}"][aria-current="true"]`)).toBeVisible()
}

async function fileChatHistory({ page, record }) {
  const tabs = await visibleTabs(page)
  await record('A')
  await selectFile(page, 'b.ts')
  await record('B')
  await selectMainChat(page)
  await record('main C')
  await page.goBack()
  await expectFile(page, 'b.ts')
  expect(await visibleTabs(page)).toEqual(tabs)
  await record('Back B')
  await page.goBack()
  await expectFile(page, 'a.ts')
  expect(await visibleTabs(page)).toEqual(tabs)
  await record('Back A')
  await page.goForward()
  await expectFile(page, 'b.ts')
  expect(await visibleTabs(page)).toEqual(tabs)
  await page.goForward()
  await expect(page).toHaveURL(new RegExp(`/chat/t/${fixture.sessionIds[0]}(?:[?#]|$)`))
  await record('Forward C')
}

async function sidebarUtilityHistory({ page, record }) {
  const sidebar = page.getByRole('navigation', { name: 'Sidebar tabs', exact: true })
  const initial = await historyPosition(page)
  for (const label of ['Git', 'Search', 'Logs', 'Chat', 'Files']) {
    const tab = sidebar.getByRole('button', { name: label, exact: true })
    await tab.click()
    await expect(tab).toHaveAttribute('aria-pressed', 'true')
    expect(await historyPosition(page)).toEqual(initial)
  }
  await palette(page, '> Toggle sidebar', 'Toggle sidebar')
  await expect(sidebar).toHaveCount(0)
  expect(await historyPosition(page)).toEqual(initial)
  await palette(page, '> Toggle sidebar', 'Toggle sidebar')
  await expect(sidebar).toBeVisible()
  expect(await historyPosition(page)).toEqual(initial)
  await record('sidebar selection and visibility leave history untouched')

  await selectFile(page, 'b.ts')
  const filePosition = await historyPosition(page)
  await sidebar.getByRole('button', { name: 'Search', exact: true }).click()
  const search = page.getByRole('searchbox', { name: 'Search workspace' })
  await search.fill('navigation proof')
  await expect(page).toHaveURL(/s.q=navigation/)
  expect(await historyPosition(page)).toEqual(filePosition)
  const tabs = await visibleTabs(page)
  await selectMainChat(page)
  const chatPosition = await historyPosition(page)
  const sessions = page.getByRole('button', { name: 'Toggle sessions', exact: true })
  await expect(sessions).toHaveAttribute('aria-pressed', 'true')
  await sessions.click()
  await expect(sessions).toHaveAttribute('aria-pressed', 'false')
  expect(await historyPosition(page)).toEqual(chatPosition)

  for (const name of ['b.ts', 'a.ts']) {
    await page.goBack()
    await expectFile(page, name)
    await expect(sidebar.getByRole('button', { name: 'Search', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    await expect(search).toHaveValue('navigation proof')
    expect(await visibleTabs(page)).toEqual(tabs)
    await record(`Back ${name} preserves the current sidebar and open tabs`)
  }
  await page.goForward()
  await expectFile(page, 'b.ts')
  await expect(search).toHaveValue('navigation proof')
  await page.goForward()
  await expect(page).toHaveURL(new RegExp(`/chat/t/${fixture.sessionIds[0]}(?:[?#]|$)`))
  await expect(sessions).toHaveAttribute('aria-pressed', 'false')
  await record('Forward restores the chat without reopening its session rail')
}

async function cleanTabHistory({ page, record }) {
  await openInitial(page, '?tabs=@')
  await selectFile(page, 'b.ts')
  await selectFile(page, 'c.ts')
  const beforeReorder = await historyPosition(page)
  await moveTabBefore(page, 'c.ts', 'a.ts')
  const tabs = ['c.ts', 'a.ts', 'b.ts']
  expect(await historyPosition(page)).toEqual(beforeReorder)
  for (const name of ['b.ts', 'a.ts']) {
    await page.goBack()
    await expectFile(page, name)
    expect(await visibleTabs(page)).toEqual(tabs)
    await record(`Back ${name} keeps every clean tab in current order`)
  }
  for (const name of ['b.ts', 'c.ts']) {
    await page.goForward()
    await expectFile(page, name)
    expect(await visibleTabs(page)).toEqual(tabs)
  }
  await selectMainChat(page)
  await page.goBack()
  await expectFile(page, 'c.ts')
  expect(await visibleTabs(page)).toEqual(tabs)
  await page.goForward()
  await expect(page).toHaveURL(new RegExp(`/chat/t/${fixture.sessionIds[0]}(?:[?#]|$)`))
  await page.goBack()
  await expectFile(page, 'c.ts')
  expect(await visibleTabs(page)).toEqual(tabs)
  await record('file and chat traversal keeps the reordered clean tab collection')
}

async function closedTabHistory({ page, record }) {
  await openInitial(page, '?tabs=@')
  await selectFile(page, 'c.ts')
  await selectFile(page, 'b.ts')
  await selectFile(page, 'a.ts')
  const beforeClose = await historyPosition(page)
  await closeFile(page, 'c.ts')
  expect(await historyPosition(page)).toEqual(beforeClose)
  expect(await visibleTabs(page)).toEqual(['a.ts', 'b.ts'])
  await page.goBack()
  await expectFile(page, 'b.ts')
  expect(await visibleTabs(page)).toEqual(['a.ts', 'b.ts'])
  await record('Back B leaves explicitly closed C closed despite its historical tab list')
  await page.goBack()
  await expectFile(page, 'c.ts')
  expect(await visibleTabs(page)).toEqual(['a.ts', 'b.ts', 'c.ts'])
  await record('Back explicitly reaching C reopens that destination at the end')
  await page.goBack()
  await expectFile(page, 'a.ts')
  expect(await visibleTabs(page)).toEqual(['a.ts', 'b.ts', 'c.ts'])
  for (const name of ['c.ts', 'b.ts', 'a.ts']) {
    await page.goForward()
    await expectFile(page, name)
    expect(await visibleTabs(page)).toEqual(['a.ts', 'b.ts', 'c.ts'])
  }
  await record('Forward preserves the reopened tab and current order')
}

async function closeFile(page, name) {
  const tab = fileTab(page, name)
  await tab.hover()
  const title = await tab.getAttribute('title')
  await tab.getByRole('button', { name: `Close ${title}`, exact: true }).click()
  await expect(tab).toHaveCount(0)
}

async function reopenClosedEditors({ page, record }) {
  for (const name of ['c.ts', 'b.ts']) {
    await closeFile(page, name)
  }
  await expectFile(page, 'a.ts')
  const initialLength = await page.evaluate(() => history.length)
  for (const name of ['b.ts', 'c.ts']) {
    await palette(page, '> Reopen closed editor', 'Reopen closed editor')
    await expectFile(page, name)
    await record(`reopened ${name}`)
  }
  expect(await visibleTabs(page)).toEqual(['a.ts', 'b.ts', 'c.ts'])
  expect(await page.evaluate(() => history.length)).toBe(initialLength + 2)
  await palette(page, '> Reopen closed editor', 'Reopen closed editor')
  await expectFile(page, 'c.ts')
  expect(await page.evaluate(() => history.length)).toBe(initialLength + 2)
  await record('empty closed-editor history leaves the current destination unchanged')
}

async function revealChatEditor({ page, record }) {
  await selectMainChat(page)
  const editorTool = page
    .getByRole('navigation', { name: 'Tool tabs', exact: true })
    .getByRole('button', { name: 'Editor', exact: true })
  await editorTool.click()
  await expect(editorTool).toHaveAttribute('aria-pressed', 'true')
  await editorTool.click()
  await expect(editorTool).toHaveAttribute('aria-pressed', 'false')
  await expect(fileTab(page, 'a.ts')).toHaveCount(0)
  const initialLength = await page.evaluate(() => history.length)
  await palette(page, 'b.ts', 'b.ts')
  await expect(editorTool).toHaveAttribute('aria-pressed', 'true')
  await expect(fileTab(page, 'b.ts')).toHaveAttribute('aria-selected', 'true')
  await expect.poll(() => new URL(page.url()).searchParams.get('editor')).toBe('f/b.ts')
  await expect(page).toHaveURL(new RegExp(`/chat/t/${fixture.sessionIds[0]}(?:[?#]|$)`))
  expect(await page.evaluate(() => history.length)).toBe(initialLength + 1)
  await record('opening B reveals the closed editor tool')

  await editorTool.click()
  await expect(editorTool).toHaveAttribute('aria-pressed', 'false')
  await palette(page, 'b.ts', 'b.ts')
  await expect(editorTool).toHaveAttribute('aria-pressed', 'true')
  await expect(fileTab(page, 'b.ts')).toHaveAttribute('aria-selected', 'true')
  expect(await page.evaluate(() => history.length)).toBe(initialLength + 1)
  await record('opening the same B destination reveals the editor without another history entry')

  await palette(page, `sess ${fixture.sidebarTitle}`, fixture.sidebarTitle)
  await expect(page).toHaveURL(new RegExp(`/chat/t/${fixture.sessionIds[1]}(?:[?#]|$)`))
  const toolTabs = page.getByRole('navigation', { name: 'Tool tabs', exact: true })
  const logsTool = toolTabs.getByRole('button', { name: 'Logs', exact: true })
  const beforeLogs = await historyPosition(page)
  await logsTool.click()
  await expect(logsTool).toHaveAttribute('aria-pressed', 'true')
  expect(await historyPosition(page)).toEqual(beforeLogs)
  await page.goBack()
  await expect(editorTool).toHaveAttribute('aria-pressed', 'true')
  await expect(fileTab(page, 'b.ts')).toHaveAttribute('aria-selected', 'true')
  expect(await visibleTabs(page)).toEqual(['a.ts', 'b.ts', 'c.ts'])
  await record('Back to an explicit file visit reveals its editor after selecting Logs')
  await logsTool.click()
  await expect(logsTool).toHaveAttribute('aria-pressed', 'true')
  await page.goBack()
  await expect(page).toHaveURL(new RegExp(`/chat/t/${fixture.sessionIds[0]}(?:[?#]|$)`))
  await expect(logsTool).toHaveAttribute('aria-pressed', 'true')
  await record('Back to a main conversation keeps Logs instead of replaying an incidental editor')
  await page.goForward()
  await expect(editorTool).toHaveAttribute('aria-pressed', 'true')
  await expect(fileTab(page, 'b.ts')).toHaveAttribute('aria-selected', 'true')
  await logsTool.click()
  await expect(logsTool).toHaveAttribute('aria-pressed', 'true')
  await page.goForward()
  await expect(page).toHaveURL(new RegExp(`/chat/t/${fixture.sessionIds[1]}(?:[?#]|$)`))
  await expect(logsTool).toHaveAttribute('aria-pressed', 'true')
  await record('Forward distinguishes explicit file destinations from incidental editor snapshots')
}

async function archivedSelection({ page, record }) {
  await selectMainChat(page)
  const archivedToggle = page.getByRole('button', { name: 'Archived sessions', exact: true })
  const archivedSession = page.locator(`[title="${fixture.archivedTitle}"]`)
  await archivedToggle.click()
  await expect(archivedToggle).toHaveAttribute('aria-pressed', 'true')
  await expect(archivedSession).toBeVisible()
  await archivedSession.click()
  await expect(page).toHaveURL(new RegExp(`/chat/t/${fixture.sessionIds[2]}(?:[?#]|$)`))
  await expect(archivedSession).toHaveAttribute('aria-current', 'true')
  await expect(archivedToggle).toHaveAttribute('aria-pressed', 'true')
  await expect.poll(() => new URL(page.url()).searchParams.get('rail')).toBe('archived')
  await record('archived row selection retains its rail')

  await page.goBack()
  await expect(page).toHaveURL(new RegExp(`/chat/t/${fixture.sessionIds[0]}(?:[?#]|$)`))
  await expect(archivedToggle).toHaveAttribute('aria-pressed', 'true')
  await palette(page, `sess ${fixture.sidebarTitle}`, fixture.sidebarTitle)
  await expect(page).toHaveURL(new RegExp(`/chat/t/${fixture.sessionIds[1]}(?:[?#]|$)`))
  await expect(archivedToggle).toHaveAttribute('aria-pressed', 'true')
  await expect.poll(() => new URL(page.url()).searchParams.get('rail')).toBe('archived')
  await record('palette session selection retains the archived rail')
}

async function rapidSelections({ page, record, entry }) {
  for (const name of ['b.ts', 'c.ts', 'a.ts']) await selectFile(page, name)
  entry.completedIntervalsMs = await page.evaluate(async () => {
    async function waitForSelection(tab, name) {
      const deadline = performance.now() + 15_000
      while (performance.now() < deadline) {
        const selected = tab.getAttribute('aria-selected') === 'true'
        const ready = tab.getAttribute('data-editor-tab-loading') !== 'true'
        if (selected && ready && location.pathname.endsWith(`/f/${name}`)) return
        await new Promise((resolve) => requestAnimationFrame(resolve))
      }
    }
    const intervals = []
    for (const name of ['b.ts', 'c.ts', 'a.ts']) {
      const tab = document.querySelector(`[data-editor-tab-path$="/${name}"]`)
      const started = performance.now()
      tab.click()
      await waitForSelection(tab, name)
      intervals.push(performance.now() - started)
    }
    return intervals
  })
  expect(entry.completedIntervalsMs.every((elapsed) => elapsed < 250)).toBe(true)
  for (const name of ['c.ts', 'b.ts', 'a.ts']) {
    await page.goBack()
    await expectFile(page, name)
    await record(`rapid Back ${name}`)
  }
}

async function filterHistory({ page, record, entry }) {
  await selectFile(page, 'b.ts')
  const initial = await historyPosition(page)
  await page.getByRole('button', { name: 'Search', exact: true }).click()
  const search = page.getByRole('searchbox', { name: 'Search workspace' })
  await search.pressSequentially('hello', { delay: 180 })
  await expect(search).toHaveValue('hello')
  await expect(page).toHaveURL(/s.q=hello/)
  expect(await historyPosition(page)).toEqual(initial)
  await page.goBack()
  await expectFile(page, 'a.ts')
  await expect(search).toHaveValue('hello')
  await record('Back skips search prefixes and preserves the current query')
  await page.goForward()
  await expectFile(page, 'b.ts')
  await page.getByRole('button', { name: 'Logs', exact: true }).click()
  const logs = page.getByRole('textbox', { name: 'Search logs' })
  await logs.pressSequentially('hello', { delay: 180 })
  await expect(page).toHaveURL(/log.find=hello/)
  await logs.fill('')
  await logs.pressSequentially('x'.repeat(140), { delay: 5 })
  await expect(logs).toHaveValue('x'.repeat(140))
  await expect.poll(() => new URL(page.url()).searchParams.get('log.find')).toBe('x'.repeat(140))
  expect(await historyPosition(page)).toEqual(initial)
  await page.goBack()
  await expectFile(page, 'a.ts')
  await expect(logs).toHaveValue('x'.repeat(140))
  await record('Back skips log prefixes and preserves the current log filter')
  expect(entry.errors).toEqual([])
}

async function earlyFilterReload({ page, record, entry }) {
  await page.goto(address('/workbench/f/a.ts', '?tabs=@&side=logs&log.find=before-reload'))
  await expectFile(page, 'a.ts')
  const input = page.getByRole('textbox', { name: 'Search logs' })
  await expect(input).toHaveValue('before-reload')
  await input.evaluate((element) => {
    element.addEventListener(
      'input',
      () => {
        window.navigationProofInputAt = performance.now()
      },
      { once: true },
    )
  })
  const query = `reload-proof-${randomUUID()}`
  await input.fill(query)
  const [, attempt] = await Promise.all([
    page.waitForNavigation({ waitUntil: 'domcontentloaded' }),
    page.evaluate(() => {
      const attempt = {
        href: location.href,
        historyState: history.state,
        savedAddress: localStorage.getItem('platform.address.v2'),
        pendingPublication: sessionStorage.getItem('platform.navigation.pending'),
        elapsedMs: performance.now() - window.navigationProofInputAt,
      }
      location.reload()
      return attempt
    }),
  ])
  entry.reloadAttempt = attempt
  expect(attempt.elapsedMs).toBeLessThan(250)
  expect(new URL(attempt.href).searchParams.get('log.find')).toBe('before-reload')
  expect(attempt.savedAddress).toContain(query)
  await expectFile(page, 'a.ts')
  entry.reloadResult = await page.evaluate(() => ({
    href: location.href,
    historyState: history.state,
    pendingPublication: sessionStorage.getItem('platform.navigation.pending'),
  }))
  await expect(input).toHaveValue(query)
  await expect.poll(() => new URL(page.url()).searchParams.get('log.find')).toBe(query)
  await record('real reload preserves the accepted filter before its scheduled URL write')
  expect(entry.errors).toEqual([])
}

async function searchGlobFilters({ page, record }) {
  await page.getByRole('button', { name: 'Search', exact: true }).click()
  await page.getByRole('searchbox', { name: 'Search workspace' }).fill('navigation proof')
  const results = page.getByRole('tree', { name: 'Search results', exact: true })
  const resultA = results.getByRole('button', { name: 'a.ts a.ts', exact: true })
  const resultB = results.getByRole('button', { name: 'b.ts b.ts', exact: true })
  const toggle = page.getByRole('button', { name: 'Include and exclude files', exact: true })
  const include = page.getByRole('textbox', { name: 'Include', exact: true })
  const exclude = page.getByRole('textbox', { name: 'Exclude', exact: true })
  await expect(resultB).toBeVisible()
  const initial = await historyPosition(page)
  await toggle.click()
  await expect(toggle).toHaveAttribute('aria-pressed', 'true')
  await expect(include).toBeVisible()
  await page.getByRole('button', { name: 'Match case', exact: true }).click()
  await expect.poll(() => new URL(page.url()).searchParams.get('s.case')).toBe('1')
  await expect(include).toHaveValue('')
  await expect(toggle).toHaveAttribute('aria-pressed', 'true')
  await record('blank glob controls survive another search option change')
  await include.fill('*.ts')
  await exclude.fill('b.ts')
  await expect.poll(() => new URL(page.url()).searchParams.get('s.in')).toBe('*.ts')
  await expect.poll(() => new URL(page.url()).searchParams.get('s.x')).toBe('b.ts')
  await expect(resultB).toHaveCount(0)
  await expect(resultA).toBeVisible()
  expect(await historyPosition(page)).toEqual(initial)
  await record('A filtered to TypeScript excluding B')

  await selectFile(page, 'b.ts')
  await toggle.click()
  await expect(toggle).toHaveAttribute('aria-pressed', 'false')
  await expect(include).toHaveCount(0)
  await expect.poll(() => new URL(page.url()).searchParams.get('s.in')).toBeNull()
  await expect.poll(() => new URL(page.url()).searchParams.get('s.x')).toBeNull()
  await expect(resultB).toBeVisible()
  expect(await historyPosition(page)).toEqual({
    index: initial.index + 1,
    length: initial.length + 1,
  })
  await record('hiding B filters replaces and search includes B')

  await selectFile(page, 'c.ts')
  await expect(toggle).toHaveAttribute('aria-pressed', 'false')
  await page.goBack()
  await expectFile(page, 'b.ts')
  await expect(toggle).toHaveAttribute('aria-pressed', 'false')
  await expect.poll(() => new URL(page.url()).searchParams.get('s.in')).toBeNull()
  await expect(resultB).toBeVisible()
  await record('Back B keeps hidden filters disabled')
  await page.goBack()
  await expectFile(page, 'a.ts')
  await expect(toggle).toHaveAttribute('aria-pressed', 'false')
  await expect(include).toHaveCount(0)
  await expect.poll(() => new URL(page.url()).searchParams.get('s.in')).toBeNull()
  await expect(resultB).toBeVisible()
  await record('Back A preserves the current hidden filters instead of restoring old globs')

  await page.goForward()
  await expectFile(page, 'b.ts')
  await expect(toggle).toHaveAttribute('aria-pressed', 'false')
  const beforeReopen = await historyPosition(page)
  await toggle.click()
  await expect(include).toHaveValue('*.ts')
  await expect(exclude).toHaveValue('b.ts')
  await expect.poll(() => new URL(page.url()).searchParams.get('s.in')).toBe('*.ts')
  await expect.poll(() => new URL(page.url()).searchParams.get('s.x')).toBe('b.ts')
  await expect(resultB).toHaveCount(0)
  expect(await historyPosition(page)).toEqual(beforeReopen)
  await record('reopening B restores local glob drafts')
}

async function delayedApplication({ page, record }) {
  await selectFile(page, 'b.ts')
  let release
  let started
  const gate = new Promise((resolve) => {
    release = resolve
  })
  const observed = new Promise((resolve) => {
    started = resolve
  })
  await page.route('**/fs/read?**', async (route) => {
    if (!new URL(route.request().url()).searchParams.get('path')?.endsWith('/delayed.ts'))
      return route.continue()
    started()
    await gate
    await route.continue().catch(() => {})
  })
  try {
    await palette(page, 'delayed.ts', 'delayed.ts')
    await Promise.race([
      observed,
      new Promise((_, reject) =>
        setTimeout(
          () => reject(createBenchmarkError('No delayed file request was observed')),
          10_000,
        ),
      ),
    ])
    await page.goBack()
    await expectFile(page, 'b.ts')
    release()
    await page.waitForTimeout(400)
    await expectFile(page, 'b.ts')
    await page.goForward()
    await expectFile(page, 'delayed.ts')
    await record('Forward survives abandoned delayed apply')
  } finally {
    release()
  }
}

async function tabOrder({ page, record }) {
  await moveTabBefore(page, 'c.ts', 'a.ts')
  await selectFile(page, 'b.ts')
  await page.goBack()
  await expectFile(page, 'a.ts')
  await expect.poll(() => visibleTabs(page)).toEqual(['c.ts', 'a.ts', 'b.ts'])
  await page.reload()
  await expectFile(page, 'a.ts')
  await expect.poll(() => visibleTabs(page)).toEqual(['c.ts', 'a.ts', 'b.ts'])
  await page.goto(address('/workbench/f/a.ts', '?tabs=f/b.ts~@'))
  await expectFile(page, 'a.ts')
  await expect.poll(() => visibleTabs(page)).toEqual(['c.ts', 'a.ts', 'b.ts'])
  await record('additive boot retains cached order')
}

async function moveTabBefore(page, name, before) {
  const source = await fileTab(page, name).boundingBox()
  const target = await fileTab(page, before).boundingBox()
  if (!source || !target) throw createBenchmarkError('Tab drag targets are not visible')
  await page.mouse.move(source.x + source.width / 2, source.y + source.height / 2)
  await page.mouse.down()
  await page.mouse.move(target.x + 8, target.y + target.height / 2, { steps: 12 })
  await page.mouse.up()
  await expect.poll(() => visibleTabs(page)).toEqual(['c.ts', 'a.ts', 'b.ts'])
  // dnd-kit suppresses clicks for 50ms after releasing a pointer drag.
  await page.waitForTimeout(60)
}

async function dirtyTabs({ page, record, entry }) {
  await page.addInitScript(() => {
    window.navigationProofTraversals = []
    addEventListener('popstate', () => window.navigationProofTraversals.push(location.href))
  })
  await page.goto(address('/workbench/f/a.ts', '?tabs=@'))
  await expectFile(page, 'a.ts')
  await selectFile(page, 'b.ts')
  expect(await visibleTabs(page)).toEqual(['a.ts', 'b.ts'])
  await selectFile(page, 'c.ts')
  const editor = page.locator('.editor-virtualized').first()
  await editor.click()
  await page.keyboard.press('Control+End')
  await page.keyboard.type('\n// unsaved navigation proof')
  await selectFile(page, 'a.ts')
  await page.goBack()
  await expectFile(page, 'c.ts')
  await page.goBack()
  await expectFile(page, 'b.ts')
  entry.traversedBeforeApply = await page.evaluate(() => window.navigationProofTraversals.at(-1))
  expect(new URL(entry.traversedBeforeApply).searchParams.get('tabs')).not.toContain('f/c.ts')
  await expect(fileTab(page, 'c.ts')).toBeVisible()
  await selectFile(page, 'c.ts')
  await expect(editor).toContainText('unsaved navigation proof')
  await record('dirty C retained outside addressed B collection')
}

async function reachedPersistence({ page, context, record, entry }) {
  await selectFile(page, 'b.ts')
  await page.goBack()
  await expectFile(page, 'a.ts')
  await record('reached A')
  await page.close()
  const reopened = await context.newPage()
  await reopened.goto(options.appUrl)
  await expectFile(reopened, 'a.ts')
  entry.reopenedHref = reopened.url()
}

async function sidebarHistory({ page, record }) {
  await selectFile(page, 'b.ts')
  await selectMainChat(page)
  await page.getByRole('button', { name: 'Workbench mode', exact: true }).click()
  await expectFile(page, 'b.ts')
  const initial = await historyPosition(page)
  await page.getByRole('button', { name: 'Chat', exact: true }).click()
  expect(await historyPosition(page)).toEqual(initial)
  await selectSidebarChat(page, fixture.mainTitle, fixture.sessionIds[0])
  const beforeSwitch = await historyPosition(page)
  await selectSidebarChat(page, fixture.sidebarTitle, fixture.sessionIds[1])
  await expectFile(page, 'b.ts')
  expect(await historyPosition(page)).toEqual({
    index: beforeSwitch.index + 1,
    length: beforeSwitch.length + 1,
  })
  await page.goBack()
  await expectFile(page, 'b.ts')
  await expectSidebarChat(page, fixture.mainTitle)
  await page.goBack()
  await expectFile(page, 'b.ts')
  await expectSidebarChat(page, fixture.mainTitle)
  await record('an earlier file entry without a sidebar chat keeps the current conversation')
  await page.goForward()
  await expectSidebarChat(page, fixture.mainTitle)
  await page.goForward()
  await expectSidebarChat(page, fixture.sidebarTitle)
  const afterSwitch = await historyPosition(page)
  const sidebar = page.getByRole('navigation', { name: 'Sidebar tabs', exact: true })
  const files = sidebar.getByRole('button', { name: 'Files', exact: true })
  await files.click()
  await expect(files).toHaveAttribute('aria-pressed', 'true')
  expect(await historyPosition(page)).toEqual(afterSwitch)
  await page.goBack()
  await expect.poll(() => historyPosition(page)).toMatchObject({ index: beforeSwitch.index })
  await expectSidebarChat(page, fixture.mainTitle)
  await page.goForward()
  await expect.poll(() => historyPosition(page)).toEqual(afterSwitch)
  await expectSidebarChat(page, fixture.sidebarTitle)
  expect(await historyPosition(page)).toEqual(afterSwitch)
  await record(
    'Back and Forward reveal explicit sidebar conversations after a Files utility switch',
  )
  await page.getByRole('button', { name: 'Chat mode', exact: true }).click()
  await expect(page).toHaveURL(new RegExp(`/chat/t/${fixture.sessionIds[0]}(?:[?#]|$)`))
  await expect(page.locator(`[title="${fixture.mainTitle}"][aria-current="true"]`)).toBeVisible()
  await record('sidebar chat is independent of remembered main chat')
}

async function incidentalSidebarHistory({ page, record }) {
  const sidebar = page.getByRole('navigation', { name: 'Sidebar tabs', exact: true })
  await sidebar.getByRole('button', { name: 'Chat', exact: true }).click()
  await selectSidebarChat(page, fixture.mainTitle, fixture.sessionIds[0])
  await selectFile(page, 'b.ts')
  const filePosition = await historyPosition(page)
  expect(new URL(page.url()).searchParams.get('chat')).toBe(`t/${fixture.sessionIds[0]}`)
  await selectSidebarChat(page, fixture.sidebarTitle, fixture.sessionIds[1])
  const afterSwitch = await historyPosition(page)
  const files = sidebar.getByRole('button', { name: 'Files', exact: true })
  await files.click()
  await expect(files).toHaveAttribute('aria-pressed', 'true')
  expect(await historyPosition(page)).toEqual(afterSwitch)
  await page.goBack()
  await expectFile(page, 'b.ts')
  await expect.poll(() => historyPosition(page)).toMatchObject({ index: filePosition.index })
  await expect(files).toHaveAttribute('aria-pressed', 'true')
  await record('Back to a primary file keeps Files despite its incidental sidebar chat snapshot')
  await sidebar.getByRole('button', { name: 'Chat', exact: true }).click()
  await expectSidebarChat(page, fixture.sidebarTitle)
  expect(await historyPosition(page)).toEqual({
    index: filePosition.index,
    length: afterSwitch.length,
  })
  await record('revealing Chat confirms the current sidebar conversation survived file traversal')
  await page.goForward()
  await expectSidebarChat(page, fixture.sidebarTitle)
  await expect.poll(() => historyPosition(page)).toEqual(afterSwitch)
  await record('Forward still reaches the explicit sidebar conversation destination')
}

async function selectSidebarChat(page, title, sessionId) {
  await page.getByRole('button', { name: 'Conversation history', exact: true }).click()
  await page.getByRole('menuitem').filter({ hasText: title }).click()
  await expect.poll(() => new URL(page.url()).searchParams.get('chat')).toBe(`t/${sessionId}`)
  await expectSidebarChat(page, title)
}

async function expectSidebarChat(page, title) {
  const sidebar = page.getByRole('navigation', { name: 'Sidebar tabs', exact: true })
  await expect(sidebar.getByRole('button', { name: 'Chat', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  await expect(sidebar.locator('..').getByText(title, { exact: true })).toBeVisible()
}

async function copyCurrentView({ page, context, entry }) {
  await page.goto(address('/workbench/f/a.ts', '?tabs=@~f/b.ts&editorPerfTrace=1'))
  await expectFile(page, 'a.ts')
  await selectFile(page, 'b.ts')
  await page.getByRole('button', { name: 'Search', exact: true }).click()
  await page.getByRole('searchbox', { name: 'Search workspace' }).fill('copy-current')
  await palette(page, '> Copy address', 'Copy address')
  const copied = await readCopiedAddress(page, entry.browser)
  expect(new URL(copied).pathname).toContain('/workbench/f/b.ts')
  expect(new URL(copied).searchParams.get('s.q')).toBe('copy-current')
  expect(new URL(copied).searchParams.has('editorPerfTrace')).toBe(false)
  const opened = await context.newPage()
  await opened.goto(copied)
  await expectFile(opened, 'b.ts')
  await expect(opened.getByRole('searchbox', { name: 'Search workspace' })).toHaveValue(
    'copy-current',
  )
  entry.copiedHref = copied
}

async function readCopiedAddress(page, browserName) {
  if (browserName !== 'chromium') return pasteCopiedAddress(page)
  let copied = ''
  await expect
    .poll(async () => {
      copied = await page.evaluate(() => navigator.clipboard.readText())
      return isCurrentCopiedAddress(copied)
    })
    .toBe(true)
  return copied
}

function isCurrentCopiedAddress(copied) {
  if (!URL.canParse(copied)) return false
  const url = new URL(copied)
  return (
    url.origin === new URL(options.appUrl).origin &&
    url.pathname === new URL(address('/workbench/f/b.ts')).pathname &&
    url.searchParams.get('s.q') === 'copy-current'
  )
}

async function pasteCopiedAddress(page) {
  await page.evaluate(() => {
    const field = document.createElement('textarea')
    field.setAttribute('aria-label', 'Copied workspace address verification')
    document.body.append(field)
    field.focus()
  })
  const field = page.getByRole('textbox', { name: 'Copied workspace address verification' })
  try {
    await expect
      .poll(async () => {
        await field.fill('')
        await field.press('ControlOrMeta+v')
        return isCurrentCopiedAddress(await field.inputValue())
      })
      .toBe(true)
    return await field.inputValue()
  } finally {
    await field.evaluate((element) => element.remove())
  }
}
