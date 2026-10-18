import { execFile } from 'node:child_process'
import { hash } from 'node:crypto'
import { mkdir, open, readFile, realpath, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs, promisify } from 'node:util'
import { gunzipSync } from 'node:zlib'
import {
  array,
  boolean,
  literal,
  number,
  nullable,
  object,
  parse,
  picklist,
  pipe,
  record,
  regex,
  string,
  unknown as unknownSchema,
  type InferOutput,
} from 'valibot'

import { blockToHast, createHastProcessor } from '../../packages/markdown/src/utils/hast'
import {
  createMarkdownSession,
  type MarkdownSessionFactory,
} from '../../packages/markdown/src/utils/session'
import {
  createTreeSitterMarkdownSession,
  initializeTreeSitterMarkdown,
} from '../../packages/markdown/src/utils/tree-sitter-session'
import { readyRemarkExtensions, type Observation } from '../../packages/markdown/test/qualification'
import {
  adversarialUtf16,
  everyPrefix,
  seededChunks,
  utf8Chunks,
} from '../../packages/markdown/test/schedules'
import { createScriptError } from '../structured-errors'
import { canonicalProjection, digestProjection, inspectSourceCorrespondence } from './paired-native'
import { qualificationProvenance } from './provenance'
import { encoded, stable } from './serialization'

const ROOT = fileURLToPath(new URL('../../', import.meta.url))
const execute = promisify(execFile)
const sha = pipe(string(), regex(/^[a-f0-9]{64}$/u))
const commit = pipe(string(), regex(/^[a-f0-9]{40}$/u))
const artifactsSchema = object({
  grammarSha256: sha,
  resolverSha256: sha,
  runtimeWasmSha256: sha,
  runtimeBindingSha256: sha,
  parserBindingSha256: sha,
  parserSemanticsSha256: sha,
  parserConstantsSha256: sha,
  lockfileSha256: sha,
})
const identitySchema = object({
  candidateCommit: commit,
  candidateSourceSha256: sha,
  artifacts: artifactsSchema,
})
const batchSchema = object({
  file: pipe(string(), regex(/^oasst1-batch-[0-9]{3}\.json\.gz$/u)),
  messages: literal(100),
  sourceSha256: array(sha),
  assetSha256: sha,
  uncompressedSha256: sha,
  status: picklist(['sealed', 'exposed', 'retired', 'development']),
})
const manifestSchema = object({
  schemaVersion: literal(1),
  dataset: string(),
  revision: commit,
  license: string(),
  asset: string(),
  assetSha256: sha,
  selection: string(),
  batches: array(batchSchema),
})
const messageSchema = object({
  id: string(),
  source: string(),
  sha256: sha,
  createdDate: string(),
  provenance: object({ dataset: string(), revision: commit, license: string(), url: string() }),
  split: literal('evaluation'),
})
const ledgerSchema = object({
  schemaVersion: literal(1),
  state: picklist(['exposed', 'completed', 'retired']),
  batch: batchSchema,
  manifestSha256: sha,
  candidate: identitySchema,
  exposedAt: string(),
  receiptPath: string(),
  receiptSha256: string(),
  retirementReason: string(),
})

export type CandidateIdentity = InferOutput<typeof identitySchema>
export type EvaluationBatch = InferOutput<typeof batchSchema>
export type EvaluationMessage = InferOutput<typeof messageSchema>
type Manifest = InferOutput<typeof manifestSchema>
type Ledger = InferOutput<typeof ledgerSchema>
type Root = ReturnType<typeof blockToHast>
type Extensions = Parameters<typeof createHastProcessor>[0]
type Projection = { readonly root: Root; readonly source: string }
export type EvaluationSchedule = {
  readonly id: string
  readonly profile: 'unicode' | 'utf16-adversarial' | 'utf8-transport'
  readonly offsets: readonly number[]
}
export type EvaluationCheck = {
  readonly offset: number
  readonly live: boolean
  readonly status: 'passed' | 'failed'
  readonly baselineDigest: string | null
  readonly candidateDigest: string | null
  readonly failures: readonly string[]
  readonly freshDigests: { readonly baseline: string; readonly candidate: string } | null
  readonly difference: { readonly baseline: unknown; readonly candidate: unknown } | null
}
export type EvaluationCase = {
  readonly id: string
  readonly sourceSha256: string
  readonly completed: EvaluationCheck
  readonly streams: readonly {
    readonly schedule: EvaluationSchedule
    readonly checks: readonly EvaluationCheck[]
  }[]
}
export type CheckCounts = {
  readonly total: number
  readonly passed: number
  readonly failed: number
}
export type BrowserEvaluationInput = {
  readonly schemaVersion: 1
  readonly candidate: CandidateIdentity
  readonly batchAssetSha256: string
  readonly messages: readonly {
    readonly id: string
    readonly source: string
    readonly sourceSha256: string
    readonly schedules: readonly EvaluationSchedule[]
  }[]
}
type BrowserEvaluationFrame = Omit<InferOutput<typeof browserFrameSchema>, 'observation'> & {
  readonly observation: Observation
}
export type BrowserEvaluationRow = {
  readonly id: string
  readonly sourceSha256: string
  readonly completed: readonly {
    readonly baseline: BrowserEvaluationFrame
    readonly candidate: BrowserEvaluationFrame
  }[]
  readonly streams: readonly {
    readonly scheduleId: string
    readonly observations: BrowserEvaluationRow['completed']
  }[]
}
export type BrowserEvaluationReceipt = {
  readonly candidate: CandidateIdentity
  readonly batchAssetSha256: string
  readonly productionBuildSha256: string
  readonly rows: readonly BrowserEvaluationRow[]
}
export type HeldoutReport = {
  readonly schemaVersion: 1
  readonly status: 'passed' | 'failed'
  readonly verdict: 'NOT VERIFIED'
  readonly generatedAt: string
  readonly candidate: CandidateIdentity
  readonly batch: EvaluationBatch
  readonly manifestSha256: string
  readonly originalDenominator: 100
  readonly cases: readonly EvaluationCase[]
  readonly counters: {
    readonly nativeCases: CheckCounts
    readonly streamCases: CheckCounts
    readonly browserCases: CheckCounts
  }
  readonly browser: {
    readonly inputSha256: string
    readonly receiptSha256: string | null
    readonly productionBuildSha256: string | null
    readonly receiptPath: string | null
    readonly inputPath: string
    readonly failures: readonly string[]
  }
  readonly missing: readonly string[]
  readonly fatal: string | null
}

const HELDOUT_STREAM_POLICY = {
  seededSchedules: 8,
  firstSeed: 176,
  maxUnits: 24,
  maxTransportBytes: 7,
  exhaustiveMaximumUnits: 512,
  finalChunkLive: true,
} as const

export function heldoutSchedules(source: string): EvaluationSchedule[] {
  const seeded: EvaluationSchedule[] = Array.from(
    { length: HELDOUT_STREAM_POLICY.seededSchedules },
    (_, index) => ({
      id: `seed-${HELDOUT_STREAM_POLICY.firstSeed + index}`,
      profile: 'unicode',
      offsets: Array.from(
        seededChunks(source, {
          seed: HELDOUT_STREAM_POLICY.firstSeed + index,
          maxUnits: HELDOUT_STREAM_POLICY.maxUnits,
        }),
        (frame) => frame.offset,
      ),
    }),
  )
  const transport: EvaluationSchedule = {
    id: 'utf8-byte-transport',
    profile: 'utf8-transport',
    offsets: Array.from(
      utf8Chunks(source, {
        seed: HELDOUT_STREAM_POLICY.firstSeed,
        maxBytes: HELDOUT_STREAM_POLICY.maxTransportBytes,
      }),
      (frame) => frame.offset,
    ),
  }
  if (source.length > HELDOUT_STREAM_POLICY.exhaustiveMaximumUnits)
    return seeded.concat([transport])
  return seeded.concat([
    transport,
    {
      id: 'all-unicode-prefixes',
      profile: 'unicode',
      offsets: Array.from(everyPrefix(source), (frame) => frame.offset),
    },
    {
      id: 'all-utf16-prefixes',
      profile: 'utf16-adversarial',
      offsets: Array.from(adversarialUtf16(source), (frame) => frame.offset),
    },
  ])
}

export function validateEvaluationMessages(
  value: unknown,
  manifest: Manifest,
  batch: EvaluationBatch,
): EvaluationMessage[] {
  const messages = parse(array(messageSchema), value)
  const sourceHashes = messages.map((message) => hash('sha256', message.source))
  if (
    messages.length !== 100 ||
    batch.sourceSha256.length !== 100 ||
    new Set(sourceHashes).size !== 100
  )
    throw createScriptError('Evaluation requires the complete unique 100-message batch.', {
      internal: { received: messages.length, expected: batch.messages },
    })
  for (const [index, message] of messages.entries()) {
    const expected = batch.sourceSha256[index]
    if (
      message.sha256 !== sourceHashes[index] ||
      message.sha256 !== expected ||
      message.provenance.dataset !== manifest.dataset ||
      message.provenance.revision !== manifest.revision ||
      message.provenance.license !== manifest.license
    )
      throw createScriptError('An evaluation message differs from the frozen manifest.', {
        internal: { messageIndex: index },
      })
  }
  if (new Set(messages.map((message) => message.id)).size !== 100)
    throw createScriptError('Evaluation message identities must be unique.', {
      internal: { received: messages.length },
    })
  return messages
}

function replay(factory: MarkdownSessionFactory, extensions: Extensions) {
  const session = factory()
  const processor = createHastProcessor(extensions)
  return {
    update(text: string, live: boolean): Projection {
      const blocks = session.update(text, { heal: live })
      return {
        root: {
          type: 'root',
          children: blocks.flatMap((block) => blockToHast(block, processor).children),
        },
        source: blocks.map((block) => block.source).join(''),
      }
    },
    dispose() {
      session.update('', { heal: false })
    },
  }
}

function observe(
  factory: MarkdownSessionFactory,
  extensions: Extensions,
  text: string,
  live: boolean,
): Projection {
  const current = replay(factory, extensions)
  try {
    return current.update(text, live)
  } finally {
    current.dispose()
  }
}

export function compareProjections(
  baseline: Projection,
  candidate: Projection,
  offset: number,
  live: boolean,
): EvaluationCheck {
  const baselineDigest = digestProjection(baseline.root)
  const candidateDigest = digestProjection(candidate.root)
  const failures = inspectSourceCorrespondence(baseline.root, baseline.source)
    .sourceCoordinateFailures.map((failure) => `remark: ${failure}`)
    .concat(
      inspectSourceCorrespondence(candidate.root, candidate.source).sourceCoordinateFailures.map(
        (failure) => `tree-sitter: ${failure}`,
      ),
    )
  if (baselineDigest !== candidateDigest) failures.push('Ordered safe-HAST output differs.')
  return {
    offset,
    live,
    status: failures.length ? 'failed' : 'passed',
    baselineDigest,
    candidateDigest,
    failures,
    freshDigests: null,
    difference:
      baselineDigest === candidateDigest
        ? null
        : {
            baseline: canonicalProjection(baseline.root),
            candidate: canonicalProjection(candidate.root),
          },
  }
}

function failedCheck(offset: number, live: boolean, error: unknown): EvaluationCheck {
  return {
    offset,
    live,
    status: 'failed',
    baselineDigest: null,
    candidateDigest: null,
    failures: [`Projection raised ${error instanceof Error ? error.name : typeof error}.`],
    freshDigests: null,
    difference: null,
  }
}

function frameCheck(
  text: string,
  live: boolean,
  baseline: ReturnType<typeof replay>,
  candidate: ReturnType<typeof replay>,
  extensions: Extensions,
): EvaluationCheck {
  try {
    const remark = baseline.update(text, live)
    const treeSitter = candidate.update(text, live)
    const result = compareProjections(remark, treeSitter, text.length, live)
    const failures = result.failures.concat([])
    const freshDigests = {
      baseline: digestProjection(observe(createMarkdownSession, extensions, text, live).root),
      candidate: digestProjection(
        observe(createTreeSitterMarkdownSession, extensions, text, live).root,
      ),
    }
    if (result.baselineDigest !== freshDigests.baseline)
      failures.push('Retained remark output differs from a fresh parse of this prefix.')
    if (result.candidateDigest !== freshDigests.candidate)
      failures.push('Retained candidate output differs from a fresh parse of this prefix.')
    return { ...result, freshDigests, failures, status: failures.length ? 'failed' : 'passed' }
  } catch (error) {
    return failedCheck(text.length, live, error)
  }
}

function streamCase(
  source: string,
  schedule: EvaluationSchedule,
  completed: EvaluationCheck,
  extensions: Extensions,
) {
  const baseline = replay(createMarkdownSession, extensions)
  const candidate = replay(createTreeSitterMarkdownSession, extensions)
  try {
    const checks = schedule.offsets.map((offset) =>
      frameCheck(source.slice(0, offset), true, baseline, candidate, extensions),
    )
    const settlement = frameCheck(source, false, baseline, candidate, extensions)
    const failures = settlement.failures.concat([])
    if (
      settlement.baselineDigest !== completed.baselineDigest ||
      settlement.candidateDigest !== completed.candidateDigest
    )
      failures.push('Stream settlement differs from the completed-message output.')
    checks.push({ ...settlement, failures, status: failures.length ? 'failed' : 'passed' })
    return { schedule, checks }
  } finally {
    baseline.dispose()
    candidate.dispose()
  }
}

export async function evaluateNativeMessage(message: EvaluationMessage): Promise<EvaluationCase> {
  const extensions = await readyRemarkExtensions()
  let completed: EvaluationCheck
  try {
    completed = compareProjections(
      observe(createMarkdownSession, extensions, message.source, false),
      observe(createTreeSitterMarkdownSession, extensions, message.source, false),
      message.source.length,
      false,
    )
  } catch (error) {
    completed = failedCheck(message.source.length, false, error)
  }
  const streams = heldoutSchedules(message.source).map((schedule) =>
    streamCase(message.source, schedule, completed, extensions),
  )
  return { id: message.id, sourceSha256: message.sha256, completed, streams }
}

function counts(statuses: readonly boolean[]): CheckCounts {
  const passed = statuses.filter(Boolean).length
  return { total: statuses.length, passed, failed: statuses.length - passed }
}
export function evaluationCounts(cases: readonly EvaluationCase[]) {
  return {
    nativeCases: counts(cases.map((entry) => entry.completed.status === 'passed')),
    streamCases: counts(
      cases.flatMap((entry) =>
        entry.streams.flatMap((stream) => stream.checks.map((check) => check.status === 'passed')),
      ),
    ),
  }
}

async function inspectCandidateIdentity(root: string): Promise<CandidateIdentity> {
  const require = createRequire(path.join(root, 'packages/markdown/package.json'))
  const parser = require.resolve('tree-sitter-md')
  const runtime = path.join(path.dirname(require.resolve('web-tree-sitter')), 'web-tree-sitter.js')
  const parserRequire = createRequire(parser)
  const parserRuntime = path.join(
    path.dirname(parserRequire.resolve('web-tree-sitter')),
    'web-tree-sitter.js',
  )
  const [hostRuntime, documentRuntime] = await Promise.all([
    realpath(runtime),
    realpath(parserRuntime),
  ])
  if (hostRuntime !== documentRuntime)
    throw createScriptError('The candidate and its document parser load separate runtimes.', {
      internal: { boundary: 'runtime-realm', sharedModule: false },
    })
  const files = {
    grammarSha256: require.resolve('tree-sitter-md/tree-sitter-markdown.wasm'),
    resolverSha256: require.resolve('tree-sitter-md/tree-sitter-md.wasm'),
    runtimeWasmSha256: require.resolve('web-tree-sitter/web-tree-sitter.wasm'),
    runtimeBindingSha256: runtime,
    parserBindingSha256: parser,
    parserSemanticsSha256: path.join(path.dirname(parser), 'semantic.js'),
    parserConstantsSha256: path.join(path.dirname(parser), 'constants.js'),
    lockfileSha256: path.join(root, 'bun.lock'),
  }
  const entries = await Promise.all(
    Object.entries(files).map(async ([name, file]) => [name, hash('sha256', await readFile(file))]),
  )
  const provenance = await qualificationProvenance(root)
  return parse(identitySchema, {
    candidateCommit: provenance.revision,
    candidateSourceSha256: provenance.sourceClosureSha256,
    artifacts: Object.fromEntries(entries),
  })
}

export function assertFrozenIdentity(actual: CandidateIdentity, expected: CandidateIdentity) {
  if (stable(actual) !== stable(expected))
    throw createScriptError('The candidate differs from the frozen evaluation identity.', {
      internal: { boundary: 'candidate-freeze' },
    })
}
export async function verifyCandidate(root: string, expected: CandidateIdentity) {
  const status = await execute('git', ['status', '--porcelain=v1', '--untracked-files=all'], {
    cwd: root,
  })
  if (status.stdout.trim())
    throw createScriptError('Held-out evaluation requires a clean committed checkout.', {
      internal: { dirtyEntries: status.stdout.trim().split('\n').length },
    })
  const actual = await inspectCandidateIdentity(root)
  assertFrozenIdentity(actual, expected)
  return actual
}

export async function reserveEvaluationExposure(input: {
  readonly ledgerDirectory: string
  readonly batch: EvaluationBatch
  readonly manifestSha256: string
  readonly candidate: CandidateIdentity
  readonly receiptPath: string
}): Promise<Ledger> {
  if (input.batch.status !== 'sealed')
    throw createScriptError('Choose a sealed evaluation batch.', {
      internal: { batchState: input.batch.status },
    })
  await mkdir(input.ledgerDirectory, { recursive: true })
  const ledger: Ledger = {
    schemaVersion: 1,
    state: 'exposed',
    batch: input.batch,
    manifestSha256: input.manifestSha256,
    candidate: input.candidate,
    exposedAt: new Date().toISOString(),
    receiptPath: path.resolve(input.receiptPath),
    receiptSha256: '',
    retirementReason: '',
  }
  try {
    await writeDurableExposure(ledgerPath(input.ledgerDirectory, input.batch), encoded(ledger))
  } catch (error) {
    throw createScriptError(
      'This evaluation batch already has an exposure ledger or its ledger could not be reserved.',
      {
        internal: {
          boundary: 'exposure-reservation',
          errorType: error instanceof Error ? error.name : typeof error,
        },
        fix: 'Use the next sealed batch. Preserve the existing ledger and its original denominator.',
      },
    )
  }
  return ledger
}

async function writeDurableExposure(file: string, bytes: string) {
  const handle = await open(file, 'wx')
  try {
    await handle.writeFile(bytes)
    await handle.sync()
  } finally {
    await handle.close()
  }
  if (process.platform === 'win32') return
  const directory = await open(path.dirname(file), 'r')
  try {
    await directory.sync()
  } finally {
    await directory.close()
  }
}

export async function retireEvaluationBatch(
  ledgerDirectory: string,
  batch: EvaluationBatch,
  reason: string,
) {
  const file = ledgerPath(ledgerDirectory, batch)
  const ledger = parse(ledgerSchema, JSON.parse(await readFile(file, 'utf8')))
  if (!reason.trim())
    throw createScriptError('Retiring an evaluation batch requires a reason.', {
      internal: { boundary: 'batch-retirement' },
    })
  await writeFile(file, encoded({ ...ledger, state: 'retired', retirementReason: reason }))
}
function ledgerPath(directory: string, batch: EvaluationBatch) {
  return path.join(directory, `${batch.assetSha256}.json`)
}

export function browserInput(
  messages: readonly EvaluationMessage[],
  candidate: CandidateIdentity,
  batch: EvaluationBatch,
): BrowserEvaluationInput {
  return {
    schemaVersion: 1,
    candidate,
    batchAssetSha256: batch.assetSha256,
    messages: messages.map((message) => ({
      id: message.id,
      source: message.source,
      sourceSha256: message.sha256,
      schedules: heldoutSchedules(message.source),
    })),
  }
}

const observationSchema = object({
  text: string(),
  elements: array(
    object({
      tag: string(),
      text: string(),
      attributes: record(string(), string()),
      parents: array(string()),
    }),
  ),
})
const browserFrameSchema = object({
  observation: observationSchema,
  inputSha256: sha,
  inputUtf16Units: number(),
  live: boolean(),
})
const browserPairSchema = object({ baseline: browserFrameSchema, candidate: browserFrameSchema })
const browserReceiptSchema = object({
  candidate: identitySchema,
  batchAssetSha256: sha,
  productionBuildSha256: sha,
  rows: array(
    object({
      id: string(),
      sourceSha256: sha,
      completed: array(browserPairSchema),
      streams: array(object({ scheduleId: string(), observations: array(browserPairSchema) })),
    }),
  ),
})
const browserInputSchema = object({
  schemaVersion: literal(1),
  candidate: identitySchema,
  batchAssetSha256: sha,
  messages: array(
    object({
      id: string(),
      source: string(),
      sourceSha256: sha,
      schedules: array(
        object({
          id: string(),
          profile: picklist(['unicode', 'utf16-adversarial', 'utf8-transport']),
          offsets: array(number()),
        }),
      ),
    }),
  ),
})
export function parseBrowserInput(value: unknown): BrowserEvaluationInput {
  return parse(browserInputSchema, value)
}
export function parseBrowserReceipt(value: unknown): BrowserEvaluationReceipt {
  return parse(browserReceiptSchema, value)
}

export function validateBrowserEvaluation(
  input: BrowserEvaluationInput,
  receipt: BrowserEvaluationReceipt,
) {
  receipt = parseBrowserReceipt(receipt)
  assertFrozenIdentity(receipt.candidate, input.candidate)
  if (
    receipt.batchAssetSha256 !== input.batchAssetSha256 ||
    !/^[a-f0-9]{64}$/u.test(receipt.productionBuildSha256)
  )
    throw createScriptError(
      'The browser evaluation lacks its frozen batch or production build identity.',
      { internal: { boundary: 'browser-evaluation-identity' } },
    )
  const failures: string[] = []
  const statuses: boolean[] = []
  for (const message of input.messages) {
    const matches = receipt.rows.filter(
      (row) => row.id === message.id && row.sourceSha256 === message.sourceSha256,
    )
    const row = matches[0]
    if (matches.length !== 1 || !row) {
      failures.push(`Message ${message.id} has no unique browser receipt.`)
      statuses.push(false)
      continue
    }
    const before = failures.length
    checkBrowserMessage(row, message, failures)
    statuses.push(before === failures.length)
  }
  if (receipt.rows.length !== input.messages.length)
    failures.push('The browser receipt changes the original message denominator.')
  return { cases: counts(statuses), failures }
}
function checkBrowserMessage(
  row: BrowserEvaluationRow,
  message: BrowserEvaluationInput['messages'][number],
  failures: string[],
) {
  checkBrowserPairs(
    row.completed,
    [{ source: message.source, live: false }],
    `${message.id}/completed`,
    failures,
  )
  for (const schedule of message.schedules) {
    const streams = row.streams.filter((stream) => stream.scheduleId === schedule.id)
    const stream = streams[0]
    if (streams.length !== 1 || !stream) {
      failures.push(`${message.id}/${schedule.id} has no unique stream receipt.`)
      continue
    }
    checkBrowserPairs(
      stream.observations,
      schedule.offsets
        .map((offset) => ({ source: message.source.slice(0, offset), live: true }))
        .concat([{ source: message.source, live: false }]),
      `${message.id}/${schedule.id}`,
      failures,
    )
    const completed = row.completed[0]
    const settlement = stream.observations.at(-1)
    if (
      completed &&
      settlement &&
      (stable(completed.baseline.observation) !== stable(settlement.baseline.observation) ||
        stable(completed.candidate.observation) !== stable(settlement.candidate.observation))
    )
      failures.push(`${message.id}/${schedule.id} settlement differs from fresh completed output.`)
  }
  if (row.streams.length !== message.schedules.length)
    failures.push(`${message.id} has an unexpected browser schedule denominator.`)
}

function checkBrowserPairs(
  pairs: BrowserEvaluationRow['completed'],
  expected: readonly { readonly source: string; readonly live: boolean }[],
  label: string,
  failures: string[],
) {
  if (pairs.length !== expected.length)
    failures.push(`${label} has an incomplete frame denominator.`)
  for (const [index, pair] of pairs.entries()) {
    const frame = expected[index]
    if (
      !frame ||
      !matchesBrowserFrame(pair.baseline, frame) ||
      !matchesBrowserFrame(pair.candidate, frame)
    )
      failures.push(
        `${label} frame ${index} has incorrect source, prefix, UTF-16 length, or live provenance.`,
      )
    if (stable(pair.baseline.observation) !== stable(pair.candidate.observation))
      failures.push(`${label} frame ${index} differs or lacks an observation.`)
  }
}

function matchesBrowserFrame(
  frame: BrowserEvaluationFrame,
  expected: { readonly source: string; readonly live: boolean },
) {
  return (
    frame.inputSha256 === hash('sha256', expected.source) &&
    frame.inputUtf16Units === expected.source.length &&
    frame.live === expected.live
  )
}

async function attachBrowserEvaluation(input: {
  readonly root: string
  readonly receiptPath: string
  readonly ledgerDirectory: string
  readonly browserReceiptPath: string
  readonly productionBuildSha256: string
  readonly outputPath: string
}) {
  const reportBytes = await readFile(input.receiptPath)
  const report = parseReport(JSON.parse(reportBytes.toString('utf8')))
  await trustedLedger(input, report, reportBytes)
  const browserInputBytes = await readFile(report.browser.inputPath)
  if (hash('sha256', browserInputBytes) !== report.browser.inputSha256)
    throw createScriptError('The frozen browser input has changed.', {
      internal: { boundary: 'browser-input-digest' },
    })
  const request = parseBrowserInput(JSON.parse(browserInputBytes.toString('utf8')))
  validateTrustedInput(request, report)
  const browserBytes = await readFile(input.browserReceiptPath)
  const receipt = parseBrowserReceipt(JSON.parse(browserBytes.toString('utf8')))
  if (receipt.productionBuildSha256 !== input.productionBuildSha256)
    throw createScriptError('The browser receipt differs from its frozen production build.', {
      internal: { boundary: 'browser-build' },
    })
  const observed = validateBrowserEvaluation(request, receipt)
  const combined: HeldoutReport = {
    ...report,
    status:
      report.status === 'passed' && observed.cases.failed === 0 && observed.failures.length === 0
        ? 'passed'
        : 'failed',
    counters: { ...report.counters, browserCases: observed.cases },
    browser: {
      ...report.browser,
      receiptSha256: hash('sha256', browserBytes),
      receiptPath: path.resolve(input.browserReceiptPath),
      productionBuildSha256: receipt.productionBuildSha256,
      failures: observed.failures,
    },
    missing: report.missing.filter((field) => !field.startsWith('Actual AssistantMarkdown')),
  }
  const combinedBytes = encoded(combined)
  await writeFile(input.outputPath, combinedBytes, { flag: 'wx' })
  const ledger = parse(
    ledgerSchema,
    JSON.parse(await readFile(ledgerPath(input.ledgerDirectory, report.batch), 'utf8')),
  )
  await writeFile(
    ledgerPath(input.ledgerDirectory, report.batch),
    encoded({
      ...ledger,
      receiptPath: path.resolve(input.outputPath),
      receiptSha256: hash('sha256', combinedBytes),
    }),
  )
  return combined
}

async function trustedLedger(
  input: { readonly root: string; readonly receiptPath: string; readonly ledgerDirectory: string },
  report: HeldoutReport,
  bytes: Uint8Array,
) {
  if (report.fatal !== null)
    throw createScriptError('An interrupted or invalid evaluation cannot certify a candidate.', {
      internal: { boundary: 'trusted-evaluation-fatal' },
    })
  await verifyCandidate(input.root, report.candidate)
  const ledger = parse(
    ledgerSchema,
    JSON.parse(await readFile(ledgerPath(input.ledgerDirectory, report.batch), 'utf8')),
  )
  if (
    ledger.state !== 'completed' ||
    ledger.receiptSha256 !== hash('sha256', bytes) ||
    path.resolve(ledger.receiptPath) !== path.resolve(input.receiptPath) ||
    ledger.manifestSha256 !== report.manifestSha256 ||
    stable(ledger.batch) !== stable(report.batch)
  )
    throw createScriptError(
      'The evaluation receipt does not match a completed unretired exposure ledger.',
      { internal: { boundary: 'trusted-evaluation-ledger', state: ledger.state } },
    )
  assertFrozenIdentity(ledger.candidate, report.candidate)
  const manifestBytes = await readFile(
    path.join(input.root, 'packages/markdown/test/evaluation/manifest.json'),
  )
  const manifest = parse(manifestSchema, JSON.parse(manifestBytes.toString('utf8')))
  if (
    hash('sha256', manifestBytes) !== report.manifestSha256 ||
    stable(manifest.batches.find((batch) => batch.file === report.batch.file)) !==
      stable(report.batch)
  )
    throw createScriptError('The current evaluation manifest differs from its frozen receipt.', {
      internal: { boundary: 'trusted-evaluation-manifest' },
    })
  return ledger
}

export async function readTrustedEvaluationContext(input: {
  readonly root: string
  readonly receiptPath: string
  readonly ledgerDirectory: string
}) {
  const bytes = await readFile(input.receiptPath)
  const report = parseReport(JSON.parse(bytes.toString('utf8')))
  await trustedLedger(input, report, bytes)
  const browserInputBytes = await readFile(report.browser.inputPath)
  if (hash('sha256', browserInputBytes) !== report.browser.inputSha256)
    throw createScriptError('The frozen browser input has changed.', {
      internal: { boundary: 'trusted-browser-input' },
    })
  const request = parseBrowserInput(JSON.parse(browserInputBytes.toString('utf8')))
  validateTrustedInput(request, report)
  if (report.browser.receiptPath) {
    const browserBytes = await readFile(report.browser.receiptPath)
    if (hash('sha256', browserBytes) !== report.browser.receiptSha256)
      throw createScriptError('The attached browser evidence has changed.', {
        internal: { boundary: 'trusted-browser-receipt' },
      })
    const browser = parseBrowserReceipt(JSON.parse(browserBytes.toString('utf8')))
    const observed = validateBrowserEvaluation(request, browser)
    if (
      stable(observed.cases) !== stable(report.counters.browserCases) ||
      stable(observed.failures) !== stable(report.browser.failures) ||
      browser.productionBuildSha256 !== report.browser.productionBuildSha256
    )
      throw createScriptError('Browser counters disagree with the attached evidence.', {
        internal: { boundary: 'trusted-browser-counts' },
      })
  } else if (report.counters.browserCases.passed !== 0)
    throw createScriptError('Browser passing counts require actual browser evidence.', {
      internal: { boundary: 'trusted-browser-missing' },
    })
  return {
    selectedBatch: {
      id: report.batch.file,
      assetSha256: report.batch.assetSha256,
      manifestSha256: report.manifestSha256,
      messages: 100 as const,
    },
    candidateIdentity: {
      candidateCommit: report.candidate.candidateCommit,
      candidateSourceSha256: report.candidate.candidateSourceSha256,
      grammarSha256: report.candidate.artifacts.grammarSha256,
      resolverSha256: report.candidate.artifacts.resolverSha256,
      lockfileSha256: report.candidate.artifacts.lockfileSha256,
    },
    exposure: {
      state: 'completed' as const,
      sameCandidate: true as const,
      retired: false as const,
    },
    requiredChecks: report.counters,
    artifact: { path: path.resolve(input.receiptPath), sha256: hash('sha256', bytes) },
  }
}

function validateTrustedInput(request: BrowserEvaluationInput, report: HeldoutReport) {
  assertFrozenIdentity(request.candidate, report.candidate)
  if (
    request.batchAssetSha256 !== report.batch.assetSha256 ||
    request.messages.length !== 100 ||
    stable(request.messages.map((message) => message.sourceSha256)) !==
      stable(report.batch.sourceSha256)
  )
    throw createScriptError('The browser input changes the frozen batch denominator.', {
      internal: { boundary: 'trusted-browser-denominator' },
    })
  for (const [index, message] of request.messages.entries()) {
    const entry = report.cases[index]
    if (
      !entry ||
      entry.id !== message.id ||
      hash('sha256', message.source) !== message.sourceSha256 ||
      stable(message.schedules) !== stable(heldoutSchedules(message.source)) ||
      stable(entry.streams.map((stream) => stream.schedule)) !== stable(message.schedules)
    )
      throw createScriptError('Evaluation schedules differ from the frozen raw input.', {
        internal: { boundary: 'trusted-evaluation-schedules', messageIndex: index },
      })
  }
}

const checkSchema = object({
  offset: number(),
  live: boolean(),
  status: picklist(['passed', 'failed']),
  baselineDigest: pickDigest(),
  candidateDigest: pickDigest(),
  failures: array(string()),
  freshDigests: nullable(object({ baseline: sha, candidate: sha })),
  difference: nullable(object({ baseline: unknownSchema(), candidate: unknownSchema() })),
})
const scheduleSchema = object({
  id: string(),
  profile: picklist(['unicode', 'utf16-adversarial', 'utf8-transport']),
  offsets: array(number()),
})
const countSchema = object({ total: number(), passed: number(), failed: number() })
const caseSchema = object({
  id: string(),
  sourceSha256: sha,
  completed: checkSchema,
  streams: array(object({ schedule: scheduleSchema, checks: array(checkSchema) })),
})
const nullableString = pickNullableString()
const reportSchema = object({
  schemaVersion: literal(1),
  status: picklist(['passed', 'failed']),
  verdict: literal('NOT VERIFIED'),
  generatedAt: string(),
  candidate: identitySchema,
  batch: batchSchema,
  manifestSha256: sha,
  originalDenominator: literal(100),
  cases: array(caseSchema),
  counters: object({
    nativeCases: countSchema,
    streamCases: countSchema,
    browserCases: countSchema,
  }),
  browser: object({
    inputSha256: string(),
    receiptSha256: nullableString,
    productionBuildSha256: nullableString,
    receiptPath: nullableString,
    inputPath: string(),
    failures: array(string()),
  }),
  missing: array(string()),
  fatal: nullableString,
})
function pickDigest() {
  return nullable(sha)
}
function pickNullableString() {
  return nullable(string())
}
export function parseReport(value: unknown): HeldoutReport {
  const report = parse(reportSchema, value)
  for (const counter of Object.values(report.counters)) {
    if (
      !Number.isSafeInteger(counter.total) ||
      !Number.isSafeInteger(counter.passed) ||
      !Number.isSafeInteger(counter.failed) ||
      counter.total < 0 ||
      counter.passed < 0 ||
      counter.failed < 0 ||
      counter.passed + counter.failed !== counter.total
    )
      throw createScriptError('The held-out receipt has inconsistent counts.', {
        internal: { boundary: 'evaluation-counts' },
      })
  }
  if (
    report.cases.length !== 100 ||
    report.counters.nativeCases.total !== 100 ||
    report.counters.browserCases.total !== 100 ||
    new Set(report.cases.map((entry) => entry.id)).size !== 100 ||
    stable(report.cases.map((entry) => entry.sourceSha256)) !== stable(report.batch.sourceSha256)
  )
    throw createScriptError('The held-out receipt changes the original denominator.', {
      internal: { boundary: 'evaluation-denominator' },
    })
  const observed = evaluationCounts(report.cases)
  if (
    stable(observed.nativeCases) !== stable(report.counters.nativeCases) ||
    stable(observed.streamCases) !== stable(report.counters.streamCases)
  )
    throw createScriptError('The held-out counters disagree with actual checks.', {
      internal: { boundary: 'evaluation-observed-counts' },
    })
  for (const entry of report.cases) validateCaseChecks(entry)
  return report
}
function validateCaseChecks(entry: EvaluationCase) {
  if (
    entry.streams.filter((stream) =>
      /^seed-(?:176|177|178|179|180|181|182|183)$/u.test(stream.schedule.id),
    ).length !== 8 ||
    !entry.streams.some((stream) => stream.schedule.id === 'utf8-byte-transport') ||
    new Set(entry.streams.map((stream) => stream.schedule.id)).size !== entry.streams.length
  )
    throw createScriptError('A held-out message omits its frozen stream schedules.', {
      internal: { boundary: 'evaluation-stream-denominator' },
    })
  const checks = [entry.completed].concat(entry.streams.flatMap((stream) => stream.checks))
  for (const check of checks) {
    const passed =
      check.baselineDigest !== null &&
      check.baselineDigest === check.candidateDigest &&
      check.failures.length === 0 &&
      (!check.freshDigests ||
        (check.freshDigests.baseline === check.baselineDigest &&
          check.freshDigests.candidate === check.candidateDigest))
    if ((check.status === 'passed') !== passed)
      throw createScriptError('A held-out check contradicts its output evidence.', {
        internal: { boundary: 'evaluation-check-status' },
      })
  }
  for (const stream of entry.streams) {
    if (
      stream.checks.length !== stream.schedule.offsets.length + 1 ||
      stream.checks.some(
        (check, index) =>
          check.offset !== (stream.schedule.offsets[index] ?? entry.completed.offset) ||
          check.live !== index < stream.schedule.offsets.length,
      )
    )
      throw createScriptError('A held-out stream omits scheduled prefix observations.', {
        internal: { boundary: 'evaluation-stream-frames' },
      })
  }
}

async function main() {
  const { values } = parseArgs({
    options: {
      'candidate-commit': { type: 'string' },
      'artifact-manifest': { type: 'string' },
      batch: { type: 'string' },
      ledger: { type: 'string' },
      out: { type: 'string' },
      fingerprint: { type: 'boolean' },
      help: { type: 'boolean' },
      'attach-browser': { type: 'string' },
      'native-receipt': { type: 'string' },
      'production-build-sha256': { type: 'string' },
      'retire-batch': { type: 'string' },
      reason: { type: 'string' },
    },
  })
  if (values.help) {
    process.stdout.write(
      'bun scripts/markdown/evaluate-heldout.ts --candidate-commit SHA --artifact-manifest FILE --batch oasst1-batch-001.json.gz --ledger DIRECTORY --out DIRECTORY\n--fingerprint prints current metadata without opening evaluation content.\n',
    )
    return
  }
  if (values.fingerprint) {
    process.stdout.write(encoded(await inspectCandidateIdentity(ROOT)))
    return
  }
  if (values['retire-batch']) {
    if (!values.ledger || !values.reason)
      throw createScriptError('Batch retirement requires --ledger and --reason.', {
        internal: { boundary: 'retirement-arguments' },
      })
    const manifest = parse(
      manifestSchema,
      JSON.parse(
        await readFile(path.join(ROOT, 'packages/markdown/test/evaluation/manifest.json'), 'utf8'),
      ),
    )
    const selected = manifest.batches.find((batch) => batch.file === values['retire-batch'])
    if (!selected)
      throw createScriptError('Choose a manifest batch to retire.', {
        internal: { boundary: 'retirement-batch' },
      })
    await retireEvaluationBatch(values.ledger, selected, values.reason)
    return
  }
  if (values['attach-browser']) {
    if (
      !values['candidate-commit'] ||
      !values['native-receipt'] ||
      !values.ledger ||
      !values.out ||
      !values['production-build-sha256']
    )
      throw createScriptError(
        'Browser attachment needs an explicit candidate, native receipt, ledger, production build digest and output file.',
        { internal: { boundary: 'browser-attachment-arguments' } },
      )
    const native = parseReport(JSON.parse(await readFile(values['native-receipt'], 'utf8')))
    if (native.candidate.candidateCommit !== values['candidate-commit'])
      throw createScriptError('The explicit candidate differs from its native receipt.', {
        internal: { boundary: 'browser-attachment-commit' },
      })
    const report = await attachBrowserEvaluation({
      root: ROOT,
      receiptPath: values['native-receipt'],
      ledgerDirectory: values.ledger,
      browserReceiptPath: values['attach-browser'],
      productionBuildSha256: values['production-build-sha256'],
      outputPath: values.out,
    })
    process.stdout.write(
      encoded({
        status: report.status,
        verdict: report.verdict,
        evidence: values.out,
        ...report.counters,
      }),
    )
    process.exitCode = report.status === 'passed' ? 0 : 1
    return
  }
  if (
    !values['candidate-commit'] ||
    !values['artifact-manifest'] ||
    !values.batch ||
    !values.ledger ||
    !values.out
  )
    throw createScriptError(
      'Held-out evaluation requires an explicit candidate, artifact freeze, batch, ledger and output.',
      { internal: { boundary: 'evaluation-arguments' } },
    )
  const frozen = parse(
    identitySchema,
    JSON.parse(await readFile(values['artifact-manifest'], 'utf8')),
  )
  if (frozen.candidateCommit !== values['candidate-commit'])
    throw createScriptError('The explicit candidate commit differs from the artifact freeze.', {
      internal: { boundary: 'evaluation-commit' },
    })
  await verifyCandidate(ROOT, frozen)
  const manifestFile = path.join(ROOT, 'packages/markdown/test/evaluation/manifest.json')
  const manifestBytes = await readFile(manifestFile)
  const manifest = parse(manifestSchema, JSON.parse(manifestBytes.toString('utf8')))
  const batch = manifest.batches.find((entry) => entry.file === values.batch)
  if (!batch || batch.sourceSha256.length !== 100)
    throw createScriptError('Choose a complete batch from the frozen manifest.', {
      internal: { boundary: 'evaluation-batch' },
    })
  await initializeTreeSitterMarkdown()
  await readyRemarkExtensions()
  const output = path.resolve(values.out)
  await mkdir(output, { recursive: true })
  const receiptPath = path.join(output, 'heldout-native.json')
  await verifyCandidate(ROOT, frozen)
  const ledger = await reserveEvaluationExposure({
    ledgerDirectory: path.resolve(values.ledger),
    batch,
    manifestSha256: hash('sha256', manifestBytes),
    candidate: frozen,
    receiptPath,
  })
  const cases: EvaluationCase[] = []
  let browserInputSha256 = ''
  let fatal: string | null = null
  try {
    const compressed = await readFile(path.join(path.dirname(manifestFile), batch.file))
    if (hash('sha256', compressed) !== batch.assetSha256)
      throw createScriptError('The sealed batch asset differs from its frozen digest.', {
        internal: { boundary: 'evaluation-asset' },
      })
    const bytes = gunzipSync(compressed)
    if (hash('sha256', bytes) !== batch.uncompressedSha256)
      throw createScriptError('The opened batch differs from its frozen payload digest.', {
        internal: { boundary: 'evaluation-payload' },
      })
    const messages = validateEvaluationMessages(JSON.parse(bytes.toString('utf8')), manifest, batch)
    const inputBytes = encoded(browserInput(messages, frozen, batch))
    browserInputSha256 = hash('sha256', inputBytes)
    await writeFile(path.join(output, 'browser-input.json'), inputBytes, { flag: 'wx' })
    for (const message of messages) cases.push(await evaluateNativeMessage(message))
    await verifyCandidate(ROOT, frozen)
  } catch (error) {
    fatal = `Evaluation stopped at ${error instanceof Error ? error.name : typeof error}.`
  }
  const observed = evaluationCounts(cases)
  const report: HeldoutReport = {
    schemaVersion: 1,
    status:
      fatal || observed.nativeCases.failed || observed.streamCases.failed || cases.length !== 100
        ? 'failed'
        : 'passed',
    verdict: 'NOT VERIFIED',
    generatedAt: new Date().toISOString(),
    candidate: frozen,
    batch,
    manifestSha256: ledger.manifestSha256,
    originalDenominator: 100,
    cases,
    counters: {
      ...observed,
      nativeCases: {
        total: 100,
        passed: observed.nativeCases.passed,
        failed: 100 - observed.nativeCases.passed,
      },
      browserCases: { total: 100, passed: 0, failed: 100 },
    },
    browser: {
      inputSha256: browserInputSha256,
      receiptSha256: null,
      productionBuildSha256: null,
      receiptPath: null,
      inputPath: path.join(output, 'browser-input.json'),
      failures: [],
    },
    missing: [
      'Actual AssistantMarkdown production-browser observations for every frozen source and schedule',
      'Workspace-backed link/image activation and interactive safety/lifetime gates',
      'Paired promotion timing, payload, timeline and resource gates',
    ],
    fatal,
  }
  const receipt = encoded(report)
  await writeFile(receiptPath, receipt, { flag: 'wx' })
  await writeFile(
    ledgerPath(values.ledger, batch),
    encoded({ ...ledger, state: 'completed', receiptSha256: hash('sha256', receipt) }),
  )
  process.stdout.write(
    encoded({
      evidence: output,
      originalDenominator: 100,
      ...report.counters,
      status: report.status,
      verdict: report.verdict,
    }),
  )
  process.exitCode = report.status === 'passed' ? 0 : 1
}

if (import.meta.main) await main()
