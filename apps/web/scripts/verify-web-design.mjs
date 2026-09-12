import { randomUUID } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'
import { chromium, expect } from 'playwright/test'
import { createBenchmarkError } from './structured-errors.mjs'

const options = parseOptions(process.argv.slice(2))
const fixture = JSON.parse(readFileSync(options.fixture, 'utf8'))
const loadingPanes = [
  'files',
  'git',
  'logs',
  'search',
  'settings',
  'editor-document',
  'chat-sidebar',
  'chat-stage',
  'terminal',
  'problems',
  'file-picker',
  'model-picker',
  'settings-narrow',
]
const report = {
  startedAt: new Date().toISOString(),
  fixture: options.fixture,
  appUrl: fixture.appUrl,
  scope: {
    densities: options.densities,
    schemes: options.schemes,
    surfaces: !options.loadingOnly,
    loading: !options.surfacesOnly,
  },
  comparison: {
    historicalScreenshots:
      'Unavailable: recovered pre-Phase-1 images were blank and are not a baseline.',
    baselineBars: {
      titlebar: { compact: 40, cozy: 44 },
      editorStrip: { compact: 36, cozy: 40 },
      files: { compact: 36, cozy: 40 },
      git: { compact: 32, cozy: 36 },
      bottom: { compact: 32, cozy: 36 },
    },
    settledBars: { compact: 36, cozy: 40 },
    source: 'Plan 100 stored pre-migration census and current settled design tokens',
  },
  variants: [],
  cleanup: [],
}
mkdirSync(options.outputDir, { recursive: true })
let browser = null
let appearance = null

try {
  const health = await api('health')
  expect(health.environmentId).toBe(fixture.primaryEnvironmentId)
  appearance = await captureAppearance()
  browser = await chromium.launch({ headless: true })
  for (const density of options.densities) {
    for (const colorScheme of options.schemes) await verifyVariant(density, colorScheme)
  }
  expect(report.variants).toHaveLength(options.densities.length * options.schemes.length)
} catch (error) {
  report.error = error.message
} finally {
  if (browser)
    await browser
      .close()
      .catch((error) =>
        report.cleanup.push({ status: 'failed', resource: 'browser', error: error.message }),
      )
  if (appearance)
    await restoreAppearance().catch((error) => {
      report.cleanup.push({ status: 'failed', error: error.message })
    })
  report.finishedAt = new Date().toISOString()
  report.status =
    report.error ||
    report.cleanup.some((entry) => entry.status === 'failed') ||
    report.variants.some((entry) => entry.status === 'failed')
      ? 'failed'
      : 'passed'
  writeReport()
  writeGallery()
  process.stdout.write(`${report.status}: ${join(options.outputDir, 'results.json')}\n`)
  if (report.status === 'failed') process.exitCode = 1
}

function parseOptions(args) {
  const parsed = {
    fixture: null,
    outputDir: null,
    densities: ['compact', 'cozy'],
    schemes: ['light', 'dark'],
    surfacesOnly: false,
    loadingOnly: false,
  }
  for (let index = 0; index < args.length; index++) {
    const key = args[index]
    if (key === '--surfaces-only') {
      parsed.surfacesOnly = true
      continue
    }
    if (key === '--loading-only') {
      parsed.loadingOnly = true
      continue
    }
    const value = args[++index]
    if (key === '--fixture') parsed.fixture = resolve(value)
    if (key === '--output-dir') parsed.outputDir = resolve(value)
    if (key === '--densities') parsed.densities = value.split(',')
    if (key === '--schemes') parsed.schemes = value.split(',')
  }
  if (!parsed.fixture || !parsed.outputDir?.startsWith('/work/tmp/'))
    throw createBenchmarkError('Required: --fixture JSON --output-dir /work/tmp/DIRECTORY')
  if (parsed.densities.some((density) => !['compact', 'cozy'].includes(density)))
    throw createBenchmarkError('Density must be compact or cozy')
  if (parsed.schemes.some((scheme) => !['light', 'dark'].includes(scheme)))
    throw createBenchmarkError('Scheme must be light or dark')
  if (parsed.loadingOnly && parsed.surfacesOnly)
    throw createBenchmarkError('--loading-only and --surfaces-only cannot be combined')
  return parsed
}

async function api(path, body) {
  const response = await fetch(new URL(path, fixture.serverUrl), {
    method: body ? 'POST' : 'GET',
    headers: { Origin: fixture.origin, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(30_000),
  })
  if (!response.ok)
    throw createBenchmarkError(`${path}: HTTP ${response.status}: ${await response.text()}`)
  return response.json()
}

async function captureAppearance() {
  const snapshot = await api('settings')
  const target = 'user'
  const keys = ['workbench.density', 'workbench.colorTheme']
  const workspace = snapshot.layers.find((layer) => layer.id === 'workspace')
  if (keys.some((key) => workspace && Object.hasOwn(workspace.raw, key)))
    throw createBenchmarkError(
      'Workspace appearance overrides require a fixture-owned workspace settings target',
    )
  const raw = snapshot.layers.find((layer) => layer.id === target).raw
  const original = Object.fromEntries(
    keys.map((key) => [key, { present: Object.hasOwn(raw, key), value: raw[key] }]),
  )
  const result = { target, original, last: {}, pending: null }
  report.appearance = result
  return result
}

async function setAppearance(density, colorScheme) {
  const snapshot = await api('settings')
  const raw = snapshot.layers.find((layer) => layer.id === appearance.target).raw
  for (const [key, original] of Object.entries(appearance.original)) {
    const expected = Object.hasOwn(appearance.last, key)
      ? { present: true, value: appearance.last[key] }
      : original
    if (Object.hasOwn(raw, key) !== expected.present || raw[key] !== expected.value)
      throw createBenchmarkError(
        `Concurrent user change to ${key}; preserving it and stopping the visual matrix`,
      )
  }
  const values = { 'workbench.density': density, 'workbench.colorTheme': colorScheme }
  appearance.pending = values
  writeReport()
  await api('settings/write', {
    mutationId: randomUUID(),
    target: appearance.target,
    operations: Object.entries(values).map(([key, value]) => ({ kind: 'set', key, value })),
  })
  appearance.last = values
  appearance.pending = null
  writeReport()
}

async function restoreAppearance() {
  const snapshot = await api('settings')
  const raw = snapshot.layers.find((layer) => layer.id === appearance.target).raw
  const operations = Object.keys(appearance.original).flatMap((key) => restoreOperation(key, raw))
  if (operations.length)
    await api('settings/write', { mutationId: randomUUID(), target: appearance.target, operations })
  const restored = (await api('settings')).layers.find(
    (layer) => layer.id === appearance.target,
  ).raw
  for (const operation of operations) recordRestoredSetting(operation, restored)
}

function restoreOperation(key, raw) {
  const values = [appearance.last, appearance.pending].flatMap((candidate) =>
    candidate && Object.hasOwn(candidate, key) ? [candidate[key]] : [],
  )
  if (!values.length) return []
  if (!values.includes(raw[key])) {
    report.cleanup.push({ key, status: 'preserved concurrent change' })
    return []
  }
  const original = appearance.original[key]
  return original.present
    ? [{ kind: 'set', key, value: original.value }]
    : [{ kind: 'reset', keys: [key] }]
}

function recordRestoredSetting(operation, raw) {
  const key = operation.key ?? operation.keys[0]
  const original = appearance.original[key]
  expect(Object.hasOwn(raw, key)).toBe(original.present)
  if (original.present) expect(raw[key]).toBe(original.value)
  report.cleanup.push({ key, status: 'restored', original })
}

async function verifyVariant(density, colorScheme) {
  await setAppearance(density, colorScheme)
  const outputDir = join(options.outputDir, `${density}-${colorScheme}`)
  mkdirSync(outputDir, { recursive: true })
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, colorScheme })
  const page = await context.newPage()
  page.setDefaultTimeout(25_000)
  const entry = {
    density,
    colorScheme,
    status: 'pending',
    surfaces: [],
    errors: [],
    network: { navigations: [], failures: [], httpErrors: [] },
  }
  page.on('pageerror', (error) => entry.errors.push(error.message))
  page.on('request', (request) => {
    if (request.isNavigationRequest())
      entry.network.navigations.push({ at: Date.now(), url: request.url() })
  })
  page.on('requestfailed', (request) =>
    entry.network.failures.push({
      at: Date.now(),
      url: request.url(),
      failure: request.failure()?.errorText,
    }),
  )
  page.on('response', (response) => {
    if (response.status() >= 400 && response.url().startsWith(fixture.serverUrl))
      entry.network.httpErrors.push({
        at: Date.now(),
        url: response.url(),
        status: response.status(),
      })
  })
  const capture = (name, locator) => captureSurface(page, entry, outputDir, name, locator)
  try {
    await openWorkbench(page)
    entry.assets = await page
      .locator('script[src]')
      .evaluateAll((scripts) => scripts.map((script) => script.src))
    if (!options.loadingOnly) await verifySurfaces(page, capture)
    if (!options.surfacesOnly) {
      const { verifyDesignLoading } = await import('./verify-web-design-loading.mjs')
      entry.loading = await verifyDesignLoading({
        page,
        fixture,
        appUrl: fixture.appUrl,
        outputDir,
        density,
        colorScheme,
        capture,
      })
      expect(entry.loading.map((lane) => lane.name).toSorted()).toEqual(loadingPanes.toSorted())
      expect(
        entry.loading
          .filter((lane) => lane.status !== 'passed')
          .map((lane) => ({ name: lane.name, error: lane.error, headers: lane.headers })),
      ).toEqual([])
    }
    expect(entry.errors).toEqual([])
    expect(entry.network.httpErrors).toEqual([])
    entry.status = 'passed'
  } catch (error) {
    entry.status = 'failed'
    entry.error = error.message
    entry.body = (await page.locator('body').innerText()).slice(0, 8000)
    await page.screenshot({ path: join(outputDir, 'failure.png'), fullPage: true })
  } finally {
    entry.contextClosedAt = Date.now()
    report.variants.push(entry)
    process.stdout.write(`${density}/${colorScheme}: ${entry.status}\n`)
    await context.close().catch((error) => {
      entry.status = 'failed'
      entry.closeError = error.message
    })
    classifyNetworkFailures(entry)
    writeReport()
  }
}

function classifyNetworkFailures(entry) {
  for (const failure of entry.network.failures) {
    const atNavigation = entry.network.navigations.some(
      (navigation) => Math.abs(navigation.at - failure.at) < 2_000,
    )
    const atClose = Math.abs(entry.contextClosedAt - failure.at) < 2_000
    failure.classification =
      failure.failure === 'net::ERR_ABORTED' && (atNavigation || atClose)
        ? 'navigation or context-close cancellation'
        : 'unclassified network failure'
  }
}

function workbenchHref(side = 'files') {
  return new URL(
    `~${fixture.workspace}/workbench/f/alpha.ts?tabs=@~f/beta.ts&side=${side}&bottom=problems`,
    fixture.appUrl,
  ).href
}

async function openWorkbench(page) {
  await page.goto(workbenchHref())
  await expect(page.locator('[data-editor-tab-path$="/alpha.ts"]')).toHaveAttribute(
    'aria-selected',
    'true',
    { timeout: 25_000 },
  )
  await expect(page.locator('.editor-virtualized')).toContainText('design verification', {
    timeout: 25_000,
  })
}

async function verifySurfaces(page, capture) {
  for (const side of ['Files', 'Git', 'Search', 'Logs', 'Chat'])
    await verifySidebar(page, capture, side)
  await page
    .getByRole('navigation', { name: 'Sidebar tabs' })
    .getByRole('button', { name: 'Files', exact: true })
    .click()
  const bottom = page
    .locator('header')
    .filter({ has: page.getByRole('button', { name: 'Problems', exact: true }) })
  await capture('bottom-open', bottom)
  await page.goto(new URL(`~${fixture.workspace}/chat/t/${fixture.sessionId}`, fixture.appUrl).href)
  await expect(page.getByRole('navigation', { name: 'Session', exact: true })).toContainText(
    fixture.sessionTitle,
  )
  await capture(
    'chat-stage',
    page.getByRole('navigation', { name: 'Session', exact: true }).locator('..'),
  )
  await openWorkbench(page)
  await verifyFloatingSurfaces(page, capture)
  await page.goto(new URL(`~${fixture.workspace}/workbench/settings`, fixture.appUrl).href)
  const settings = page.locator('[class~="@container/settings"]')
  await expect(
    settings.getByRole('textbox', { name: 'Search settings', exact: true }),
  ).toBeVisible()
  await expect(settings.getByText('Interface density', { exact: true })).toBeVisible()
  await capture('settings', settings)
}

async function verifySidebar(page, capture, side) {
  const button = page
    .getByRole('navigation', { name: 'Sidebar tabs' })
    .getByRole('button', { name: side, exact: true })
  await button.click()
  await expect(button).toHaveAttribute('aria-pressed', 'true')
  if (side === 'Files')
    await expect(page.getByRole('treeitem', { name: 'alpha.ts', exact: true })).toBeVisible()
  if (side === 'Git')
    await expect(page.getByRole('textbox', { name: 'Commit message' })).toBeVisible()
  if (side === 'Search') {
    await page.getByRole('searchbox', { name: 'Search workspace' }).fill('design verification')
    await expect(page.getByRole('tree', { name: 'Search results', exact: true })).toContainText(
      'alpha.ts',
    )
  }
  if (side === 'Logs') {
    await expect(page.getByRole('textbox', { name: 'Search logs' })).toBeVisible()
    await expect(
      page
        .getByRole('button', { name: 'Expand log event', exact: true })
        .first()
        .or(page.getByText('No logs match the current filters.', { exact: true }))
        .first(),
    ).toBeVisible({ timeout: 25_000 })
    await expect(page.getByRole('status', { name: 'Loading logs', exact: true })).toHaveCount(0)
  }
  if (side === 'Chat')
    await expect(page.getByRole('textbox', { name: 'Message', exact: true })).toBeVisible()
  await capture(`sidebar-${side.toLowerCase()}`, page.locator('aside').first())
}

async function verifyFloatingSurfaces(page, capture) {
  await page.getByRole('button', { name: 'Switch project', exact: true }).click()
  await expect(page.getByRole('menuitem', { name: 'Open folder…', exact: true })).toBeVisible()
  await capture('dropdown', page.locator('[data-slot="dropdown-menu-content"]'))
  await page.keyboard.press('Escape')
  await page
    .getByRole('banner', { name: 'Window toolbar' })
    .click({ button: 'right', position: { x: 800, y: 18 } })
  await expect(page.locator('[data-slot="context-menu-content"]')).toBeVisible()
  await capture('context-menu', page.locator('[data-slot="context-menu-content"]'))
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: 'Switch project', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Open folder…', exact: true }).click()
  const picker = page.getByRole('dialog', { name: 'Choose folder', exact: true })
  await picker.getByRole('button', { name: basename(fixture.directory), exact: true }).click()
  await expect(picker.getByRole('listbox', { name: 'Folders and files' })).toContainText('docs')
  await expect(picker.getByRole('status', { name: 'Loading folder', exact: true })).toHaveCount(0)
  await capture('file-picker', picker)
  await picker.getByRole('button', { name: 'New folder', exact: true }).click()
  await expect(page.getByRole('textbox', { name: 'Folder name', exact: true })).toBeVisible()
  await capture('popover', page.locator('[data-slot="popover-content"]'))
  await page.keyboard.press('Escape')
  await picker.getByRole('button', { name: 'Refresh', exact: true }).hover()
  await expect(page.locator('[data-slot="tooltip-content"]')).toBeVisible()
  await capture('tooltip', page.locator('[data-slot="tooltip-content"]'))
  await page.mouse.move(20, 900)
  await picker.getByRole('button', { name: 'Cancel', exact: true }).click()
}

async function captureSurface(page, entry, outputDir, name, locator) {
  if (locator) await expect(locator).toBeVisible()
  await expect(page.locator('html')).toHaveAttribute('data-density', entry.density)
  await expect(page.locator('html')).toHaveClass(new RegExp(`\\b${entry.colorScheme}\\b`))
  await page.evaluate(() => document.fonts.ready)
  await settleAnimations(page)
  const metrics = await page.evaluate(measureDesign)
  const record = {
    name,
    href: page.url(),
    ...metrics,
    selected: locator ? await locator.boundingBox() : null,
  }
  entry.surfaces.push(record)
  const plain = await page.screenshot({ path: join(outputDir, `${name}.png`), fullPage: true })
  record.pixels = await page.evaluate(
    imageVariation,
    `data:image/png;base64,${plain.toString('base64')}`,
  )
  expect(record.pixels.uniqueColors).toBeGreaterThan(30)
  expect(record.pixels.nonDominantFraction).toBeGreaterThan(0.02)
  validateMetrics(record, entry.density)
  await page.evaluate(drawRulers, [...metrics.bars, ...metrics.contentHeaders])
  try {
    await page.screenshot({ path: join(outputDir, `${name}-rulers.png`), fullPage: true })
  } finally {
    await page
      .locator('[data-design-verification-rulers]')
      .evaluateAll((nodes) => nodes.forEach((node) => node.remove()))
  }
  process.stdout.write(`${entry.density}/${entry.colorScheme}: ${name}\n`)
  return record
}

function measureDesign() {
  const visible = (element) => {
    const box = element.getBoundingClientRect()
    return (
      box.width > 1 &&
      box.height > 1 &&
      box.bottom > 0 &&
      box.top < innerHeight &&
      box.right > 0 &&
      box.left < innerWidth &&
      getComputedStyle(element).visibility !== 'hidden'
    )
  }
  const describe = (element) => {
    const style = getComputedStyle(element)
    const box = element.getBoundingClientRect()
    return {
      tag: element.tagName,
      slot: element.getAttribute('data-slot'),
      label: element.getAttribute('aria-label') ?? element.textContent.trim().slice(0, 90),
      className: element.className,
      x: box.x,
      y: box.y,
      width: box.width,
      height: box.height,
      radius: [
        style.borderTopLeftRadius,
        style.borderTopRightRadius,
        style.borderBottomRightRadius,
        style.borderBottomLeftRadius,
      ],
      borderWidth: [
        style.borderTopWidth,
        style.borderRightWidth,
        style.borderBottomWidth,
        style.borderLeftWidth,
      ],
      borderColor: [
        style.borderTopColor,
        style.borderRightColor,
        style.borderBottomColor,
        style.borderLeftColor,
      ],
      background: style.backgroundColor,
      backgroundAlpha: colorAlpha(style.backgroundColor),
      opacity: style.opacity,
      backdropFilter: style.backdropFilter,
      shadow: style.boxShadow,
      fontSize: style.fontSize,
      columnGap: style.columnGap,
    }
  }
  function colorAlpha(color) {
    const canvas = new OffscreenCanvas(1, 1)
    const context = canvas.getContext('2d')
    context.fillStyle = color
    context.fillRect(0, 0, 1, 1)
    return context.getImageData(0, 0, 1, 1).data[3] / 255
  }
  const root = getComputedStyle(document.documentElement)
  const roots = [document]
  for (let index = 0; index < roots.length; index++) {
    roots.push(
      ...[...roots[index].querySelectorAll('*')].flatMap((element) =>
        element.shadowRoot ? [element.shadowRoot] : [],
      ),
    )
  }
  const treeRows = roots
    .flatMap((treeRoot) => [...treeRoot.querySelectorAll('button[data-type="item"]')])
    .filter(visible)
    .map(describe)
  const bars = [
    ...document.querySelectorAll(
      'header:not([class*="@max-3xl/settings"]), [role="tablist"][aria-label="Editor tabs"], [data-workbench-tool-pane-header], [class~="h-(--bar-height)"]',
    ),
  ]
    .filter(visible)
    .filter((element) => element.tagName !== 'BUTTON' && element.getAttribute('role') !== 'button')
    .map(describe)
  const contentHeaders = [
    ...document.querySelectorAll(
      'header[class*="@max-3xl/settings"], [data-slot="dialog-header"], [data-slot="dialog-footer"]',
    ),
  ]
    .filter(visible)
    .map(describe)
  const floating = [
    ...document.querySelectorAll(
      '[data-slot="dialog-content"], [data-slot="dropdown-menu-content"], [data-slot="context-menu-content"], [data-slot="popover-content"], [data-slot="tooltip-content"]',
    ),
  ]
    .filter(visible)
    .map(describe)
  const controls = [
    ...document.querySelectorAll(
      '[data-slot="button"], [data-slot="input"], [data-slot="select-trigger"], [data-slot="input-group"]',
    ),
  ]
    .filter(visible)
    .map(describe)
  const rail = document.querySelector('nav[aria-label="Sidebar tabs"]')
  return {
    density: document.documentElement.dataset.density,
    colorScheme: document.documentElement.className,
    tokens: {
      barHeight: root.getPropertyValue('--bar-height').trim(),
      radius: root.getPropertyValue('--radius').trim(),
      radiusMd: root.getPropertyValue('--radius-md').trim(),
      radiusLg: root.getPropertyValue('--radius-lg').trim(),
    },
    bars,
    contentHeaders,
    floating,
    controls,
    treeRows,
    rail: rail ? describe(rail) : null,
    bodyTextLength: document.body.innerText.length,
  }
}

function validateMetrics(record, density) {
  const height = density === 'compact' ? 36 : 40
  expect(record.bars.length).toBeGreaterThan(0)
  for (const bar of record.bars) {
    expect(bar.height, `${record.name}: bar ${bar.label}`).toBeCloseTo(height, 1)
    expect(bar.radius, `${record.name}: bar corners ${bar.label}`).toEqual([
      '0px',
      '0px',
      '0px',
      '0px',
    ])
    expect(
      bar.borderWidth.every((width) => width === '0px' || width === '1px'),
      `${record.name}: divider width ${bar.label}`,
    ).toBe(true)
    if (bar.label === 'Editor tabs')
      expect(bar.columnGap).toBe(density === 'compact' ? '4px' : '6px')
  }
  for (const row of record.treeRows)
    expect(row.radius, `${record.name}: file row ${row.label} corners`).toEqual([
      '0px',
      '0px',
      '0px',
      '0px',
    ])
  if (record.rail) expect(record.rail.width).toBeCloseTo(height, 1)
  for (const surface of record.floating) {
    expect(surface.opacity, `${record.name}: ${surface.slot} opacity`).toBe('1')
    expect(surface.backgroundAlpha, `${record.name}: ${surface.slot} background alpha`).toBe(1)
    expect(surface.backdropFilter, `${record.name}: ${surface.slot} backdrop`).toBe('none')
    expect(surface.radius, `${record.name}: ${surface.slot} corners`).toEqual([
      '10px',
      '10px',
      '10px',
      '10px',
    ])
  }
  for (const control of record.controls) {
    expect(control.radius, `${record.name}: ${control.slot} ${control.label} corners`).toEqual([
      '8px',
      '8px',
      '8px',
      '8px',
    ])
  }
}

async function settleAnimations(page) {
  await page.evaluate(async () => {
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
    const animations = document
      .getAnimations()
      .filter(
        (animation) =>
          animation.playState === 'running' &&
          Number.isFinite(animation.effect?.getComputedTiming().endTime),
      )
    await Promise.all(animations.map((animation) => animation.finished.catch(() => {})))
    await new Promise((resolve) => requestAnimationFrame(resolve))
  })
}

async function imageVariation(dataUrl) {
  const img = new Image()
  img.src = dataUrl
  await img.decode()
  const canvas = document.createElement('canvas')
  canvas.width = 144
  canvas.height = 100
  const context = canvas.getContext('2d')
  context.drawImage(img, 0, 0, canvas.width, canvas.height)
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data
  const colors = new Map()
  for (let index = 0; index < pixels.length; index += 4) {
    const key = `${pixels[index]},${pixels[index + 1]},${pixels[index + 2]}`
    colors.set(key, (colors.get(key) ?? 0) + 1)
  }
  return {
    width: img.width,
    height: img.height,
    uniqueColors: colors.size,
    nonDominantFraction: 1 - Math.max(...colors.values()) / (pixels.length / 4),
  }
}

function drawRulers(bars) {
  const root = document.createElement('div')
  root.setAttribute('data-design-verification-rulers', '')
  root.style.cssText =
    'position:fixed;inset:0;pointer-events:none;z-index:2147483647;font:11px monospace;color:#fff'
  for (const [index, bar] of bars.entries()) {
    const ruler = document.createElement('div')
    ruler.style.cssText = `position:absolute;left:${bar.x}px;top:${bar.y}px;width:${bar.width}px;height:${bar.height}px;box-sizing:border-box;border:1px solid #fc4;`
    const label = document.createElement('span')
    label.style.cssText = 'background:#000;padding:1px 3px;position:absolute;right:0;top:0'
    label.textContent = `${index + 1}: ${bar.height.toFixed(1)} px`
    ruler.append(label)
    root.append(ruler)
  }
  document.body.append(root)
}

function writeReport() {
  writeFileSync(join(options.outputDir, 'results.json'), JSON.stringify(report, null, 2))
}

function writeGallery() {
  const names = [
    ...new Set(
      report.variants.flatMap((variant) => variant.surfaces.map((surface) => surface.name)),
    ),
  ]
  const sections = names.map((name) => gallerySection(name)).join('\n')
  writeFileSync(
    join(options.outputDir, 'index.html'),
    `<!doctype html>
<html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Web design verification</title>
<style>body{margin:24px;font:14px system-ui;background:#eee;color:#222}header{position:sticky;top:0;background:#eee;padding:12px 0;z-index:1}h1{font-size:22px}h2{font-size:17px}section{margin:28px 0}.grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px}figure{margin:0}img{width:100%;border:1px solid #bbb}figcaption{margin:6px 0;font-variant-numeric:tabular-nums}a{color:inherit}@media(max-width:900px){.grid{grid-template-columns:repeat(2,minmax(0,1fr))}}</style>
<header><h1>Web design verification: ${report.status}</h1><p>Actual mesh UI at compact/cozy and light/dark. Rulers show measured bar heights. Historical pre-Phase-1 screenshots were blank; the stored census and current tokens are the comparison.</p><label><input id="rulers" type="checkbox"> Show measured rulers</label> · <a href="results.json">Full measurements</a></header>
${sections}
<script>document.querySelector('#rulers').onchange=(event)=>{for(const image of document.querySelectorAll('img[data-plain]')){image.src=event.target.checked?image.dataset.rulers:image.dataset.plain;image.parentElement.href=image.src}}</script></html>`,
  )
}

function gallerySection(name) {
  const figures = report.variants
    .flatMap((variant) => {
      const surface = variant.surfaces.find((candidate) => candidate.name === name)
      if (!surface) return []
      const prefix = `${variant.density}-${variant.colorScheme}/${name}`
      return [
        `<figure><figcaption>${variant.density} / ${variant.colorScheme}</figcaption><a href="${prefix}.png"><img loading="lazy" alt="${name}, ${variant.density}, ${variant.colorScheme}" src="${prefix}.png" data-plain="${prefix}.png" data-rulers="${prefix}-rulers.png"></a></figure>`,
      ]
    })
    .join('\n')
  return `<section><h2>${name}</h2><div class="grid">${figures}</div></section>`
}
