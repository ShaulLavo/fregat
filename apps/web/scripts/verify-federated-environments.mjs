import { randomUUID } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { createConnection } from 'node:net'
import { join, resolve } from 'node:path'
import { chromium, expect } from 'playwright/test'
import { createBenchmarkError } from './structured-errors.mjs'

const options = parseOptions(process.argv.slice(2))
const instance = `federation-${randomUUID()}`
const runId = randomUUID().slice(0, 8)
const projectTitle = `Federation proof ${runId}`
const report = {
  startedAt: new Date().toISOString(),
  options,
  checks: [],
  fixtures: [],
  cleanup: [],
}
const events = new AbortController()
let browser = null
let page = null
let remoteUrl = null
let connection = null
mkdirSync(options.outputDir, { recursive: true })

try {
  const primary = await api(options.serverUrl, 'health')
  await startEvents()
  connection = await connectMachine()
  remoteUrl = `${options.serverUrl.replace(/\/$/, '')}${connection.origin}/`
  const remote = await api(remoteUrl, 'health')
  expect(remote.environmentId).toBe(connection.descriptor.environmentId)
  expect(remote.environmentId).not.toBe(primary.environmentId)
  record('SSH proxy reports a distinct, confirmed environment', {
    primaryId: primary.environmentId,
    remoteId: remote.environmentId,
    forwardedPort: connection.localPort,
  })
  const localFixture = await registerFixture(options.serverUrl, options.primaryRoot, 'local')
  const remoteFixture = await registerFixture(remoteUrl, options.remoteRoot, 'remote')
  browser = await chromium.launch({
    headless: true,
    args: ['--enable-unsafe-webgpu', '--use-angle=swiftshader'],
  })
  const context = await browser.newContext({
    viewport: { width: 1500, height: 1000 },
  })
  page = await context.newPage()
  page.setDefaultTimeout(25_000)
  report.browserErrors = []
  page.on('pageerror', (error) => report.browserErrors.push(error.message))
  await page.goto(
    new URL(`~${localFixture.workspace}/workbench/f/federation.txt?tabs=@`, options.appUrl).href,
  )
  await expectFile(localFixture)
  report.browserAssets = await page
    .locator('script[src]')
    .evaluateAll((scripts) => scripts.map((script) => script.src))
  const documentLifetime = await page.evaluate(() => performance.timeOrigin)
  await machineAction('Connect machine')
  await palette(`sess ${localFixture.title}`, localFixture.title)
  await verifyRail(localFixture, remoteFixture)
  await verifyProjectPicker(remoteFixture)
  await api(options.serverUrl, `machines/${options.machine}/disconnect`, {})
  await verifyBuffers(localFixture, remoteFixture)
  await verifyTerminal(localFixture)
  await verifyTerminal(remoteFixture)
  await selectFixture(remoteFixture)
  await palette('>Show terminal', 'Show terminal')
  await expect(page.getByRole('region', { name: 'Terminal', exact: true })).toBeVisible()
  await machineAction('Disconnect machine')
  await expect(
    page.getByText(`${options.machineLabel} is unreachable.`, { exact: true }),
  ).toBeVisible()
  await expect(
    page.getByText('The terminal will reconnect when the machine is available.', { exact: true }),
  ).toBeVisible()
  await expect.poll(() => portOccupied(connection.localPort)).toBe(false)
  record('Disconnect marks the retained terminal unavailable and releases the SSH listener')
  await machineAction('Connect machine')
  await palette(`sess ${remoteFixture.title}`, remoteFixture.title)
  await expect(page.locator(`[title="${remoteFixture.title}"]`)).toBeVisible()
  await machineAction('Disconnect machine')
  await expect(page.locator(`[title="${remoteFixture.title}"]`)).toContainText(
    'Cached · machine unavailable',
  )
  const notice = page
    .locator('[role="status"][title]')
    .filter({ hasText: options.machineLabel })
    .locator('..')
  await expect(notice.getByRole('button', { name: 'Connect', exact: true })).toBeEnabled()
  await notice.getByRole('button', { name: 'Connect', exact: true }).click()
  await expect
    .poll(
      () =>
        api(remoteUrl, 'health').then(
          (health) => health.environmentId,
          () => null,
        ),
      { timeout: 90_000 },
    )
    .toBe(remote.environmentId)
  await selectFixture(localFixture)
  await expect(editor()).toContainText(`unsaved local ${runId}`)
  expect(await page.evaluate(() => performance.timeOrigin)).toBe(documentLifetime)
  const storageKeys = await page.evaluate(() => Object.keys(localStorage))
  expect(storageKeys.some((key) => key.startsWith(`env:${primary.environmentId}|`))).toBe(true)
  expect(storageKeys.some((key) => key.startsWith(`env:${remote.environmentId}|`))).toBe(true)
  record(
    'Browser reconnect keeps both environment namespaces and the unsaved local buffer without reloading',
  )
  await page.screenshot({
    path: join(options.outputDir, 'federation-passed.png'),
  })
} catch (error) {
  report.checks.push({
    name: 'live federation',
    status: 'failed',
    error: error.message,
  })
  if (page) await captureFailure()
} finally {
  await cleanup()
  report.finishedAt = new Date().toISOString()
  report.status = report.checks.some((check) => check.status === 'failed') ? 'failed' : 'passed'
  saveReport()
  process.stdout.write(`${report.status}: ${join(options.outputDir, 'results.json')}\n`)
  if (report.status === 'failed') process.exitCode = 1
}

function parseOptions(args) {
  const parsed = {}
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index]
    const value = args[index + 1]
    if (!key?.startsWith('--') || !value) throw createBenchmarkError('Every option needs a value')
    parsed[key.slice(2)] = value
  }
  for (const key of [
    'app-url',
    'server-url',
    'machine',
    'primary-root',
    'remote-root',
    'output-dir',
  ])
    if (!parsed[key]) throw createBenchmarkError(`Missing --${key}`)
  const outputDir = resolve(parsed['output-dir'])
  if (!outputDir.startsWith('/work/tmp/'))
    throw createBenchmarkError('Output must be inside /work/tmp')
  return {
    appUrl: `${parsed['app-url'].replace(/\/+$/, '')}/`,
    serverUrl: `${parsed['server-url'].replace(/\/+$/, '')}/`,
    machine: parsed.machine,
    machineLabel: parsed['machine-label'] ?? parsed.machine,
    primaryRoot: parsed['primary-root'],
    remoteRoot: parsed['remote-root'],
    outputDir,
  }
}

async function api(base, path, body) {
  const response = await fetch(new URL(path, base), {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      Origin: new URL(options.appUrl).origin,
      'Content-Type': 'application/json',
      'x-client-instance': instance,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(90_000),
  })
  if (!response.ok)
    throw createBenchmarkError(`${path} returned ${response.status}: ${await response.text()}`)
  return response.json()
}

async function startEvents() {
  const response = await fetch(new URL('machines/events', options.serverUrl), {
    headers: {
      Origin: new URL(options.appUrl).origin,
      'x-client-instance': instance,
    },
    signal: events.signal,
  })
  if (!response.ok) throw createBenchmarkError(`Machine events returned ${response.status}`)
  void response.text().catch(() => {})
}

async function connectMachine() {
  const state = await api(options.serverUrl, `machines/${options.machine}/connect`, {})
  if (state.phase !== 'live')
    throw createBenchmarkError(`SSH machine is ${state.phase}: ${state.lastError ?? ''}`)
  return state
}

async function dispatch(base, command) {
  return api(base, 'orchestration/commands', {
    ...command,
    commandId: `federation-proof-${randomUUID()}`,
  })
}

async function registerFixture(base, rootPath, side) {
  const record = { base, rootPath, side, projectId: null, sessionId: null }
  report.fixtures.push(record)
  const content = await api(
    base,
    `fs/read?path=${encodeURIComponent(`${rootPath}/federation.txt`)}`,
  )
  record.originalContent = content.content
  const address = await api(base, 'fs/workspace-address', { path: rootPath })
  const baseline = await api(base, 'orchestration/shell-snapshot')
  const registeredPath = baseline.worktrees.some((worktree) => worktree.path === address.path)
  if (registeredPath)
    throw createBenchmarkError(
      `The ${side} fixture is already registered; supply a disposable unregistered checkout`,
    )
  const registration = await dispatch(base, {
    type: 'project.create',
    workspaceRoot: rootPath,
    title: projectTitle,
    defaultModelSelection: null,
  })
  const projectId = registration.result?.projectId
  if (baseline.projects.some((project) => project.id === projectId))
    throw createBenchmarkError(
      `The ${side} fixture reused an existing project; it will not be deleted`,
    )
  record.projectId = projectId
  record.worktreeId = registration.result?.worktreeId
  if (!record.projectId || !record.worktreeId)
    throw createBenchmarkError('Fixture registration omitted identity')
  record.workspace = `${address.name}.${address.id}`
  const providers = await api(base, 'providers')
  const provider = providers.providers.find(
    (candidate) => candidate.enabled && candidate.installed && candidate.models?.length,
  )
  if (!provider) throw createBenchmarkError(`No installed provider model is available on ${side}`)
  record.sessionId = randomUUID()
  record.title = `Federation ${side} ${runId}`
  await dispatch(base, {
    type: 'session.create',
    sessionId: record.sessionId,
    title: record.title,
    worktreeTarget: { kind: 'current', worktreeId: record.worktreeId },
    modelSelection: {
      providerInstanceId: provider.providerInstanceId,
      model: provider.models[0].slug,
    },
    runtimeMode: 'approval-required',
    interactionMode: 'default',
  })
  return record
}

async function palette(query, label) {
  await page.keyboard.press(query.startsWith('>') ? 'Control+Shift+p' : 'Control+p')
  await page.locator('[cmdk-input]').fill(query)
  await page.locator('[cmdk-item]').filter({ hasText: label }).first().click()
}

async function machineAction(title) {
  await palette(`>${title}`, title)
  const dialog = page.getByRole('dialog', { name: title, exact: true })
  await dialog.getByRole('button').filter({ hasText: options.machineLabel }).click()
  await expect(dialog).not.toBeVisible({ timeout: 90_000 })
}

function editor() {
  return page.locator('.editor-virtualized').first()
}

async function expectFile(fixture) {
  await expect(
    page.locator(`[data-editor-tab-path="${fixture.rootPath}/federation.txt"]`),
  ).toHaveAttribute('aria-selected', 'true')
  await expect(editor()).toBeVisible()
}

async function selectFixture(fixture) {
  await palette(`sess ${fixture.title}`, fixture.title)
  await expect(page).toHaveURL(new RegExp(`/chat/t/${fixture.sessionId}(?:[?#]|$)`))
  await palette('federation.txt', 'federation.txt')
  await expectFile(fixture)
}

async function verifyRail(local, remote) {
  const localRow = page.locator(`[title="${local.title}"]`)
  const remoteRow = page.locator(`[title="${remote.title}"]`)
  await expect(localRow).toBeVisible()
  await expect(remoteRow).toBeVisible()
  expect(local.projectId).toBe(remote.projectId)
  const grouping = await page.evaluate(browserGroupedRows, {
    local: local.title,
    remote: remote.title,
  })
  expect(grouping).toEqual({ shared: true, headers: 1 })
  await page.getByRole('button', { name: 'Filter machines', exact: true }).click()
  await page.getByRole('menuitemradio').filter({ hasText: options.machineLabel }).click()
  await expect(remoteRow).toBeVisible()
  await expect(localRow).not.toBeVisible()
  await page.getByRole('button', { name: 'Filter machines', exact: true }).click()
  await page.getByRole('menuitemradio', { name: 'All machines', exact: true }).press('Enter')
  await expect(localRow).toBeVisible()
  record(
    'Both machine sessions share one repository group and the machine filter selects the owner',
  )
}

function browserGroupedRows({ local, remote }) {
  const selector = '[aria-roledescription="sortable project band"]'
  function groupFor(node) {
    if (!node) return null
    if (node.querySelector(selector)) return node
    return groupFor(node.parentElement)
  }
  const localGroup = groupFor(document.querySelector(`[title="${local}"]`)?.parentElement)
  const remoteGroup = groupFor(document.querySelector(`[title="${remote}"]`)?.parentElement)
  return {
    shared: localGroup !== null && localGroup === remoteGroup,
    headers: localGroup?.querySelectorAll(selector).length,
  }
}

async function appendText(value) {
  await editor().click()
  await page.keyboard.press('Control+End')
  await page.keyboard.type(`\n// ${value}`)
  await expect(editor()).toContainText(value)
}

async function verifyProjectPicker(fixture) {
  await page.getByRole('button', { name: 'Add project', exact: true }).click()
  const machineDialog = page.getByRole('dialog', {
    name: 'Add project',
    exact: true,
  })
  await machineDialog.getByRole('button').filter({ hasText: options.machineLabel }).click()
  const picker = page.getByRole('dialog', {
    name: 'Choose folder',
    exact: true,
  })
  await picker.getByRole('button', { name: 'Go to folder', exact: true }).click()
  await picker
    .getByRole('textbox', { name: 'Folder path', exact: true })
    .fill(`/${fixture.rootPath}`)
  const response = page.waitForResponse((item) => {
    const url = new URL(item.url())
    return (
      item.url().startsWith(fixture.base) &&
      url.pathname.endsWith('/fs/tree') &&
      url.searchParams.get('path') === fixture.rootPath &&
      item.ok()
    )
  })
  await picker.getByRole('textbox', { name: 'Folder path', exact: true }).press('Enter')
  const listing = await (await response).json()
  expect(listing.entries.some((entry) => entry.name === 'federation.txt')).toBe(true)
  await picker.getByRole('button', { name: 'Choose folder', exact: true }).click()
  await expect(picker).not.toBeVisible()
  await expect(page).toHaveURL(new RegExp(`/@[^/]+/~${fixture.workspace.replace('.', '\\.')}/`))
  record('Add project uses the selected machine filesystem and opens that machine workspace')
}

async function verifyBuffers(local, remote) {
  await selectFixture(local)
  await expectOriginalLines(local)
  await appendText(`unsaved local ${runId}`)
  await selectFixture(remote)
  await expectOriginalLines(remote)
  await expect(editor()).not.toContainText(`unsaved local ${runId}`)
  await appendText(`saved remote ${runId}`)
  await page.keyboard.press('Control+s')
  await expect
    .poll(async () => (await readFixture(remote)).content)
    .toContain(`saved remote ${runId}`)
  expect((await readFixture(local)).content).toBe(local.originalContent)
  await selectFixture(local)
  await expect(editor()).toContainText(`unsaved local ${runId}`)
  record('A dirty buffer survives A → B → A and saving B changes only B')
}

async function expectOriginalLines(fixture) {
  for (const line of fixture.originalContent.split('\n')) {
    if (!line.trim()) continue
    await expect(editor()).toContainText(line)
  }
}

async function readFixture(fixture) {
  return api(
    fixture.base,
    `fs/read?path=${encodeURIComponent(`${fixture.rootPath}/federation.txt`)}`,
  )
}

async function verifyTerminal(fixture) {
  await selectFixture(fixture)
  const socketUrl = new URL('terminal', fixture.base)
  socketUrl.protocol = socketUrl.protocol === 'https:' ? 'wss:' : 'ws:'
  socketUrl.searchParams.set('worktreeId', fixture.worktreeId)
  socketUrl.searchParams.set('terminalId', `federation-${runId}-${fixture.side}`)
  const marker = `terminal-${fixture.side}-${runId}`
  const result = await page.evaluate(browserTerminalProbe, {
    url: socketUrl.href,
    marker,
  })
  expect(result.reason).toBe('exit')
  expect(result.output).toMatch(new RegExp(`(?:^|\\r?\\n)${marker}(?:\\r?\\n|$)`))
  expect(result.output).toContain(fixture.rootPath)
  record(`Binary browser terminal on ${fixture.side} executes in its own checkout`, result)
}

async function browserTerminalProbe({ url, marker }) {
  const socket = new WebSocket(url)
  socket.binaryType = 'arraybuffer'
  const output = []
  const controls = []
  let complete
  const result = new Promise((resolve) => {
    complete = resolve
  })
  const timeout = setTimeout(() => finish('timeout'), 25_000)
  function finish(reason) {
    clearTimeout(timeout)
    socket.close()
    complete({ reason, output: output.join(''), controls })
  }
  function receive({ data }) {
    if (data instanceof ArrayBuffer) {
      output.push(new TextDecoder().decode(data))
      return
    }
    const message = JSON.parse(data)
    controls.push(message.type)
    if (message.type === 'ready')
      socket.send(new TextEncoder().encode(`printf '\\n%s\\n' '${marker}'; pwd; exit\r`))
    if (message.type === 'exit' || message.type === 'error') finish(message.type)
  }
  socket.addEventListener('message', receive)
  socket.addEventListener('error', () => finish('socket error'))
  return result
}

function portOccupied(port) {
  return new Promise((resolve) => {
    const socket = createConnection({ host: '127.0.0.1', port })
    socket.setTimeout(1000)
    socket.once('connect', () => {
      socket.destroy()
      resolve(true)
    })
    socket.once('error', () => resolve(false))
    socket.once('timeout', () => {
      socket.destroy()
      resolve(false)
    })
  })
}

function record(name, evidence = {}) {
  report.checks.push({ name, status: 'passed', ...evidence })
  saveReport()
  process.stdout.write(`passed: ${name}\n`)
}

function saveReport() {
  writeFileSync(join(options.outputDir, 'results.json'), JSON.stringify(report, null, 2))
}

async function captureFailure() {
  report.failure = { href: page.url() }
  report.failure.body = await page
    .locator('body')
    .innerText()
    .catch(() => '')
  await page.screenshot({ path: join(options.outputDir, 'failure.png') }).catch(() => {})
}

async function cleanup() {
  if (remoteUrl) await cleanupAction('restore cleanup connection', connectMachine)
  if (page && connection)
    await cleanupAction('disconnect browser connection', () => machineAction('Disconnect machine'))
  if (browser) await cleanupAction('close isolated browser', () => browser.close())
  for (const fixture of report.fixtures.toReversed()) await cleanupFixture(fixture)
  if (connection)
    await cleanupAction('disconnect script connection', () =>
      api(options.serverUrl, `machines/${options.machine}/disconnect`, {}),
    )
  events.abort()
}

async function cleanupFixture(fixture) {
  if (fixture.sessionId)
    await cleanupAction(`delete ${fixture.side} session`, () =>
      dispatch(fixture.base, {
        type: 'session.delete',
        sessionId: fixture.sessionId,
      }),
    )
  if (fixture.projectId)
    await cleanupAction(`delete ${fixture.side} project`, () =>
      dispatch(fixture.base, {
        type: 'project.delete',
        projectId: fixture.projectId,
        force: false,
      }),
    )
}

async function cleanupAction(name, action) {
  try {
    await action()
    report.cleanup.push({ name, status: 'passed' })
  } catch (error) {
    const failure = { name, status: 'failed', error: error.message }
    report.cleanup.push(failure)
    report.checks.push(failure)
  }
}
