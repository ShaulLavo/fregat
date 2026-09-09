import { createHash } from 'node:crypto'
import {
  copyFileSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
} from 'node:fs'
import { relative, resolve, sep } from 'node:path'

import {
  browserList,
  browserTypes,
  createWorkspaceContext,
  launchOptions,
  numberOption,
  percentile,
  round,
  traceUrl,
  workspaceCacheEntries,
} from './bench-workspace.mjs'
import { createBenchmarkError } from './structured-errors.mjs'

const defaultAppUrl = 'http://localhost:5173/'
const defaultServerUrl = process.env.VITE_SERVER_URL ?? 'http://localhost:3001'
const defaultFilePath = 'apps/web/src/features/editor/components/editor.tsx'
const platformRoot = resolve(import.meta.dirname, '../../..')
const defaultEditorRoot = resolve(platformRoot, '../Editor')
const defaultRootPath = platformRoot
const defaultCalibrationFile = resolve(
  import.meta.dirname,
  'editor-open-benchmark-calibration.json',
)
const benchmarkIdentityVersion = 2
const benchmarkColorScheme = 'dark'
const benchmarkViewport = { height: 900, width: 1440 }
const platformImplementationEntries = [
  'apps/web/index.html',
  'apps/web/package.json',
  'apps/web/public',
  'apps/web/scripts/bench-workspace.mjs',
  'apps/web/scripts/editor-open-benchmark.mjs',
  'apps/web/src',
  'apps/web/vite.config.ts',
  'bun.lock',
  'package.json',
  'packages/contracts/package.json',
  'packages/contracts/src',
  'packages/observability/package.json',
  'packages/observability/src',
  'packages/tree/package.json',
  'packages/tree/src',
  'packages/ui/package.json',
  'packages/ui/src',
]
const implementationManifestIgnoredDirectories = new Set([
  '.turbo',
  '__tests__',
  'bench',
  'coverage',
  'node_modules',
  'test',
  'tests',
])
const modes = ['miss', 'query-only', 'prepared-50', 'prepared-150', 'prepared-300']
const pipelineMarkNames = [
  'editor.authoritative_highlight_paint',
  'editor.authoritative_text_paint',
  'editor.cached_visible_paint',
  'editor.file_open.activation',
  'editor.file_open.buffer_built',
  'editor.file_open.file_read',
  'editor.worker.request',
]
const options = parseOptions(process.argv.slice(2))
const benchmarkIdentity = createBenchmarkIdentity(options)
const gateCalibrationEvidence =
  options.gate && !options.calibrate
    ? readCalibrationEvidence(options.calibrationFile, benchmarkIdentity)
    : []
const fixtures = createFixtureSet(options)

try {
  const workspace = await createWorkspaceContext({
    ...options,
    filePath: fixtures.relativePaths[0],
  })
  for (const browserName of options.browsers) {
    await runBrowser(browserName, workspace, fixtures.clientPaths(workspace.rootFolder.path))
  }
} finally {
  rmSync(fixtures.directory, { force: true, recursive: true })
}

function parseOptions(args) {
  const parsed = {
    appUrl: process.env.EDITOR_OPEN_BENCH_APP_URL ?? defaultAppUrl,
    browsers: browserList(process.env.EDITOR_OPEN_BENCH_BROWSERS ?? 'chromium'),
    calibrationFile: process.env.EDITOR_OPEN_BENCH_CALIBRATION_FILE ?? defaultCalibrationFile,
    calibrate: false,
    editorRoot: process.env.EDITOR_OPEN_BENCH_EDITOR_ROOT ?? null,
    filePath: process.env.EDITOR_OPEN_BENCH_FILE ?? defaultFilePath,
    gate: false,
    pageTimeoutMs: numberOption(process.env.EDITOR_OPEN_BENCH_PAGE_TIMEOUT_MS, 30_000),
    samplesPerMode: numberOption(process.env.EDITOR_OPEN_BENCH_SAMPLES, 30),
    seed: numberOption(process.env.EDITOR_OPEN_BENCH_SEED, 60_061),
    serverUrl: process.env.EDITOR_OPEN_BENCH_SERVER_URL ?? defaultServerUrl,
    summaryOnly: false,
    warmupsPerMode: numberOption(process.env.EDITOR_OPEN_BENCH_WARMUPS, 5),
    workspaceRoot: process.env.EDITOR_OPEN_BENCH_ROOT ?? defaultRootPath,
  }

  for (const arg of args) applyOption(parsed, arg)
  if (!parsed.editorRoot) parsed.editorRoot = defaultEditorRoot
  if (parsed.browsers.length === 0) parsed.browsers = ['chromium']
  if (parsed.gate && parsed.warmupsPerMode < 5) {
    throw createBenchmarkError('editor-open gate requires at least five warmups per mode')
  }
  if (parsed.gate && parsed.samplesPerMode < 30) {
    throw createBenchmarkError('editor-open gate requires at least 30 samples per mode')
  }
  return parsed
}

function applyOption(parsed, arg) {
  if (arg === '--gate') {
    parsed.gate = true
    return
  }
  if (arg === '--calibrate') {
    parsed.calibrate = true
    parsed.gate = true
    return
  }
  if (arg === '--summary-only') {
    parsed.summaryOnly = true
    return
  }

  const [name, value] = arg.split('=')
  if (name === '--app-url') parsed.appUrl = value ?? parsed.appUrl
  if (name === '--browsers') parsed.browsers = browserList(value)
  if (name === '--calibration-file') parsed.calibrationFile = value ?? parsed.calibrationFile
  if (name === '--editor-root') parsed.editorRoot = value ?? parsed.editorRoot
  if (name === '--file') parsed.filePath = value ?? parsed.filePath
  if (name === '--page-timeout-ms') parsed.pageTimeoutMs = numberOption(value, parsed.pageTimeoutMs)
  if (name === '--samples') parsed.samplesPerMode = numberOption(value, parsed.samplesPerMode)
  if (name === '--seed') parsed.seed = numberOption(value, parsed.seed)
  if (name === '--server-url') parsed.serverUrl = value ?? parsed.serverUrl
  if (name === '--warmups') parsed.warmupsPerMode = numberOption(value, parsed.warmupsPerMode)
  if (name === '--workspace-root') parsed.workspaceRoot = value ?? parsed.workspaceRoot
}

function createBenchmarkIdentity(config) {
  const source = resolve(config.workspaceRoot, config.filePath)
  return {
    benchmarkVersion: benchmarkIdentityVersion,
    colorScheme: benchmarkColorScheme,
    fixturePath: relative(config.workspaceRoot, source).split(sep).join('/'),
    fixtureSha256: createHash('sha256').update(readFileSync(source)).digest('hex'),
    modes,
    editorImplementationSha256: implementationFingerprint(
      config.editorRoot,
      editorImplementationEntries(config.editorRoot),
    ),
    platformImplementationSha256: implementationFingerprint(
      platformRoot,
      platformImplementationEntries,
    ),
    samplesPerMode: config.samplesPerMode,
    viewport: benchmarkViewport,
    warmupsPerMode: config.warmupsPerMode,
  }
}

function implementationFingerprint(root, entries) {
  const hash = createHash('sha256')
  const manifest = implementationManifest(root, entries)
  for (const relativePath of manifest) {
    hash.update(relativePath)
    hash.update('\0')
    hash.update(readFileSync(resolve(root, relativePath)))
    hash.update('\0')
  }
  return hash.digest('hex')
}

function editorImplementationEntries(root) {
  const entries = ['bun.lock', 'package.json']
  const packageDirectories = readdirSync(resolve(root, 'packages'), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .toSorted()
  for (const packageDirectory of packageDirectories) {
    entries.push(...editorPackageImplementationEntries(root, packageDirectory))
  }
  return entries
}

function editorPackageImplementationEntries(root, packageDirectory) {
  const packageRoot = `packages/${packageDirectory}`
  return [`${packageRoot}/package.json`, `${packageRoot}/src`, `${packageRoot}/dist`].filter(
    (entry) => existsSync(resolve(root, entry)),
  )
}

function implementationManifest(root, entries) {
  const files = []
  for (const entry of entries) collectImplementationFiles(root, entry, files)
  return files.toSorted()
}

function collectImplementationFiles(root, relativePath, files) {
  const absolutePath = resolve(root, relativePath)
  const stats = statSync(absolutePath)
  if (stats.isFile()) {
    if (implementationFileIsIncluded(relativePath)) files.push(relativePath)
    return
  }
  if (!stats.isDirectory()) return

  const children = readdirSync(absolutePath, { withFileTypes: true })
  for (const child of children) {
    if (child.isDirectory() && implementationManifestIgnoredDirectories.has(child.name)) continue
    collectImplementationFiles(root, `${relativePath}/${child.name}`, files)
  }
}

function implementationFileIsIncluded(relativePath) {
  if (relativePath.endsWith('.d.ts')) return false
  if (relativePath.endsWith('.map')) return false
  if (/\.(browser|spec|test)\.[cm]?[jt]sx?$/.test(relativePath)) return false
  return true
}

function readCalibrationEvidence(path, expectedIdentity) {
  let value
  try {
    value = JSON.parse(readFileSync(path, 'utf8'))
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw createBenchmarkError(`could not read editor-open calibration evidence: ${message}`)
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw createBenchmarkError('editor-open calibration evidence must be an object')
  }
  if (value.schemaVersion !== 2 || !Array.isArray(value.runs)) {
    throw createBenchmarkError(
      'editor-open calibration evidence is stale or unsupported; run bun run bench:editor-open:calibrate',
    )
  }
  validateCalibrationIdentity(value.identity)
  if (!calibrationIdentitiesMatch(value.identity, expectedIdentity)) {
    throw createBenchmarkError(
      'editor-open calibration evidence does not match the current fixture, implementation, and benchmark config; rerun bun run bench:editor-open:calibrate',
    )
  }
  const seedsByBrowser = new Map()
  for (const run of value.runs) {
    validateCalibrationRun(run, value.identity)
    const seeds = seedsByBrowser.get(run.browser) ?? new Set()
    if (seeds.has(run.seed)) {
      throw createBenchmarkError(
        `editor-open calibration evidence repeats ${run.browser} seed ${run.seed}`,
      )
    }
    seeds.add(run.seed)
    seedsByBrowser.set(run.browser, seeds)
  }
  return value.runs
}

function validateCalibrationIdentity(identity) {
  if (!identity || typeof identity !== 'object' || Array.isArray(identity)) {
    throw createBenchmarkError('editor-open calibration identity must be an object')
  }
  if (
    !Number.isInteger(identity.benchmarkVersion) ||
    typeof identity.colorScheme !== 'string' ||
    typeof identity.fixturePath !== 'string' ||
    typeof identity.fixtureSha256 !== 'string' ||
    (identity.editorImplementationSha256 !== undefined &&
      typeof identity.editorImplementationSha256 !== 'string') ||
    (identity.platformImplementationSha256 !== undefined &&
      typeof identity.platformImplementationSha256 !== 'string') ||
    !Array.isArray(identity.modes) ||
    !identity.modes.every((mode) => typeof mode === 'string') ||
    !Number.isInteger(identity.samplesPerMode) ||
    !Number.isInteger(identity.warmupsPerMode) ||
    !Number.isInteger(identity.viewport?.height) ||
    !Number.isInteger(identity.viewport?.width)
  ) {
    throw createBenchmarkError('editor-open calibration identity is invalid')
  }
}

function calibrationIdentitiesMatch(left, right) {
  return (
    left.benchmarkVersion === right.benchmarkVersion &&
    left.colorScheme === right.colorScheme &&
    left.fixturePath === right.fixturePath &&
    left.fixtureSha256 === right.fixtureSha256 &&
    left.editorImplementationSha256 === right.editorImplementationSha256 &&
    left.platformImplementationSha256 === right.platformImplementationSha256 &&
    left.samplesPerMode === right.samplesPerMode &&
    left.warmupsPerMode === right.warmupsPerMode &&
    left.viewport.height === right.viewport.height &&
    left.viewport.width === right.viewport.width &&
    sameValues(left.modes, right.modes)
  )
}

function sameValues(left, right) {
  if (left.length !== right.length) return false
  return left.every((value, index) => value === right[index])
}

function validateCalibrationRun(run, identity) {
  if (!run || typeof run !== 'object' || Array.isArray(run)) {
    throw createBenchmarkError('editor-open calibration run must be an object')
  }
  if (typeof run.browser !== 'string' || run.browser.length === 0) {
    throw createBenchmarkError('editor-open calibration run requires a browser')
  }
  const numericFields = [
    'baselineQueryOnlyHighlightP50Ms',
    'finalPrepared300HighlightP50Ms',
    'missHighlightP50Ms',
    'missNoiseMs',
    'samplesPerMode',
    'seed',
    'warmupsPerMode',
  ]
  for (const field of numericFields) {
    if (Number.isFinite(run[field])) continue
    throw createBenchmarkError(`editor-open calibration run has invalid ${field}`)
  }
  if (
    run.baselineQueryOnlyHighlightP50Ms <= 0 ||
    run.finalPrepared300HighlightP50Ms <= 0 ||
    run.missHighlightP50Ms <= 0 ||
    run.missNoiseMs <= 0
  ) {
    throw createBenchmarkError('editor-open calibration timings must be positive')
  }
  if (
    !Number.isInteger(run.samplesPerMode) ||
    !Number.isInteger(run.seed) ||
    !Number.isInteger(run.warmupsPerMode)
  ) {
    throw createBenchmarkError('editor-open calibration counts and seed must be integers')
  }
  if (run.samplesPerMode < 30 || run.warmupsPerMode < 5) {
    throw createBenchmarkError('editor-open calibration run used too few samples or warmups')
  }
  if (
    run.samplesPerMode !== identity.samplesPerMode ||
    run.warmupsPerMode !== identity.warmupsPerMode
  ) {
    throw createBenchmarkError('editor-open calibration run does not match its config identity')
  }
}

function createFixtureSet(config) {
  const directory = mkdtempSync(resolve(config.workspaceRoot, '.editor-open-benchmark-'))
  const count = modes.length * (config.warmupsPerMode + config.samplesPerMode + 1)
  const source = resolve(config.workspaceRoot, config.filePath)
  const relativePaths = []
  for (let index = 0; index < count; index += 1) {
    const fixture = resolve(directory, `sample-${String(index).padStart(4, '0')}.tsx`)
    copyFileSync(source, fixture)
    relativePaths.push(relative(config.workspaceRoot, fixture).split(sep).join('/'))
  }

  return {
    clientPaths: (rootPath) => relativePaths.map((path) => joinClientPath(rootPath, path)),
    directory,
    relativePaths,
  }
}

async function runBrowser(browserName, workspace, fixturePaths) {
  const browser = await browserTypes[browserName].launch(launchOptions(browserName))
  const context = await browser.newContext({
    colorScheme: benchmarkColorScheme,
    viewport: benchmarkViewport,
  })
  const inertPath = `search-buffer:${encodeURIComponent(workspace.rootFolder.path)}`
  await seedInertWorkspace(context, workspace, inertPath)

  try {
    const page = await context.newPage()
    page.setDefaultTimeout(options.pageTimeoutMs)
    await page.goto(traceUrl(options.appUrl), { waitUntil: 'domcontentloaded' })
    await waitForBenchmarkBridge(page, inertPath)

    let fixtureIndex = 0
    const warmupOrder = randomizedModes(options.warmupsPerMode, options.seed ^ 0x0610)
    const warmupSamples = []
    for (const mode of warmupOrder) {
      const sample = await runSample(
        page,
        workspace,
        fixturePaths[fixtureIndex],
        mode,
        fixtureIndex,
        true,
      )
      fixtureIndex += 1
      warmupSamples.push(sample)
    }

    const measuredOrder = randomizedModes(options.samplesPerMode, options.seed)
    const samples = []
    for (let order = 0; order < measuredOrder.length; order += 1) {
      const sample = await runSample(
        page,
        workspace,
        fixturePaths[fixtureIndex],
        measuredOrder[order],
        order,
        false,
      )
      fixtureIndex += 1
      samples.push(sample)
      if (!options.summaryOnly) {
        console.log(
          JSON.stringify({ browser: browserName, type: 'editor-open-benchmark-sample', ...sample }),
        )
      }
    }

    const compatibilitySamples = []
    const compatibilityCaptureResults = []
    for (const mode of modes) {
      const path = fixturePaths[fixtureIndex]
      fixtureIndex += 1
      const record = await captureCompatibilityRecord(page, workspace, path)
      compatibilityCaptureResults.push(record.reset)
      const sample = await runSample(
        page,
        workspace,
        path,
        mode,
        compatibilitySamples.length,
        false,
        { key: record.key, value: record.value },
      )
      compatibilitySamples.push(sample)
    }

    const summary = summarize(browserName, samples, compatibilitySamples)
    const runtimeSessionSamples = [
      ...warmupSamples,
      ...samples,
      ...compatibilityCaptureResults,
      ...compatibilitySamples,
    ]
    if (options.gate) validateGate(summary, samples, runtimeSessionSamples)
    console.log(`EDITOR_OPEN_BENCHMARK_SUMMARY ${JSON.stringify(summary, null, 2)}`)
    if (options.calibrate) {
      console.log(`EDITOR_OPEN_BENCHMARK_EVIDENCE ${JSON.stringify(calibrationEvidence(summary))}`)
    }
  } finally {
    await context.close().catch(() => {})
    await browser.close().catch(() => {})
  }
}

async function seedInertWorkspace(context, workspace, inertPath) {
  const entries = workspaceCacheEntries({ ...workspace, filePath: inertPath })
  await context.addInitScript((cacheEntries) => {
    localStorage.clear()
    for (const [key, value] of Object.entries(cacheEntries)) {
      localStorage.setItem(key, JSON.stringify(value))
    }
  }, entries)
}

async function waitForBenchmarkBridge(page, inertPath) {
  await page.waitForFunction(
    () =>
      typeof window.__editorPerfTrace?.beginEditorOpenSample === 'function' &&
      typeof window.__editorPerfTrace?.primeEditorOpenQuery === 'function' &&
      typeof window.__editorPerfTrace?.resetEditorOpenSample === 'function',
  )
  await page.locator(attributeSelector(inertPath)).waitFor({ state: 'visible' })
  await page.waitForFunction(
    (path) =>
      Array.from(document.querySelectorAll('[data-editor-tab-path]'))
        .find((tab) => tab.getAttribute('data-editor-tab-path') === path)
        ?.getAttribute('aria-selected') === 'true',
    inertPath,
  )
  await page.evaluate(() => document.fonts?.ready ?? Promise.resolve())
  await nextFrames(page)
}

async function runSample(page, workspace, path, mode, order, warmup, visibleSnapshotRecord = null) {
  await parkPointer(page)
  const target = { path, rootPath: workspace.rootFolder.path }
  const { sampleId } = await page.evaluate(
    (request) => window.__editorPerfTrace.beginEditorOpenSample(request),
    target,
  )
  const targetButton = page.locator(attributeSelector(path))
  await targetButton.waitFor({ state: 'visible' })
  await nextFrames(page)
  if (visibleSnapshotRecord) {
    await page.evaluate(
      ({ key, value }) => localStorage.setItem(key, JSON.stringify(value)),
      visibleSnapshotRecord,
    )
  }

  if (mode === 'query-only') {
    await page.evaluate((request) => window.__editorPerfTrace.primeEditorOpenQuery(request), target)
  }

  let detectedAt = null
  if (mode.startsWith('prepared-')) {
    await targetButton.scrollIntoViewIfNeeded()
    detectedAt = await triggerPreparedIntent(page, targetButton, path)
    await waitForLeadWindow(page, detectedAt, leadForMode(mode))
  }

  const activationAt = await activateTarget(page, path)
  await waitForAuthoritativePaint(page)
  await page.waitForTimeout(0)
  const measured = await readMeasuredPipeline(page, path, activationAt, detectedAt)
  const reset = await page.evaluate(
    (request) => window.__editorPerfTrace.resetEditorOpenSample(request),
    { ...target, sampleId },
  )
  await assertResetState(page, path)

  const sample = roundSample({
    ...measured,
    ...reset,
    mode,
    order,
    visibleSnapshotSeeded: visibleSnapshotRecord !== null,
    warmup,
  })
  validateSample(sample, visibleSnapshotRecord ? 'visible-snapshot-compatibility' : 'pipeline')
  return sample
}

async function captureCompatibilityRecord(page, workspace, path) {
  const target = { path, rootPath: workspace.rootFolder.path }
  const { sampleId } = await page.evaluate(
    (request) => window.__editorPerfTrace.beginEditorOpenSample(request),
    target,
  )
  const targetButton = page.locator(attributeSelector(path))
  await targetButton.waitFor({ state: 'visible' })
  await nextFrames(page)
  const activationAt = await activateTarget(page, path)
  await waitForAuthoritativePaint(page)
  await page.waitForTimeout(0)
  await page.waitForFunction((targetPath) => {
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index)
      if (!key?.endsWith('.editorVisibleSnapshot')) continue

      const serialized = localStorage.getItem(key)
      if (!serialized) continue
      const value = JSON.parse(serialized)
      if (value?.path === targetPath) return true
    }
    return false
  }, path)
  const record = await page.evaluate((targetPath) => {
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index)
      if (!key?.endsWith('.editorVisibleSnapshot')) continue

      const serialized = localStorage.getItem(key)
      if (!serialized) continue
      const value = JSON.parse(serialized)
      if (value?.path === targetPath) return { key, value }
    }
    return null
  }, path)
  const measured = await readMeasuredPipeline(page, path, activationAt, null)
  const reset = await page.evaluate(
    (request) => window.__editorPerfTrace.resetEditorOpenSample(request),
    {
      ...target,
      sampleId,
    },
  )
  validateCompatibilityCaptureReset(reset, path)
  await assertResetState(page, path)
  if (!record) throw createBenchmarkError(`visible snapshot capture missing for ${path}`)
  return { ...record, reset: { ...measured, ...reset } }
}

async function triggerPreparedIntent(page, targetButton, path) {
  const box = await targetButton.boundingBox()
  if (!box) throw createBenchmarkError(`prepared target has no layout box: ${path}`)

  const centerX = box.x + box.width / 2
  const centerY = box.y + box.height / 2
  await page.mouse.move(centerX, Math.min(880, box.y + box.height + 160))
  await page.mouse.move(centerX, box.y + box.height + 70, { steps: 4 })
  await page.mouse.move(centerX, box.y + box.height + 18, { steps: 4 })
  const detected = await waitForIntentMark(page, path, 1_000).catch(() => null)
  if (detected !== null) return detected

  await page.mouse.move(centerX, centerY, { steps: 2 })
  return waitForIntentMark(page, path, 2_000)
}

async function waitForIntentMark(page, path, timeout) {
  await page.waitForFunction(
    (targetPath) =>
      performance
        .getEntriesByName('editor.file_open_intent.detected', 'mark')
        .some((entry) => entry.detail?.path === targetPath),
    path,
    { timeout },
  )
  return page.evaluate(
    (targetPath) =>
      performance
        .getEntriesByName('editor.file_open_intent.detected', 'mark')
        .find((entry) => entry.detail?.path === targetPath)?.startTime ?? null,
    path,
  )
}

async function waitForLeadWindow(page, detectedAt, leadMs) {
  const elapsed = await page.evaluate((startedAt) => performance.now() - startedAt, detectedAt)
  const remaining = Math.max(0, leadMs - elapsed)
  if (remaining > 0) await page.waitForTimeout(remaining)
}

async function activateTarget(page, path) {
  return page.evaluate(
    ({ markNames, targetPath }) => {
      for (const name of markNames) performance.clearMarks(name)
      window.__editorPerfTrace.reset()
      const button = Array.from(document.querySelectorAll('[data-editor-tab-path]')).find(
        (candidate) => candidate.getAttribute('data-editor-tab-path') === targetPath,
      )
      if (!(button instanceof HTMLButtonElement)) {
        throw new DOMException('Benchmark target tab disappeared', 'InvalidStateError')
      }

      const activationAt = performance.now()
      performance.mark('editor.file_open.activation', { detail: { path: targetPath } })
      button.click()
      return activationAt
    },
    { markNames: pipelineMarkNames, targetPath: path },
  )
}

async function waitForAuthoritativePaint(page) {
  await page.waitForFunction(
    () =>
      performance.getEntriesByName('editor.authoritative_text_paint', 'mark').length === 1 &&
      performance.getEntriesByName('editor.authoritative_highlight_paint', 'mark').length === 1,
  )
}

function validateCompatibilityCaptureReset(reset, path) {
  if (reset.quiescent !== true) {
    throw createBenchmarkError(`visible snapshot capture reset was not quiescent for ${path}`)
  }
  if (reset.targetIntents === 0 && reset.nonTargetIntents === 0) return

  throw createBenchmarkError(
    `visible snapshot capture reset observed intents for ${path}: target=${reset.targetIntents}, nonTarget=${reset.nonTargetIntents}`,
  )
}

function readMeasuredPipeline(page, path, activationAt, detectedAt) {
  return page.evaluate(
    ({ activatedAt, intentAt, targetPath }) => {
      const report = window.__editorPerfTrace.report()
      const diagnostics = report.traceEvents
        .filter((event) => event.kind === 'diagnostic')
        .map((event) => event.diagnostic)
      const attachment = diagnostics.findLast((entry) => entry.name === 'editor.document.attach')
      const workers = performance
        .getEntriesByName('editor.worker.request', 'mark')
        .filter(
          (entry) => entry.detail?.type !== 'idleFence' && entry.detail?.type !== 'runtimeBarrier',
        )
      const longTasks = report.traceEvents.filter((event) => event.kind === 'long-task')

      return {
        authoritativeHighlightCount: performance.getEntriesByName(
          'editor.authoritative_highlight_paint',
          'mark',
        ).length,
        authoritativeHighlightMs: relativeMark('editor.authoritative_highlight_paint'),
        authoritativeTextCount: performance.getEntriesByName(
          'editor.authoritative_text_paint',
          'mark',
        ).length,
        authoritativeTextMs: relativeMark('editor.authoritative_text_paint'),
        bufferBuilds: pathMarkCount('editor.file_open.buffer_built'),
        cachedFrameCount: performance.getEntriesByName('editor.cached_visible_paint', 'mark')
          .length,
        cachedFrameMs: relativeMark('editor.cached_visible_paint'),
        fileReads: pathMarkCount('editor.file_open.file_read'),
        highlighterSessionCreations: diagnosticCount(
          'editor.syntax.session_created',
          'highlighter',
        ),
        postActivationHighlighterRuntimeSessionIds: workerRuntimeSessionIds('shiki'),
        postActivationStructuralRuntimeSessionIds: workerRuntimeSessionIds('tree-sitter'),
        intentMarkMs:
          performance
            .getEntriesByName('editor.file_open_intent.detected', 'mark')
            .find((entry) => entry.detail?.path === targetPath)?.startTime - activatedAt || null,
        leadMs: intentAt === null ? 0 : Math.max(0, activatedAt - intentAt),
        lineIndexScans: diagnosticCount('editor.line_starts.scan'),
        longTaskCount: longTasks.length,
        longTaskMaxMs: Math.max(0, ...longTasks.map((event) => event.durationMs)),
        longTaskTotalMs: longTasks.reduce((sum, event) => sum + event.durationMs, 0),
        promotionStage: attachment?.detail?.prepared
          ? `data:${attachment.detail.structural}:${attachment.detail.highlighter}`
          : 'miss',
        structuralSessionCreations: diagnosticCount('editor.syntax.session_created', 'structural'),
        workerOpenRequests: workerCount('open'),
        workerParseRequests: workerCount('parse'),
        workerQueryRequests: workerCount('queryRange'),
        workerRefreshRequests: workerCount('edit'),
        workerRequests: workers.length,
      }

      function relativeMark(name) {
        const entry = performance.getEntriesByName(name, 'mark')[0]
        return entry ? entry.startTime - activatedAt : null
      }

      function pathMarkCount(name) {
        return performance
          .getEntriesByName(name, 'mark')
          .filter((entry) => entry.detail?.path === targetPath).length
      }

      function diagnosticCount(name, family) {
        return diagnostics.filter(
          (entry) => entry.name === name && (!family || entry.detail?.family === family),
        ).length
      }

      function workerCount(type) {
        return workers.filter((entry) => entry.detail?.type === type).length
      }

      function workerRuntimeSessionIds(family) {
        return [
          ...new Set(
            workers
              .filter((entry) => entry.detail?.family === family)
              .map((entry) => entry.detail?.runtimeSessionId)
              .filter((runtimeSessionId) => typeof runtimeSessionId === 'string'),
          ),
        ]
      }
    },
    { activatedAt: activationAt, intentAt: detectedAt, targetPath: path },
  )
}

async function assertResetState(page, path) {
  const state = await page.evaluate(
    (targetPath) => ({
      activePath: document
        .querySelector('[data-editor-tab-path][aria-selected="true"]')
        ?.getAttribute('data-editor-tab-path'),
      targetTabs: Array.from(document.querySelectorAll('[data-editor-tab-path]')).filter(
        (tab) => tab.getAttribute('data-editor-tab-path') === targetPath,
      ).length,
    }),
    path,
  )
  if (state.targetTabs !== 0) throw createBenchmarkError('reset left the target tab mounted')
  if (!state.activePath?.startsWith('search-buffer:')) {
    throw createBenchmarkError(`reset did not restore the inert surface: ${state.activePath}`)
  }
}

function validateSample(sample, group) {
  if (sample.authoritativeTextCount !== 1 || sample.authoritativeHighlightCount !== 1) {
    throw createBenchmarkError(`${sample.mode} did not emit one authoritative paint per phase`)
  }
  if (sample.mode === 'query-only' && sample.fileReads !== 0) {
    throw createBenchmarkError(`query-only performed ${sample.fileReads} file reads after priming`)
  }
  if (group === 'visible-snapshot-compatibility') {
    if (!sample.visibleSnapshotSeeded) {
      throw createBenchmarkError(`${sample.mode} compatibility sample was not seeded`)
    }
    if (!sample.quiescent) {
      throw createBenchmarkError(`${sample.mode} compatibility reset did not prove quiescence`)
    }
    if (sample.cachedFrameCount === 0 && sample.mode.startsWith('prepared-')) return
    if (sample.cachedFrameCount !== 1) {
      throw createBenchmarkError(
        `${sample.mode} visible-snapshot compatibility sample did not paint one cached frame`,
      )
    }
    if (
      !Number.isFinite(sample.cachedFrameMs) ||
      sample.cachedFrameMs >= sample.authoritativeTextMs ||
      sample.cachedFrameMs >= sample.authoritativeHighlightMs
    ) {
      throw createBenchmarkError(
        `${sample.mode} did not paint its cached frame before authoritative text and highlight`,
      )
    }
    return
  }
  if (sample.cachedFrameCount !== 0) {
    throw createBenchmarkError(
      `${sample.mode} mixed a visible-snapshot frame into the pipeline group`,
    )
  }
  if (!sample.quiescent) throw createBenchmarkError(`${sample.mode} reset did not prove quiescence`)
  if (sample.mode === 'miss' || sample.mode === 'query-only') {
    if (sample.targetIntents !== 0 || sample.nonTargetIntents !== 0) {
      throw createBenchmarkError(
        `${sample.mode} fired Foresight intents: target=${sample.targetIntents}, nonTarget=${sample.nonTargetIntents}, relativeMarkMs=${sample.intentMarkMs}`,
      )
    }
    return
  }
  if (sample.targetIntents < 1) {
    throw createBenchmarkError(`${sample.mode} did not fire the real Foresight adapter`)
  }
}

function randomizedModes(samplesPerMode, seed) {
  const ordered = Array.from({ length: samplesPerMode }, () => modes).flat()
  const random = seededRandom(seed)
  for (let index = ordered.length - 1; index > 0; index -= 1) {
    const target = Math.floor(random() * (index + 1))
    const value = ordered[index]
    ordered[index] = ordered[target]
    ordered[target] = value
  }
  return ordered
}

function seededRandom(seed) {
  let value = seed >>> 0
  return () => {
    value ^= value << 13
    value ^= value >>> 17
    value ^= value << 5
    return (value >>> 0) / 0x1_0000_0000
  }
}

function summarize(browserName, samples, compatibilitySamples) {
  const byMode = Object.fromEntries(
    modes.map((mode) => [mode, summarizeMode(samples.filter((sample) => sample.mode === mode))]),
  )
  const missNoiseMs = pairedNoiseFloor(samples.filter((sample) => sample.mode === 'miss'))
  return {
    browser: browserName,
    config: {
      filePath: options.filePath,
      calibrate: options.calibrate,
      gate: options.gate,
      gateCalibration: calibrationContract(browserName),
      identity: benchmarkIdentity,
      primaryComparison: 'query-only vs prepared-300',
      samplesPerMode: options.samplesPerMode,
      seed: options.seed,
      warmCacheModel:
        'one browser/page; unique identical-byte TSX paths; balanced warmups; provider/grammar/theme/module/font caches retained; exact file/LSP/document/view/worker-runtime state reset per sample',
      warmupsPerMode: options.warmupsPerMode,
    },
    modes: byMode,
    visibleSnapshotCompatibility: Object.fromEntries(
      compatibilitySamples.map((sample) => [
        sample.mode,
        {
          authoritativeHighlightCount: sample.authoritativeHighlightCount,
          authoritativeHighlightMs: sample.authoritativeHighlightMs,
          authoritativeTextCount: sample.authoritativeTextCount,
          authoritativeTextMs: sample.authoritativeTextMs,
          cachedFrameCount: sample.cachedFrameCount,
          cachedFrameMs: sample.cachedFrameMs,
          promotionStage: sample.promotionStage,
          quiescent: sample.quiescent,
          visibleSnapshotSeeded: sample.visibleSnapshotSeeded,
        },
      ]),
    ),
    paired: {
      missNoiseMs,
      missPrepared300HighlightImprovementMs: difference(
        byMode.miss.authoritativeHighlightMs.p50,
        byMode['prepared-300'].authoritativeHighlightMs.p50,
      ),
      missPrepared300HighlightImprovementRatio: ratioImprovement(
        byMode.miss.authoritativeHighlightMs.p50,
        byMode['prepared-300'].authoritativeHighlightMs.p50,
      ),
      queryOnlyPrepared300HighlightImprovementMs: difference(
        byMode['query-only'].authoritativeHighlightMs.p50,
        byMode['prepared-300'].authoritativeHighlightMs.p50,
      ),
      queryOnlyPrepared300HighlightImprovementRatio: ratioImprovement(
        byMode['query-only'].authoritativeHighlightMs.p50,
        byMode['prepared-300'].authoritativeHighlightMs.p50,
      ),
      prepared300TextImprovementMs: difference(
        byMode['query-only'].authoritativeTextMs.p50,
        byMode['prepared-300'].authoritativeTextMs.p50,
      ),
    },
  }
}

function summarizeMode(samples) {
  return {
    samples: samples.length,
    authoritativeHighlightMs: distribution(samples, 'authoritativeHighlightMs'),
    authoritativeTextMs: distribution(samples, 'authoritativeTextMs'),
    leadMs: distribution(samples, 'leadMs'),
    structural: Object.fromEntries(
      [
        'bufferBuilds',
        'evictions',
        'fileReads',
        'highlighterSessionCreations',
        'lineIndexScans',
        'nonTargetIntents',
        'preparedClaims',
        'promotedBytes',
        'structuralSessionCreations',
        'targetIntents',
        'wastedIntents',
        'workerOpenRequests',
        'workerParseRequests',
        'workerQueryRequests',
        'workerRefreshRequests',
        'workerRequests',
      ].map((key) => [key, distribution(samples, key)]),
    ),
    promotionStages: tally(samples.map((sample) => sample.promotionStage)),
  }
}

function validateGate(summary, samples, runtimeSessionSamples) {
  const prepared300 = samples.filter((sample) => sample.mode === 'prepared-300')
  const structuralFailures = prepared300.filter(
    (sample) =>
      sample.fileReads !== 0 ||
      sample.bufferBuilds !== 0 ||
      sample.lineIndexScans !== 0 ||
      sample.structuralSessionCreations !== 0 ||
      sample.highlighterSessionCreations !== 0 ||
      sample.workerOpenRequests !== 0 ||
      sample.workerParseRequests !== 0 ||
      sample.workerQueryRequests !== 0 ||
      sample.workerRefreshRequests !== 0,
  )
  if (structuralFailures.length > 0) {
    throw createBenchmarkError(
      `prepared-300 started transferable work after activation in ${structuralFailures.length} samples`,
    )
  }
  if (prepared300.some((sample) => sample.preparedClaims !== 1)) {
    throw createBenchmarkError('prepared-300 did not promote exactly one prepared claim per sample')
  }
  if (
    prepared300.some(
      (sample) =>
        sample.transferredHighlighterRuntimeSessionIds.length !== 1 ||
        sample.transferredStructuralRuntimeSessionIds.length !== 1,
    )
  ) {
    throw createBenchmarkError(
      'prepared-300 did not expose one transferred runtime id for each syntax family',
    )
  }
  assertTransferredRuntimeIdsAreScoped(prepared300, 'highlighter')
  assertTransferredRuntimeIdsAreScoped(prepared300, 'structural')
  assertUniqueRuntimeSessionIds(runtimeSessionSamples, [
    'highlighterRuntimeSessionIds',
    'postActivationHighlighterRuntimeSessionIds',
  ])
  assertUniqueRuntimeSessionIds(runtimeSessionSamples, [
    'structuralRuntimeSessionIds',
    'postActivationStructuralRuntimeSessionIds',
  ])
  assertUniqueRuntimeSessionIdsAcrossFamilies(runtimeSessionSamples)
  if (summary.paired.queryOnlyPrepared300HighlightImprovementMs <= summary.paired.missNoiseMs) {
    throw createBenchmarkError(
      `prepared-300 improvement over query-only ${summary.paired.queryOnlyPrepared300HighlightImprovementMs}ms did not exceed ${summary.paired.missNoiseMs}ms noise`,
    )
  }
  if (options.calibrate) return

  const calibration = calibrationContract(summary.browser)
  if (!calibration) {
    throw createBenchmarkError('editor-open gate requires three recorded paired calibration runs')
  }
  if (summary.modes.miss.authoritativeHighlightMs.p50 > calibration.missUpperBoundMs) {
    throw createBenchmarkError(
      `miss highlight p50 ${summary.modes.miss.authoritativeHighlightMs.p50}ms regressed past calibrated ${calibration.missUpperBoundMs}ms`,
    )
  }
  if (
    summary.modes['query-only'].authoritativeHighlightMs.p50 > calibration.queryOnlyUpperBoundMs
  ) {
    throw createBenchmarkError(
      `query-only highlight p50 ${summary.modes['query-only'].authoritativeHighlightMs.p50}ms regressed past calibrated ${calibration.queryOnlyUpperBoundMs}ms`,
    )
  }
  if (
    summary.paired.queryOnlyPrepared300HighlightImprovementRatio <
    calibration.minimumImprovementRatio
  ) {
    throw createBenchmarkError(
      `prepared-300 relative improvement over query-only ${summary.paired.queryOnlyPrepared300HighlightImprovementRatio} did not reach calibrated ${calibration.minimumImprovementRatio}`,
    )
  }
}

function assertTransferredRuntimeIdsAreScoped(samples, family) {
  const scopedKey = `${family}RuntimeSessionIds`
  const transferredKey = `transferred${family[0].toUpperCase()}${family.slice(1)}RuntimeSessionIds`
  for (const sample of samples) {
    const scoped = new Set(sample[scopedKey])
    if (sample[transferredKey].every((runtimeSessionId) => scoped.has(runtimeSessionId))) continue

    throw createBenchmarkError(`prepared-300 transferred ${family} runtime id was not scoped`)
  }
}

function assertUniqueRuntimeSessionIds(samples, keys) {
  assertRuntimeSessionSetsAreDisjoint(
    sampleRuntimeSessionIdSets(samples, keys),
    `editor-open benchmark reused a scoped ${keys.join('/')}`,
  )
}

function assertUniqueRuntimeSessionIdsAcrossFamilies(samples) {
  const highlighterKeys = [
    'highlighterRuntimeSessionIds',
    'postActivationHighlighterRuntimeSessionIds',
  ]
  const structuralKeys = [
    'postActivationStructuralRuntimeSessionIds',
    'structuralRuntimeSessionIds',
  ]
  const highlighterSets = sampleRuntimeSessionIdSets(samples, highlighterKeys)
  const structuralSets = sampleRuntimeSessionIdSets(samples, structuralKeys)
  for (let index = 0; index < samples.length; index += 1) {
    const highlighter = highlighterSets[index]
    const structural = structuralSets[index]
    if ([...highlighter].every((runtimeSessionId) => !structural.has(runtimeSessionId))) continue

    throw createBenchmarkError('editor-open benchmark reused a runtime id across syntax families')
  }

  const combinedSets = highlighterSets.map(
    (highlighter, index) => new Set([...highlighter, ...structuralSets[index]]),
  )
  assertRuntimeSessionSetsAreDisjoint(
    combinedSets,
    'editor-open benchmark reused a runtime id across samples',
  )
}

function assertRuntimeSessionSetsAreDisjoint(runtimeSessionSets, message) {
  const seen = new Set()
  for (const runtimeSessionIds of runtimeSessionSets) {
    for (const runtimeSessionId of runtimeSessionIds) {
      if (seen.has(runtimeSessionId)) throw createBenchmarkError(message)
      seen.add(runtimeSessionId)
    }
  }
}

function sampleRuntimeSessionIdSets(samples, keys) {
  return samples.map((sample) => new Set(keys.flatMap((key) => sample[key] ?? [])))
}

function calibrationContract(browserName) {
  const evidence = gateCalibrationEvidence.filter((run) => run.browser === browserName)
  if (evidence.length < 3) return null

  const noiseAdjustedRatios = evidence.map((run) =>
    ratioImprovement(
      run.baselineQueryOnlyHighlightP50Ms,
      run.finalPrepared300HighlightP50Ms + run.missNoiseMs,
    ),
  )
  return {
    evidence,
    minimumImprovementRatio: Math.min(...noiseAdjustedRatios),
    missUpperBoundMs: Math.max(...evidence.map((run) => run.missHighlightP50Ms + run.missNoiseMs)),
    queryOnlyUpperBoundMs: Math.max(
      ...evidence.map((run) => run.baselineQueryOnlyHighlightP50Ms + run.missNoiseMs),
    ),
  }
}

function calibrationEvidence(summary) {
  return {
    identity: benchmarkIdentity,
    run: {
      baselineQueryOnlyHighlightP50Ms: summary.modes['query-only'].authoritativeHighlightMs.p50,
      browser: summary.browser,
      finalPrepared300HighlightP50Ms: summary.modes['prepared-300'].authoritativeHighlightMs.p50,
      missHighlightP50Ms: summary.modes.miss.authoritativeHighlightMs.p50,
      missNoiseMs: summary.paired.missNoiseMs,
      samplesPerMode: options.samplesPerMode,
      seed: options.seed,
      warmupsPerMode: options.warmupsPerMode,
    },
  }
}

function distribution(samples, key) {
  const values = samples.map((sample) => sample[key]).filter((value) => Number.isFinite(value))
  return { p50: percentile(values, 0.5), p95: percentile(values, 0.95) }
}

function pairedNoiseFloor(samples) {
  const values = samples
    .map((sample) => sample.authoritativeHighlightMs)
    .toSorted((left, right) => left - right)
  const median = percentile(values, 0.5)
  const deviations = values.map((value) => Math.abs(value - median))
  const robustStandardDeviation = percentile(deviations, 0.5) * 1.4826
  const medianStandardError = (robustStandardDeviation * 1.2533) / Math.sqrt(values.length)
  return round(Math.max(1, medianStandardError * 1.96))
}

function ratioImprovement(baseline, candidate) {
  if (baseline <= 0) return 0
  return round((baseline - candidate) / baseline)
}

function tally(values) {
  const counts = {}
  for (const value of values) counts[value] = (counts[value] ?? 0) + 1
  return counts
}

function difference(left, right) {
  return round(left - right)
}

function roundSample(sample) {
  return Object.fromEntries(
    Object.entries(sample).map(([key, value]) => [
      key,
      typeof value === 'number' ? round(value) : value,
    ]),
  )
}

function leadForMode(mode) {
  return Number(mode.slice('prepared-'.length))
}

function joinClientPath(rootPath, path) {
  if (!rootPath || rootPath === '.') return path
  return `${rootPath.replace(/\/$/, '')}/${path.replace(/^\//, '')}`
}

function attributeSelector(value) {
  return `[data-editor-tab-path=${JSON.stringify(value)}]`
}

async function parkPointer(page) {
  await page.mouse.move(8, 890)
  await nextFrames(page)
}

function nextFrames(page) {
  return page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  )
}
