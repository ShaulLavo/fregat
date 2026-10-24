import { hash } from 'node:crypto'
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { chromium, webkit, type Browser, type Page } from 'playwright'
import { createScriptError, scriptFailureText } from '../structured-errors'
import type { Observation } from '../../packages/markdown/test/qualification'
import {
  parseBrowserInput,
  validateBrowserEvaluation,
  type BrowserEvaluationInput,
  type BrowserEvaluationReceipt,
  type BrowserEvaluationRow,
  type CandidateIdentity,
  heldoutSchedules,
  verifyCandidate,
} from './evaluate-heldout'
import { validateProductionBuildIdentity } from './production-browser'
import { productionDigest } from './production-analysis'
import { withProductionDeadline } from './production-deadline'
import { serveMarkdownProductionProbe } from './production-server'
import { absent, listenerAbsent } from './production-cleanup'
import { qualificationProvenance } from './provenance'
import { encoded, isRecord, stable } from './serialization'

const ROOT = fileURLToPath(new URL('../../', import.meta.url))
const ENGINES = ['remark', 'tree-sitter'] as const
type Engine = (typeof ENGINES)[number]
type BrowserKind = 'chromium' | 'webkit'

type BrowserFrame = BrowserEvaluationRow['completed'][number]['baseline']
type ProbeResult = {
  readonly frames: readonly BrowserFrame[]
  readonly final: BrowserFrame
}

type ProbeRunner = {
  readonly run: (engine: Engine, source: string, chunks: readonly string[]) => Promise<unknown>
  readonly show: (engine: Engine, source: string, live: boolean) => Promise<unknown>
}

type EvidenceRecord = {
  readonly kind: 'completed' | 'stream' | 'failure'
  readonly messageId: string | null
  readonly sourceSha256: string | null
  readonly scheduleId: string | null
  readonly offsets: readonly number[]
  readonly engine: Engine | null
  readonly result?: unknown
  readonly error?: BrowserError
}

type BrowserError = {
  readonly name: string
  readonly message: string
  readonly stack: string | null
}

type BrowserHeldoutRawEvidence = {
  readonly schemaVersion: 1
  readonly status: 'passed' | 'failed'
  readonly generatedAt: string
  readonly inputSha256: string | null
  readonly candidate: CandidateIdentity | null
  readonly batchAssetSha256: string | null
  readonly productionBuildSha256: string | null
  readonly failures: readonly string[]
  readonly records: readonly EvidenceRecord[]
}

type BrowserHeldoutCollection = {
  readonly receipt: BrowserEvaluationReceipt | null
  readonly rawEvidence: BrowserHeldoutRawEvidence
}

type TrustedBrowserInput = {
  readonly input: BrowserEvaluationInput
  readonly inputSha256: string
  readonly productionBuildSha256: string
  readonly buildDirectory: string
  readonly files: readonly { readonly file: string; readonly sha256: string }[]
  readonly provenance: Awaited<ReturnType<typeof qualificationProvenance>>
  readonly budgetSha256: string
}

export function validateBrowserInputShape(input: BrowserEvaluationInput) {
  if (input.messages.length !== 100)
    throw createScriptError('The browser input does not contain the complete 100-message batch.', {
      internal: { received: input.messages.length, expected: 100 },
    })
  const ids = new Set<string>()
  for (const message of input.messages) {
    if (ids.has(message.id))
      throw createScriptError('The browser input contains duplicate message identities.', {
        internal: { messageId: message.id },
      })
    ids.add(message.id)
    if (hash('sha256', message.source) !== message.sourceSha256)
      throw createScriptError('The browser input source hash does not match its authored source.', {
        internal: { messageId: message.id },
      })
    const expected = heldoutSchedules(message.source)
    if (stable(expected) !== stable(message.schedules))
      throw createScriptError('The browser input changes a frozen stream schedule.', {
        internal: { messageId: message.id },
      })
  }
}

export async function productionBuildSha256(directory: string) {
  return hash('sha256', encoded(await snapshotBuild(directory)))
}

async function snapshotBuild(directory: string) {
  const root = path.resolve(directory)
  return Promise.all(
    (await buildFiles(root)).map(async (file) => ({
      file: path.relative(root, file).split(path.sep).join('/'),
      sha256: hash('sha256', await readFile(file)),
    })),
  )
}

const wasmBuildRoles = [
  { field: 'grammarSha256', file: /^tree-sitter-markdown(?:-(?!chat(?:-|\.))[\w-]+)?\.wasm$/u },
  { field: 'chatGrammarSha256', file: /^tree-sitter-markdown-chat(?:-[\w-]+)?\.wasm$/u },
  { field: 'resolverSha256', file: /^tree-sitter-md(?:-[\w-]+)?\.wasm$/u },
] as const

export function validateBuildArtifacts(
  build: unknown,
  files: readonly { readonly file: string; readonly sha256: string }[],
  candidate: CandidateIdentity['artifacts'],
) {
  if (!isRecord(build) || !Array.isArray(build.artifacts) || build.artifacts.length === 0)
    throw createScriptError('The production build has no recorded artifacts.')
  const recorded = new Set<string>()
  const artifacts: { readonly file: string; readonly sha256: string }[] = []
  for (const artifact of build.artifacts) {
    if (
      !isRecord(artifact) ||
      typeof artifact.file !== 'string' ||
      typeof artifact.sha256 !== 'string'
    )
      throw createScriptError('The production build artifact identity is malformed.')
    const file = `assets/${artifact.file}`
    if (
      recorded.has(file) ||
      !files.some((entry) => entry.file === file && entry.sha256 === artifact.sha256)
    )
      throw createScriptError('A production asset differs from its recorded build hash.')
    recorded.add(file)
    artifacts.push({ file: artifact.file, sha256: artifact.sha256 })
  }
  if (files.some((entry) => entry.file.startsWith('assets/') && !recorded.has(entry.file)))
    throw createScriptError('The production build contains an unrecorded asset.')
  for (const { field, file } of wasmBuildRoles) {
    const matching = artifacts.filter((entry) => file.test(path.posix.basename(entry.file)))
    if (matching.length !== 1 || matching[0].sha256 !== candidate[field])
      throw createScriptError('A production WASM asset differs from its candidate role.', {
        internal: { role: field },
      })
  }
}

export function validateServedFiles(
  expected: readonly { readonly file: string; readonly sha256: string }[],
  served: unknown,
) {
  if (!Array.isArray(served) || stable(expected) !== stable(served))
    throw createScriptError('The served production files differ from the frozen preflight build.')
}

async function loadTrustedBrowserInput(
  inputPath: string,
  buildDirectory: string,
  root = ROOT,
): Promise<TrustedBrowserInput> {
  const inputBytes = await readFile(inputPath)
  const input = parseBrowserInput(JSON.parse(inputBytes.toString('utf8')))
  await verifyCandidate(root, input.candidate)
  validateBrowserInputShape(input)
  const provenance = await qualificationProvenance(root)
  const buildBytes = await readFile(path.join(buildDirectory, 'markdown-probe-build.json'), 'utf8')
  const build = JSON.parse(buildBytes)
  const manifest = await readFile(path.join(buildDirectory, '.vite', 'manifest.json'), 'utf8')
  const budgetSha256 = productionDigest(
    await readFile(path.join(root, 'scripts/markdown/promotion-budget.json')),
  )
  validateProductionBuildIdentity(build, manifest, provenance, budgetSha256)
  if (provenance.revision !== input.candidate.candidateCommit)
    throw createScriptError('The browser input candidate is not the current source revision.', {
      internal: { boundary: 'browser-input-revision' },
    })
  const files = await snapshotBuild(buildDirectory)
  validateBuildArtifacts(build, files, input.candidate.artifacts)
  if (
    files.find((entry) => entry.file === 'markdown-probe-build.json')?.sha256 !==
      hash('sha256', buildBytes) ||
    files.find((entry) => entry.file === '.vite/manifest.json')?.sha256 !== hash('sha256', manifest)
  )
    throw createScriptError('The production build metadata changed during preflight.')
  const buildSha256 = hash('sha256', encoded(files))
  return {
    input,
    inputSha256: hash('sha256', inputBytes),
    productionBuildSha256: buildSha256,
    buildDirectory: path.resolve(buildDirectory),
    files,
    provenance,
    budgetSha256,
  }
}

export async function collectBrowserEvaluation(
  input: BrowserEvaluationInput,
  metadata: {
    readonly inputSha256: string
    readonly productionBuildSha256: string
  },
  run: ProbeRunner,
): Promise<BrowserHeldoutCollection> {
  const records: EvidenceRecord[] = []
  const failures: string[] = []
  const rows: BrowserEvaluationRow[] = []
  try {
    for (const message of input.messages) rows.push(await collectMessage(message, run, records))
  } catch (error) {
    const detail = errorDetails(error)
    failures.push(`Browser production probe failed with ${detail.name}: ${detail.message}`)
  }
  const receipt =
    failures.length > 0
      ? null
      : {
          candidate: input.candidate,
          batchAssetSha256: input.batchAssetSha256,
          productionBuildSha256: metadata.productionBuildSha256,
          rows,
        }
  if (receipt) failures.push(...validateBrowserEvaluation(input, receipt).failures)
  return {
    receipt: failures.length === 0 ? receipt : null,
    rawEvidence: {
      schemaVersion: 1,
      status: failures.length === 0 ? 'passed' : 'failed',
      generatedAt: new Date().toISOString(),
      inputSha256: metadata.inputSha256,
      candidate: input.candidate,
      batchAssetSha256: input.batchAssetSha256,
      productionBuildSha256: metadata.productionBuildSha256,
      failures,
      records,
    },
  }
}

async function collectMessage(
  message: BrowserEvaluationInput['messages'][number],
  run: ProbeRunner,
  records: EvidenceRecord[],
): Promise<BrowserEvaluationRow> {
  const completed = await collectPair(
    message.id,
    message.source,
    message.sourceSha256,
    null,
    [],
    'completed',
    run,
    records,
  )
  const streams = []
  for (const schedule of message.schedules) {
    const chunks = schedule.offsets.map((offset) => message.source.slice(0, offset))
    const pair = await collectPair(
      message.id,
      message.source,
      message.sourceSha256,
      schedule.id,
      schedule.offsets,
      'stream',
      run,
      records,
      chunks,
    )
    assertSettlementMatchesCompleted(message.id, schedule.id, completed, pair)
    streams.push({ scheduleId: schedule.id, observations: pair })
  }
  return {
    id: message.id,
    sourceSha256: message.sourceSha256,
    completed,
    streams,
  }
}

async function collectPair(
  messageId: string,
  source: string,
  sourceSha256: string,
  scheduleId: string | null,
  offsets: readonly number[],
  kind: 'completed' | 'stream',
  run: ProbeRunner,
  records: EvidenceRecord[],
  chunks: readonly string[] = [],
) {
  const expectedFrames = kind === 'completed' ? 1 : chunks.length + 1
  const observations: BrowserEvaluationRow['completed'][number][] = []
  const engineResults = new Map<Engine, readonly BrowserFrame[]>()
  for (const engine of ENGINES) {
    const result = await runWithEvidence(
      engine,
      messageId,
      source,
      sourceSha256,
      scheduleId,
      offsets,
      kind,
      run,
      records,
      chunks,
    )
    engineResults.set(engine, result.frames)
  }
  const baseline = engineResults.get('remark')
  const candidate = engineResults.get('tree-sitter')
  if (!baseline || !candidate)
    throw createScriptError('The browser probe did not return both parser engines.', {
      internal: { messageId, scheduleId },
    })
  if (baseline.length !== expectedFrames || candidate.length !== expectedFrames)
    throw createScriptError('The browser probe returned an incomplete frame denominator.', {
      internal: { messageId, scheduleId, expectedFrames },
    })
  for (let index = 0; index < expectedFrames; index += 1) {
    const baselineObservation = baseline[index]
    const candidateObservation = candidate[index]
    if (!baselineObservation || !candidateObservation)
      throw createScriptError('The browser probe omitted a required observation.', {
        internal: { messageId, scheduleId, frame: index },
      })
    observations.push({ baseline: baselineObservation, candidate: candidateObservation })
  }
  return observations
}

function assertSettlementMatchesCompleted(
  messageId: string,
  scheduleId: string,
  completed: BrowserEvaluationRow['completed'],
  stream: BrowserEvaluationRow['completed'],
) {
  const completedPair = completed[0]
  const settlement = stream.at(-1)
  if (!completedPair || !settlement)
    throw createScriptError('The browser probe omitted a completed or settlement observation.', {
      internal: { messageId, scheduleId },
    })
  if (
    stable(completedPair.baseline.observation) !== stable(settlement.baseline.observation) ||
    stable(completedPair.candidate.observation) !== stable(settlement.candidate.observation)
  )
    throw createScriptError('Browser stream settlement differs from its fresh completed output.', {
      internal: { messageId, scheduleId },
    })
}

async function runWithEvidence(
  engine: Engine,
  messageId: string,
  source: string,
  sourceSha256: string,
  scheduleId: string | null,
  offsets: readonly number[],
  kind: 'completed' | 'stream',
  run: ProbeRunner,
  records: EvidenceRecord[],
  chunks: readonly string[],
) {
  try {
    const raw =
      kind === 'completed'
        ? await run.show(engine, source, false)
        : await run.run(engine, source, chunks)
    records.push({
      kind,
      messageId,
      sourceSha256,
      scheduleId,
      offsets,
      engine,
      result: raw,
    })
    if (kind === 'completed') return probeResult({ frames: [raw], final: raw }, [source], false)
    return probeResult(raw, chunks.concat([source]), true)
  } catch (error) {
    records.push({
      kind: 'failure',
      messageId,
      sourceSha256,
      scheduleId,
      offsets,
      engine,
      error: errorDetails(error),
    })
    throw error
  }
}

function probeResult(value: unknown, sources: readonly string[], streaming: boolean): ProbeResult {
  if (!isRecord(value) || !Array.isArray(value.frames))
    throw createScriptError('The browser probe returned a malformed production receipt.')
  if (value.frames.length !== sources.length)
    throw createScriptError('The browser probe returned an incomplete production receipt.', {
      internal: { expectedFrames: sources.length, receivedFrames: value.frames.length },
    })
  const rawFrames = value.frames
  const frames = sources.map((source, index) =>
    productionFrame(rawFrames[index], source, streaming && index < sources.length - 1),
  )
  const last = frames.at(-1)
  const source = sources.at(-1)
  if (
    !last ||
    source === undefined ||
    stable(last) !== stable(productionFrame(value.final, source, false))
  )
    throw createScriptError('The browser probe final observation differs from its last frame.')
  return { frames, final: last }
}

function productionFrame(value: unknown, source: string, live: boolean): BrowserFrame {
  if (!isRecord(value)) throw createScriptError('The production frame is malformed.')
  const { inputSha256, inputUtf16Units, live: observedLive } = value
  if (
    !isObservation(value) ||
    inputSha256 !== hash('sha256', source) ||
    inputUtf16Units !== source.length ||
    observedLive !== live
  )
    throw createScriptError(
      'The production frame has incorrect source, prefix, UTF-16 length, or live provenance.',
    )
  return {
    observation: { text: value.text, elements: value.elements },
    inputSha256,
    inputUtf16Units,
    live: observedLive,
  }
}

function isObservation(value: unknown): value is Observation {
  if (!isRecord(value) || typeof value.text !== 'string' || !Array.isArray(value.elements))
    return false
  return value.elements.every(isObservationElement)
}

function isObservationElement(value: unknown): value is Observation['elements'][number] {
  if (!isRecord(value) || typeof value.tag !== 'string' || typeof value.text !== 'string')
    return false
  if (!isStringRecord(value.attributes) || !Array.isArray(value.parents)) return false
  return value.parents.every((parent) => typeof parent === 'string')
}

function isStringRecord(value: unknown): value is Record<string, string> {
  if (!isRecord(value)) return false
  return Object.values(value).every((entry) => typeof entry === 'string')
}

async function buildFiles(directory: string, relative = ''): Promise<string[]> {
  const current = path.join(directory, relative)
  const entries = await readdir(current, { withFileTypes: true })
  entries.sort((left, right) => left.name.localeCompare(right.name))
  let files: string[] = []
  for (const entry of entries) {
    const child = path.join(relative, entry.name)
    if (entry.isSymbolicLink())
      throw createScriptError('The production build contains a symlink.', {
        internal: { file: child },
      })
    if (entry.isDirectory()) {
      files = files.concat(await buildFiles(directory, child))
      continue
    }
    if (entry.isFile()) files.push(path.join(directory, child))
  }
  return files
}

function errorDetails(error: unknown): BrowserError {
  if (error instanceof Error)
    return { name: error.name, message: error.message, stack: error.stack ?? null }
  return { name: typeof error, message: String(error), stack: null }
}

type PageFailure = { readonly engine: Engine; readonly error: BrowserError }
type ResourceCleanup = {
  readonly name: string
  readonly identity: unknown
  checks: Record<string, boolean> | null
  error: BrowserError | null
}
type CleanupEvidence = {
  readonly resources: ResourceCleanup[]
  readonly signals: string[]
}
type OwnedResource = { readonly close: () => Promise<void>; readonly verify: () => Promise<void> }

export async function withBrowserLifetime<T>(
  work: (scope: {
    readonly own: (resource: {
      readonly name: string
      readonly identity: unknown
      readonly close: () => Promise<void>
      readonly checks: () => Promise<Record<string, boolean>>
    }) => void
    readonly checkpoint: () => void
  }) => Promise<T>,
  evidence: CleanupEvidence,
  signals: {
    on: (event: 'SIGINT' | 'SIGTERM', listener: () => void) => unknown
    removeListener: (event: 'SIGINT' | 'SIGTERM', listener: () => void) => unknown
  } = process,
): Promise<T> {
  const resources: OwnedResource[] = []
  const interrupt = (signal: string) => {
    evidence.signals.push(signal)
    for (const resource of resources) void resource.close().catch(() => undefined)
  }
  const sigint = () => interrupt('SIGINT')
  const sigterm = () => interrupt('SIGTERM')
  signals.on('SIGINT', sigint)
  signals.on('SIGTERM', sigterm)
  const checkpoint = () => {
    if (evidence.signals.length > 0)
      throw createScriptError('The browser evaluation was interrupted.', {
        internal: { signals: evidence.signals },
      })
  }
  try {
    const result = await work({
      own: (resource) => registerResource(resource, resources, evidence),
      checkpoint,
    })
    checkpoint()
    return result
  } finally {
    await cleanResources(resources)
    signals.removeListener('SIGINT', sigint)
    signals.removeListener('SIGTERM', sigterm)
  }
}

function registerResource(
  resource: {
    readonly name: string
    readonly identity: unknown
    readonly close: () => Promise<void>
    readonly checks: () => Promise<Record<string, boolean>>
  },
  resources: OwnedResource[],
  evidence: CleanupEvidence,
) {
  const receipt: ResourceCleanup = {
    name: resource.name,
    identity: resource.identity,
    checks: null,
    error: null,
  }
  evidence.resources.push(receipt)
  let closing: Promise<void> | null = null
  const close = () => (closing ??= Promise.resolve().then(resource.close))
  const verify = async () => {
    try {
      await close()
      receipt.checks = await resource.checks()
    } catch (error) {
      receipt.error = errorDetails(error)
    }
  }
  resources.push({ close, verify })
  if (evidence.signals.length > 0) void close().catch(() => undefined)
}

async function cleanResources(resources: OwnedResource[]) {
  for (const resource of resources.reverse()) await resource.verify()
}

export function observePageErrors(
  page: {
    on: (event: 'pageerror', listener: (error: Error) => void) => unknown
    removeListener: (event: 'pageerror', listener: (error: Error) => void) => unknown
  },
  engine: Engine,
  records: PageFailure[],
) {
  const errors: Error[] = []
  const onError = (error: Error) => {
    errors.push(error)
    records.push({ engine, error: errorDetails(error) })
  }
  page.on('pageerror', onError)
  return {
    assert: () => {
      const error = errors[0]
      if (error) throw error
    },
    close: () => page.removeListener('pageerror', onError),
  }
}

type ServedBuildEvidence = {
  readonly engine: Engine
  readonly served: Awaited<ReturnType<typeof readServedFiles>>
}

async function readServedFiles(
  files: readonly { readonly file: string; readonly sha256: string }[],
) {
  const root = new URL('../', location.href)
  const snapshots: { file: string; sha256: string }[] = []
  let build: unknown = null
  let manifest: string | null = null
  for (const file of files) {
    const response = await fetch(new URL(file.file, root), { cache: 'no-store' })
    if (response.status !== 200)
      throw new TypeError(`Production asset HTTP ${response.status}: ${file.file}`)
    const bytes = await response.arrayBuffer()
    const digest = await crypto.subtle.digest('SHA-256', bytes)
    snapshots.push({
      file: file.file,
      sha256: Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join(
        '',
      ),
    })
    if (file.file === 'markdown-probe-build.json')
      build = JSON.parse(new TextDecoder().decode(bytes))
    if (file.file === '.vite/manifest.json') manifest = new TextDecoder().decode(bytes)
  }
  return { files: snapshots, build, manifest }
}

async function validateServedBuild(
  page: Page,
  engine: Engine,
  trusted: TrustedBrowserInput,
  records: ServedBuildEvidence[],
) {
  const served = await page.evaluate(readServedFiles, trusted.files)
  records.push({ engine, served })
  validateServedFiles(trusted.files, served.files)
  validateBuildArtifacts(served.build, served.files, trusted.input.candidate.artifacts)
  if (served.manifest === null)
    throw createScriptError('The served production manifest is missing.')
  validateProductionBuildIdentity(
    served.build,
    served.manifest,
    trusted.provenance,
    trusted.budgetSha256,
  )
}

async function openEngine(
  browser: Browser,
  url: string,
  engine: Engine,
  trusted: TrustedBrowserInput,
  errors: PageFailure[],
  servedBuilds: ServedBuildEvidence[],
) {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    colorScheme: 'dark',
    serviceWorkers: 'block',
  })
  const page = await context.newPage()
  const pageErrors = observePageErrors(page, engine, errors)
  const close = async () => {
    try {
      await page.evaluate(() => window.markdownProductionProbe.dispose()).catch(() => undefined)
      await context.close()
    } finally {
      pageErrors.close()
    }
  }
  try {
    const target = new URL(url)
    target.searchParams.set('engine', engine)
    await page.goto(target.href, { waitUntil: 'load' })
    const ready = await withProductionDeadline(
      page.evaluate(() => window.markdownProductionProbe.ready),
      `${engine} parser initialization`,
    )
    pageErrors.assert()
    if (!isRecord(ready) || ready.engine !== engine)
      throw createScriptError('The production probe selected the wrong parser engine.', {
        internal: { expected: engine },
      })
    await validateServedBuild(page, engine, trusted, servedBuilds)
    const run: ProbeRunner = {
      run: async (requested, source, chunks) => {
        if (requested !== engine)
          throw createScriptError('A browser probe engine request crossed its page boundary.')
        const result = await withProductionDeadline(
          page.evaluate(
            ({ source, chunks }) => window.markdownProductionProbe.run(source, chunks),
            { source, chunks },
          ),
          `${engine} held-out run`,
          1_200_000,
        )
        pageErrors.assert()
        return result
      },
      show: async (requested, source, live) => {
        if (requested !== engine)
          throw createScriptError('A browser probe engine request crossed its page boundary.')
        const result = await withProductionDeadline(
          page.evaluate(({ source, live }) => window.markdownProductionProbe.show(source, live), {
            source,
            live,
          }),
          `${engine} held-out show`,
          1_200_000,
        )
        pageErrors.assert()
        return result
      },
    }
    return { engine, run, close }
  } catch (error) {
    await close()
    throw error
  }
}

async function openEngines(
  browser: Browser,
  url: string,
  trusted: TrustedBrowserInput,
  errors: PageFailure[],
  servedBuilds: ServedBuildEvidence[],
) {
  const sessions: Awaited<ReturnType<typeof openEngine>>[] = []
  try {
    for (const engine of ENGINES)
      sessions.push(await openEngine(browser, url, engine, trusted, errors, servedBuilds))
    return sessions
  } catch (error) {
    await Promise.all(sessions.reverse().map((session) => session.close()))
    throw error
  }
}

type BrowserExecutionOptions = {
  readonly trusted: TrustedBrowserInput
  readonly port: number
  readonly browser: BrowserKind
  readonly headed: boolean
  readonly browserArgs: readonly string[]
  readonly executablePath?: string
}

async function runProductionBrowser(
  options: BrowserExecutionOptions,
  cleanup: CleanupEvidence,
  errors: PageFailure[],
  servedBuilds: ServedBuildEvidence[],
) {
  return withBrowserLifetime(async (scope) => {
    const browserType = options.browser === 'webkit' ? webkit : chromium
    const browser = await browserType.launch({
      headless: !options.headed,
      args:
        options.browser === 'chromium'
          ? ['--enable-automation'].concat(options.browserArgs)
          : Array.from(options.browserArgs),
      executablePath: options.executablePath,
    })
    scope.own({
      name: 'browser',
      identity: { browser: options.browser },
      close: () => browser.close(),
      checks: async () => ({ disconnected: !browser.isConnected() }),
    })
    scope.checkpoint()
    const gateway = await serveMarkdownProductionProbe(options.trusted.buildDirectory, options.port)
    scope.own({
      name: 'gateway',
      identity: gateway.resources,
      close: gateway.close,
      checks: async () => ({
        listenerStopped: await listenerAbsent(gateway.url),
        workspaceAbsent: await absent(gateway.resources.workspace),
        stateHomeAbsent: await absent(gateway.resources.stateHome),
      }),
    })
    scope.checkpoint()
    return collectFromSessions(browser, gateway.url, options.trusted, errors, servedBuilds)
  }, cleanup)
}

async function collectFromSessions(
  browser: Browser,
  url: string,
  trusted: TrustedBrowserInput,
  errors: PageFailure[],
  servedBuilds: ServedBuildEvidence[],
) {
  const sessions = await openEngines(browser, url, trusted, errors, servedBuilds)
  const sessionFor = (engine: Engine) => {
    const session = sessions.find((entry) => entry.engine === engine)
    if (!session) throw createScriptError('The requested browser engine page is missing.')
    return session.run
  }
  try {
    return await collectBrowserEvaluation(trusted.input, trusted, {
      run: (engine, source, chunks) => sessionFor(engine).run(engine, source, chunks),
      show: (engine, source, live) => sessionFor(engine).show(engine, source, live),
    })
  } finally {
    await Promise.all(sessions.reverse().map((session) => session.close()))
  }
}

async function main() {
  const { values } = parseArgs({
    options: {
      input: { type: 'string' },
      build: { type: 'string' },
      out: { type: 'string' },
      'raw-out': { type: 'string' },
      port: { type: 'string' },
      browser: { type: 'string', default: 'chromium' },
      headed: { type: 'boolean', default: false },
      'browser-arg': { type: 'string', multiple: true },
      'browser-executable': { type: 'string' },
      help: { type: 'boolean' },
    },
  })
  if (values.help) {
    process.stdout.write(
      'bun scripts/markdown/evaluate-heldout-browser.ts --input browser-input.json --build BUILD --out browser-receipt.json --port PORT\n',
    )
    return
  }
  if (!values.input || !values.build || !values.out || !values.port)
    throw createScriptError('Held-out browser evaluation requires input, build, output and port.')
  const port = Number(values.port)
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw createScriptError('The held-out browser probe port is invalid.', { internal: { port } })
  if (values.browser !== 'chromium' && values.browser !== 'webkit')
    throw createScriptError('The held-out browser is unknown.', {
      internal: { browser: values.browser },
    })
  await executeBrowserInput({
    input: values.input,
    build: values.build,
    out: values.out,
    rawOut: values['raw-out'],
    port,
    browser: values.browser,
    headed: values.headed,
    browserArgs: values['browser-arg'] ?? [],
    executablePath: values['browser-executable'],
  })
}

export async function executeBrowserInput(options: {
  readonly input: string
  readonly build: string
  readonly out: string
  readonly rawOut?: string
  readonly port: number
  readonly browser: BrowserKind
  readonly headed: boolean
  readonly browserArgs: readonly string[]
  readonly executablePath?: string
}) {
  const rawOut = path.resolve(
    options.rawOut ?? path.join(path.dirname(options.out), 'raw-browser-evidence.json'),
  )
  const cleanupOut = path.join(path.dirname(rawOut), 'cleanup.json')
  await mkdir(path.dirname(path.resolve(options.out)), { recursive: true })
  await mkdir(path.dirname(rawOut), { recursive: true })
  const cleanup: CleanupEvidence = { resources: [], signals: [] }
  const pageErrors: PageFailure[] = []
  const servedBuilds: ServedBuildEvidence[] = []
  let trusted: TrustedBrowserInput | null = null
  let collection: BrowserHeldoutCollection
  try {
    trusted = await loadTrustedBrowserInput(options.input, options.build)
    collection = await runProductionBrowser(
      { ...options, trusted },
      cleanup,
      pageErrors,
      servedBuilds,
    )
  } catch (error) {
    collection = failedCollection(error, trusted)
  }
  const cleanupFailed = cleanup.resources.some(
    (resource) =>
      resource.error ||
      !resource.checks ||
      Object.values(resource.checks).some((passed) => !passed),
  )
  if (cleanupFailed || cleanup.signals.length > 0 || pageErrors.length > 0)
    collection = {
      receipt: null,
      rawEvidence: {
        ...collection.rawEvidence,
        status: 'failed',
        failures: collection.rawEvidence.failures.concat([
          'Browser lifetime, page errors, or cleanup failed.',
        ]),
      },
    }
  await writeFile(cleanupOut, encoded(cleanup), { flag: 'wx' })
  await writeFile(
    rawOut,
    encoded({
      ...collection.rawEvidence,
      frozenBuildFiles: trusted?.files ?? null,
      servedBuilds,
      pageErrors,
      cleanup,
    }),
    {
      flag: 'wx',
    },
  )
  if (collection.receipt) await writeFile(options.out, encoded(collection.receipt), { flag: 'wx' })
  process.stdout.write(
    encoded({
      status: collection.rawEvidence.status,
      receipt: collection.receipt ? path.resolve(options.out) : null,
      rawEvidence: rawOut,
      cleanup: cleanupOut,
      productionBuildSha256: trusted?.productionBuildSha256 ?? null,
      failures: collection.rawEvidence.failures.length,
    }),
  )
  if (collection.rawEvidence.status !== 'passed') process.exitCode = 1
  return collection
}

function failedCollection(
  error: unknown,
  trusted: TrustedBrowserInput | null,
): BrowserHeldoutCollection {
  const detail = errorDetails(error)
  return {
    receipt: null,
    rawEvidence: {
      schemaVersion: 1,
      status: 'failed',
      generatedAt: new Date().toISOString(),
      inputSha256: trusted?.inputSha256 ?? null,
      candidate: trusted?.input.candidate ?? null,
      batchAssetSha256: trusted?.input.batchAssetSha256 ?? null,
      productionBuildSha256: trusted?.productionBuildSha256 ?? null,
      failures: [`Browser production execution failed with ${detail.name}: ${detail.message}`],
      records: [
        {
          kind: 'failure',
          messageId: null,
          sourceSha256: null,
          scheduleId: null,
          offsets: [],
          engine: null,
          error: detail,
        },
      ],
    },
  }
}

if (import.meta.main) {
  try {
    await main()
  } catch (error) {
    process.stderr.write(`${scriptFailureText(error)}\n`)
    process.exitCode = 1
  }
}
