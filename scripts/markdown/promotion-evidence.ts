import { createHash } from 'node:crypto'
import { readFile, realpath, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { parseArgs } from 'node:util'
import {
  createTrustedPromotionContext,
  evaluatePromotion,
  FROZEN_SCENARIOS,
  frozenBudgetSha256,
  PROMOTION_GATES,
  verifyPromotionArtifacts,
  type PromotionComparison,
  type PromotionEvidence,
  type PromotionReceipt,
  type PromotionResult,
  type TrustedPromotionOptions,
} from './promotion'
import {
  parseBrowserInput,
  parseBrowserReceipt,
  parseReport,
  validateBrowserEvaluation,
  type HeldoutReport,
} from './evaluate-heldout'
import { BENCHMARK_FAMILIES } from './workloads'
import { reconcileTimingManifest, type TimingFreeze } from './production-reconciliation'
import { productionResourcePlateau } from './production-analysis'
import * as v from 'valibot'
import {
  MARKDOWN_CASES,
  VISUAL_STORY_IDS,
  WEBKIT_CRITICAL_IDS,
} from '../../packages/markdown/test/fixtures/cases'
import { isRecord, stable } from './serialization'
import { checkRunExitCode } from './check-exit'
import {
  rasterRecords,
  readBitmap,
  pixelDifference,
  nonblankPixels,
  type Calibration,
  type Bitmap,
} from './raster'
import { reconcileNativeResources } from './native-resource-evidence'
import { createScriptError } from '../structured-errors'
import { hashFile } from './timing-artifacts'

type TimingReconciliationResult = Awaited<ReturnType<typeof reconcileTimingManifest>>
type RecordValue = { readonly [key: string]: unknown }
type Gate = (typeof PROMOTION_GATES)[number]
type ReportKind =
  | 'qualification'
  | 'heldout'
  | 'paired-native'
  | 'production-browser'
  | 'paired-raster'
  | 'native-resources'
  | 'benchmark'
type Metric = PromotionComparison['metric']
type ReceiptStatus = PromotionReceipt['status']
type RawEngine = 'remark' | 'tree-sitter'
type RawQualification = {
  readonly engine: RawEngine
  readonly path: string
  readonly rows: readonly RecordValue[]
  readonly error: string | null
}
type FrameEvidence = {
  readonly path: string
  readonly rows: readonly RecordValue[]
  readonly error: string | null
}
type RawEvidence = {
  readonly tests: readonly RawQualification[]
  readonly frames: readonly FrameEvidence[]
}

type ArtifactRef = { readonly path: string; readonly sha256: string; readonly byteLength?: number }
type LoadedReport = {
  readonly path: string
  readonly value: RecordValue | null
  readonly error: string | null
  readonly sha256: string | null
}
type LoadedReports = ReadonlyMap<ReportKind, LoadedReport>
type Observation = {
  readonly selected: number
  readonly attempted: number
  readonly complete: number
  readonly failed: number
  readonly skipped: number
  readonly metrics: Readonly<Record<string, number | boolean | string>>
  readonly comparisons: readonly PromotionComparison[]
  readonly status: ReceiptStatus
  readonly reason: string | null
  readonly failures: readonly string[]
  readonly exclusions: readonly string[]
}

const ZERO_SHA256 = '0'.repeat(64)
export type PromotionEvidenceAssemblyManifest = {
  readonly schemaVersion: 1
  readonly evidenceDirectory: string
  readonly identity: PromotionEvidence['identity']
  readonly nativeWorkloads: PromotionEvidence['nativeWorkloads']
  readonly expectedWorkloads: PromotionEvidence['expectedWorkloads']
  readonly reports: Partial<Record<ReportKind, string>>
  readonly browserReceipt?: string
  readonly artifacts?: Partial<Record<Gate, readonly string[]>>
  readonly rawQualificationReports?: readonly {
    readonly engine: RawEngine
    readonly path: string
  }[]
  readonly frameLogs?: readonly string[]
  readonly frozenProvenance?: TimingFreeze['provenance']
  readonly fontFingerprint?: string
  readonly timingManifests?: Partial<Record<'production' | 'native', string>>
  readonly trustedContext?: Omit<TrustedPromotionOptions, 'evidenceDirectory'>
}

type GateAssemblyReport = {
  readonly gate: Gate
  readonly report: string | null
  readonly selected: number
  readonly attempted: number
  readonly complete: number
  readonly failed: number
  readonly skipped: number
  readonly status: ReceiptStatus
  readonly reason: string | null
  readonly failures: readonly string[]
  readonly exclusions: readonly string[]
}

type PromotionEvidenceAssemblyReport = {
  readonly schemaVersion: 1
  readonly verdict: PromotionResult['verdict']
  readonly findings: readonly string[]
  readonly gates: readonly GateAssemblyReport[]
  readonly artifacts: readonly ArtifactRef[]
  readonly timing: readonly TimingReconciliationResult[]
}

export type PromotionEvidenceAssemblyResult = {
  readonly evidence: PromotionEvidence
  readonly report: PromotionEvidenceAssemblyReport
  readonly validation: PromotionResult
}

const EMPTY: Observation = {
  selected: 0,
  attempted: 0,
  complete: 0,
  failed: 0,
  skipped: 0,
  metrics: {},
  comparisons: [],
  status: 'inconclusive',
  reason: null,
  failures: [],
  exclusions: [],
}

function get(value: RecordValue, key: string): unknown {
  return value[key]
}
function record(value: RecordValue, key: string): RecordValue | null {
  const found = get(value, key)
  return isRecord(found) ? found : null
}
function stringValue(value: RecordValue, key: string): string | null {
  const found = get(value, key)
  return typeof found === 'string' ? found : null
}
function numberValue(value: RecordValue, key: string): number | null {
  const found = get(value, key)
  return typeof found === 'number' && Number.isFinite(found) ? found : null
}
function booleanValue(value: RecordValue, key: string): boolean | null {
  const found = get(value, key)
  return typeof found === 'boolean' ? found : null
}
function list(value: unknown): readonly unknown[] {
  return Array.isArray(value) ? value : []
}
function strings(value: unknown): string[] {
  return list(value).filter((entry): entry is string => typeof entry === 'string')
}
function count(value: unknown): number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : 0
}
function metric(value: unknown): value is Metric {
  return (
    value === 'updateP95' ||
    value === 'settlementP95' ||
    value === 'mountP95' ||
    value === 'streamCpu'
  )
}
function metrics(value: unknown): readonly Metric[] {
  return list(value).filter(metric)
}
function mergeStrings(first: readonly string[], second: readonly string[]): readonly string[] {
  return first.concat(second)
}

function observation(input: {
  readonly selected: number
  readonly attempted: number
  readonly complete: number
  readonly failed?: number
  readonly skipped?: number
  readonly metrics?: Readonly<Record<string, number | boolean | string>>
  readonly comparisons?: readonly PromotionComparison[]
  readonly reason?: string | null
  readonly failures?: readonly string[]
  readonly exclusions?: readonly string[]
  readonly forceInconclusive?: boolean
}): Observation {
  const failed = input.failed ?? 0
  const skipped = input.skipped ?? Math.max(0, input.selected - input.complete)
  const status: ReceiptStatus =
    failed > 0
      ? 'failed'
      : input.forceInconclusive
        ? 'inconclusive'
        : input.selected > 0 && input.complete >= input.selected && skipped === 0
          ? 'complete'
          : 'inconclusive'
  return {
    selected: input.selected,
    attempted: input.attempted,
    complete: input.complete,
    failed,
    skipped,
    metrics: input.metrics ?? {},
    comparisons: input.comparisons ?? [],
    status,
    reason: input.reason ?? null,
    failures: input.failures ?? [],
    exclusions: input.exclusions ?? [],
  }
}
function missing(reason: string): Observation {
  return { ...EMPTY, reason }
}
function invalid(reason: string, failures: readonly string[] = []): Observation {
  return { ...EMPTY, status: 'failed', reason, failures }
}
function combine(first: Observation, second: Observation): Observation {
  return observation({
    selected: first.selected + second.selected,
    attempted: first.attempted + second.attempted,
    complete: first.complete + second.complete,
    failed: first.failed + second.failed,
    skipped: first.skipped + second.skipped,
    metrics: { ...first.metrics, ...second.metrics },
    comparisons: first.comparisons.concat(second.comparisons),
    reason: first.reason ?? second.reason,
    failures: mergeStrings(first.failures, second.failures),
    exclusions: mergeStrings(first.exclusions, second.exclusions),
    forceInconclusive: first.status === 'inconclusive' || second.status === 'inconclusive',
  })
}
function countMetrics(value: Observation): Readonly<Record<string, number | boolean | string>> {
  return {
    ...value.metrics,
    selectedCases: value.selected,
    attemptedCases: value.attempted,
    completeCases: value.complete,
    failedCases: value.failed,
    skippedCases: value.skipped,
  }
}

function runObservation(report: RecordValue, names: readonly string[]): Observation {
  const runs = list(get(report, 'runs')).filter(isRecord)
  const selected = runs.filter((run) => names.includes(stringValue(run, 'name') ?? ''))
  if (selected.length === 0)
    return missing(`No actual qualification run matched: ${names.join(', ')}.`)
  const observations = selected.map((run) => {
    const declared = count(get(run, 'tests'))
    const passed = count(get(run, 'passed'))
    const failed = count(get(run, 'failed'))
    const pending = count(get(run, 'pending'))
    const todo = count(get(run, 'todo'))
    const accounted = passed + failed + pending + todo
    if (accounted > declared)
      return invalid('Qualification run counters are inconsistent.', strings(get(run, 'failures')))
    return observation({
      selected: declared,
      attempted: passed + failed,
      complete: passed + failed,
      failed: failed + (numberValue(run, 'exitCode') !== 0 && failed === 0 ? 1 : 0),
      metrics:
        passed === declared &&
        failed === 0 &&
        pending === 0 &&
        todo === 0 &&
        numberValue(run, 'exitCode') === 0
          ? { unexplainedDifferences: 0 }
          : {},
      skipped: pending + todo + Math.max(0, declared - accounted),
      failures: strings(get(run, 'failures')).concat(
        stringValue(run, 'log') ? [stringValue(run, 'log') ?? ''] : [],
      ),
    })
  })
  const first = observations[0]
  if (!first) return missing(`No actual qualification run matched: ${names.join(', ')}.`)
  return observations.slice(1).reduce(combine, first)
}

function candidateObservation(report: LoadedReport | undefined): Observation {
  if (!report) return missing('Candidate qualification report is missing.')
  if (!report.value) return invalid(report.error ?? 'Candidate qualification report is invalid.')
  const candidate = record(report.value, 'candidate')
  const checks = candidate ? record(candidate, 'semanticChecks') : null
  const observed = candidate ? record(candidate, 'observedCapabilities') : null
  if (!candidate || !checks || !observed) return invalid('Candidate inspection is incomplete.')
  const metrics = Object.fromEntries(
    ['commonmark', 'gfm', 'math', 'footnotes', 'cjkFlanking'].map((name) => [
      name,
      booleanValue(observed, name) === true,
    ]),
  )
  const executed = count(get(checks, 'executed'))
  const failed = count(get(checks, 'failed'))
  return observation({
    selected: 8,
    attempted: executed,
    complete: Math.max(0, executed - failed),
    failed,
    skipped: Math.max(0, 8 - executed),
    metrics,
    failures: strings(get(checks, 'findings')),
    reason:
      stringValue(candidate, 'status') === 'available-unqualified'
        ? null
        : 'Candidate is unavailable.',
    forceInconclusive: stringValue(candidate, 'status') !== 'available-unqualified',
  })
}

function qualificationObservation(
  report: LoadedReport | undefined,
  names: readonly string[],
): Observation {
  if (!report) return missing('Qualification report is missing.')
  if (!report.value) return invalid(report.error ?? 'Qualification report is invalid.')
  if (get(report.value, 'schemaVersion') !== 1)
    return invalid('Qualification report has unsupported schema.')
  return runObservation(report.value, names)
}

function heldoutObservations(
  report: HeldoutReport | null,
  reportError: string | null,
  browserReceipt: RecordValue | null,
  browserInput: RecordValue | null,
): {
  readonly native: Observation
  readonly browser: Observation
  readonly stream: Observation
} {
  if (!report) {
    const value = reportError
      ? invalid(reportError)
      : missing('Held-out evaluation report is missing.')
    return { native: value, browser: value, stream: value }
  }
  const native = observation({
    selected: 100,
    attempted: report.counters.nativeCases.total,
    complete: report.counters.nativeCases.passed + report.counters.nativeCases.failed,
    failed: report.counters.nativeCases.failed,
    skipped: Math.max(0, 100 - report.counters.nativeCases.total),
    metrics: {
      batchId: report.batch.file,
      batchAssetSha256: report.batch.assetSha256,
      ...(report.counters.nativeCases.total === 100 &&
      report.counters.nativeCases.passed === 100 &&
      report.counters.nativeCases.failed === 0 &&
      report.fatal === null
        ? { unexplainedDifferences: 0 }
        : {}),
    },
    failures: report.missing.concat(report.fatal ? [report.fatal] : []),
  })
  const stream = observation({
    selected: 100,
    attempted: report.counters.streamCases.total,
    complete: report.counters.streamCases.passed + report.counters.streamCases.failed,
    failed: report.counters.streamCases.failed,
    skipped: Math.max(0, 100 - report.counters.streamCases.total),
    failures: report.missing,
  })
  if (!browserReceipt || !browserInput)
    return {
      native,
      stream,
      browser: missing('Held-out browser input or receipt is missing.'),
    }
  try {
    const input = parseBrowserInput(browserInput)
    const receipt = parseBrowserReceipt(browserReceipt)
    const evaluated = validateBrowserEvaluation(input, receipt)
    return {
      native,
      stream,
      browser: observation({
        selected: 100,
        attempted: evaluated.cases.total,
        complete: evaluated.cases.passed + evaluated.cases.failed,
        failed: evaluated.cases.failed,
        skipped: Math.max(0, 100 - evaluated.cases.total),
        metrics: {
          batchAssetSha256: receipt.batchAssetSha256,
          batchId: report.batch.file,
          ...(evaluated.cases.total === 100 &&
          evaluated.cases.passed === 100 &&
          evaluated.failures.length === 0
            ? { unexplainedDifferences: 0 }
            : {}),
          productionBuildSha256: receipt.productionBuildSha256,
        },
        failures: evaluated.failures,
      }),
    }
  } catch (failure) {
    return {
      native,
      stream,
      browser: invalid(`Held-out browser evidence is invalid: ${errorText(failure)}`),
    }
  }
}

function visualObservation(report: LoadedReport | undefined): Observation {
  if (!report) return missing('Paired raster report is missing.')
  if (!report.value) return invalid(report.error ?? 'Paired raster report is invalid.')
  const rawRows = list(get(report.value, 'compared'))
  const rows = rawRows.filter(isRecord)
  const failures = strings(get(report.value, 'findings'))
  const failed = rows.filter((row) => stringValue(row, 'status') !== 'passed').length
  const parserArms = new Set<string>()
  const themes = new Set<string>()
  const widths = new Set<number>()
  for (const row of rows) {
    const key = stringValue(row, 'key')
    if (!key) continue
    const parsed = parseVisualKey(key)
    if (!parsed) continue
    themes.add(parsed.theme)
    widths.add(parsed.width)
    addParserArm(parserArms, get(row, 'baseline'))
    addParserArm(parserArms, get(row, 'candidate'))
  }
  const required = visualStateKeys()
  const keys = rows.map((row) => stringValue(row, 'key'))
  if (
    rawRows.length !== rows.length ||
    rows.length !== required.length ||
    new Set(keys).size !== required.length ||
    !required.every((key) => keys.includes(key))
  )
    failures.push(
      'Visual matrix requires exact Chromium 128 and critical WebKit 32 fixture/profile states.',
    )
  const chromiumRows = rows.filter(
    (row) => parseVisualKey(stringValue(row, 'key') ?? '')?.browser === 'chromium',
  )
  const webkitRows = rows.filter(
    (row) => parseVisualKey(stringValue(row, 'key') ?? '')?.browser === 'webkit',
  )
  const controlsPassed = booleanValue(report.value, 'controlsPassed') === true
  const pairedEngineCount = parserArms.size
  return observation({
    selected: 128,
    attempted: chromiumRows.length,
    complete: chromiumRows.length,
    failed,
    skipped: Math.max(0, 128 - chromiumRows.length),
    metrics: {
      ...(numberValue(report.value, 'unexplainedChangedStates') === failed
        ? { unexplainedChangedStates: failed }
        : {}),
      rasterControlsCalibrated: failures.length === 0 && controlsPassed,
      pairedEngineCount,
      webkitCriticalStates: webkitRows.length,
      themeCount: themes.size,
      viewportWidthCount: widths.size,
    },
    failures,
    reason:
      pairedEngineCount === 2
        ? null
        : 'Paired raster rows do not expose both remark and tree-sitter image identities.',
    forceInconclusive: pairedEngineCount !== 2 || failures.length > 0,
  })
}
function visualStateKeys(): string[] {
  return VISUAL_STORY_IDS.flatMap((fixture) => visualProfileKeys(fixture, 'chromium')).concat(
    WEBKIT_CRITICAL_IDS.flatMap((fixture) => visualProfileKeys(fixture, 'webkit')),
  )
}
function visualProfileKeys(fixture: string, browser: 'chromium' | 'webkit'): string[] {
  return [390, 1440].flatMap((width) =>
    ['light', 'dark'].map((theme) => JSON.stringify([fixture, browser, width, theme])),
  )
}
function addParserArm(arms: Set<string>, value: unknown): void {
  if (typeof value !== 'string') return
  const normalized = value.replaceAll('\\', '/')
  if (/(?:^|[\\/_-])remark(?:[-_.\\/]|$)/u.test(normalized)) arms.add('remark')
  if (/(?:^|[\\/_-])tree-sitter(?:[-_.\\/]|$)/u.test(normalized)) arms.add('tree-sitter')
}
function parseVisualTuple(value: string): readonly unknown[] | null {
  try {
    const result: unknown = JSON.parse(value)
    return Array.isArray(result) ? result : null
  } catch {
    return null
  }
}
function parseVisualKey(value: string): {
  readonly browser: string
  readonly width: number
  readonly theme: string
} | null {
  try {
    const parsed: unknown = JSON.parse(value)
    if (!Array.isArray(parsed) || parsed.length !== 4) return null
    const browser = parsed[1]
    const width = parsed[2]
    const theme = parsed[3]
    return typeof browser === 'string' && typeof width === 'number' && typeof theme === 'string'
      ? { browser, width, theme }
      : null
  } catch {
    return null
  }
}

function timingObservation(
  kind: 'production' | 'native',
  result: TimingReconciliationResult | null,
  manifest: PromotionEvidenceAssemblyManifest,
): Observation {
  if (!result) return missing(`${kind}: timing report or frozen provenance is missing.`)
  const measured = result.samples.filter((sample) => !sample.warmup)
  const pairIds = new Set(measured.map((sample) => `${sample.workload}/${sample.pair}`))
  const completePairs = Array.from(pairIds).filter(
    (key) => measured.filter((sample) => `${sample.workload}/${sample.pair}` === key).length === 2,
  ).length
  const failures = result.findings
    .filter((finding) => finding.kind !== 'missing')
    .map((finding) => `${finding.path}: ${finding.reason}`)
  const findings = result.findings.map((finding) => `${finding.path}: ${finding.reason}`)
  const selected =
    kind === 'native'
      ? manifest.nativeWorkloads.length * 20
      : manifest.expectedWorkloads.length * 20
  const metrics = Object.fromEntries(
    Object.entries(result.metrics).filter(
      (entry): entry is [string, number | string | boolean] => entry[1] !== null,
    ),
  )
  if (kind === 'native' && result.verdict === 'VERIFIED') metrics.unmeasuredMandatoryCells = 0
  return observation({
    selected,
    attempted: pairIds.size,
    complete: completePairs,
    failed: failures.length,
    skipped: Math.max(0, selected - completePairs),
    metrics: { ...metrics, timingStatus: result.timingStatus },
    comparisons: result.comparisons,
    failures: findings.concat(strings(result.rawFailures)),
    exclusions: result.exclusions.map(
      (entry) => `${entry.workload}/${entry.pair}/${entry.engine}/${entry.metric}: ${entry.reason}`,
    ),
    reason: result.verdict === 'VERIFIED' ? null : `${result.timingStatus}: ${findings.join('; ')}`,
    forceInconclusive: result.verdict !== 'VERIFIED',
  })
}

function resourceObservation(
  report: LoadedReport | undefined,
  timing: TimingReconciliationResult | undefined,
  scenarios: Observation,
  nativeReport: LoadedReport | undefined,
): Observation {
  const browser = browserResourceObservation(report, timing, scenarios)
  const native = reconcileNativeResources(nativeReport?.value)
  return observation({
    ...browser,
    failed: browser.failed + native.failures.length,
    failures: browser.failures.concat(native.failures),
    exclusions: browser.exclusions.concat(native.exclusions),
    metrics: { ...browser.metrics, nativeResourcesReconciled: native.complete },
    reason:
      browser.reason ??
      (native.complete ? null : 'Native resource evidence is incomplete or failed.'),
    forceInconclusive: browser.status !== 'complete' || !native.complete,
  })
}
function browserResourceObservation(
  report: LoadedReport | undefined,
  timing: TimingReconciliationResult | undefined,
  scenarios: Observation,
): Observation {
  if (!report) return missing('Resource report is missing.')
  if (!report.value) return invalid(report.error ?? 'Resource report is invalid.')
  const rows = list(get(report.value, 'resourcePlateaus')).filter(isRecord)
  const rawTrials = timing?.resourceTrials ?? []
  const required = [20, 100, 500]
  const failures = strings(get(report.value, 'failures'))
  const rowResults = rows.map((row) => reconcileResourceRow(row, rawTrials))
  const positive = rowResults.filter((entry) => entry.positive)
  const cycles = new Set(
    required.filter((cycle) =>
      (['remark', 'tree-sitter'] as const).every((engine) =>
        positive.some(
          (entry) => entry.cycle === cycle && stringValue(entry.row, 'engine') === engine,
        ),
      ),
    ),
  )
  const complete = cycles.size
  const statusFailures = rowResults.flatMap((entry) => entry.failures)
  const exclusions = rowResults.flatMap((entry) => entry.exclusions)
  const observedGrowth = positive
    .map((entry) => booleanValue(entry.row, 'observedPersistentGrowth'))
    .filter((value): value is boolean => value !== null)
  const candidateRows = positive.filter(
    (entry) => stringValue(entry.row, 'engine') === 'tree-sitter',
  )
  const observedReuse = candidateRows
    .map((entry) => booleanValue(entry.row, 'observedWasmHighWaterReuse'))
    .filter((value): value is boolean => value !== null)
  const metrics: Record<string, number | boolean | string> = {}
  if (positive.length > 0 && observedGrowth.length === positive.length)
    metrics.persistentGrowthAfterCachePlateau = observedGrowth.some(Boolean) ? 1 : 0
  if (candidateRows.length > 0 && observedReuse.length === candidateRows.length)
    metrics.wasmHighWaterReused = observedReuse.every(Boolean)
  if (complete === required.length) metrics.cachePlateauReached = true
  for (const cycle of cycles) metrics[`disposedCycles-${cycle}`] = cycle
  const allPositive =
    complete === required.length && positive.length === rows.length && exclusions.length === 0
  const statusFailureCount = statusFailures.length
  const reason = allPositive
    ? null
    : 'Resource evidence needs positive OBSERVED_PLATEAU rows for cycles 20/100/500 with matching six-window raw trial/control receipts.'
  return observation({
    selected: 3,
    attempted: rows.length,
    complete,
    failed: failures.length + statusFailureCount + scenarios.failed,
    skipped: Math.max(0, 3 - complete, scenarios.skipped),
    metrics: { ...metrics, ...scenarios.metrics },
    failures: failures.concat(statusFailures, scenarios.failures),
    exclusions: exclusions.concat(scenarios.exclusions),
    reason: reason ?? scenarios.reason,
    forceInconclusive:
      !allPositive || timing?.verdict !== 'VERIFIED' || scenarios.status !== 'complete',
  })
}
type ResourceRowResult = {
  readonly row: RecordValue
  readonly cycle: number
  readonly positive: boolean
  readonly failures: readonly string[]
  readonly exclusions: readonly string[]
}
const resourceNumber = v.pipe(v.number(), v.finite(), v.minValue(0))
const nullableResource = v.nullable(resourceNumber)
const controlWindowSchema = v.object({
  cycles: resourceNumber,
  elapsedMs: resourceNumber,
  jsHeapUsedBeforeBytes: nullableResource,
  jsHeapUsedAfterBytes: nullableResource,
  backingStorageBeforeBytes: nullableResource,
  backingStorageAfterBytes: nullableResource,
})
const resourceWindowSchema = v.object({
  ...controlWindowSchema.entries,
  parserWasmReservedBeforeBytes: nullableResource,
  parserWasmReservedAfterBytes: nullableResource,
  jsHeapReservedBeforeBytes: nullableResource,
  jsHeapReservedAfterBytes: nullableResource,
  queryObserversBefore: resourceNumber,
  queryObserversAfter: resourceNumber,
  retainedMessageNodes: resourceNumber,
  simultaneousMessages: resourceNumber,
  peakWasmReservedBytes: nullableResource,
  peakMessageNodes: resourceNumber,
})
function reconcileResourceRow(
  row: RecordValue,
  rawTrials: TimingReconciliationResult['resourceTrials'],
): ResourceRowResult {
  const workload = stringValue(row, 'workload') ?? 'unknown'
  const engine = stringValue(row, 'engine')
  const cycle = resourceCycle(row)
  const id = `${workload}/${engine}/pair-${numberValue(row, 'pair')}`
  const failures: string[] = []
  const exclusions: string[] = []
  const matches = rawTrials.filter(
    (trial) =>
      trial.workload === workload && trial.engine === engine && trial.pair === get(row, 'pair'),
  )
  const trial = matches[0]
  if (!trial || matches.length !== 1 || (engine !== 'remark' && engine !== 'tree-sitter'))
    return {
      row,
      cycle,
      positive: false,
      failures: [`${id}: missing, duplicate or invalid raw trial identity.`],
      exclusions,
    }
  const windows = v.safeParse(v.array(resourceWindowSchema), trial.resourceWindows)
  const controls = v.safeParse(v.array(controlWindowSchema), trial.resourceControlWindows)
  if (!windows.success || !controls.success)
    return {
      row,
      cycle,
      positive: false,
      failures: [`${id}: resource/control observations are invalid or incomplete.`],
      exclusions,
    }
  const derived = productionResourcePlateau(
    windows.output,
    controls.output,
    engine === 'tree-sitter',
  )
  for (const [key, value] of Object.entries(derived)) {
    if (key === 'reason') continue
    if (JSON.stringify(get(row, key)) !== JSON.stringify(value))
      failures.push(`${id}: ${key} differs from actual raw windows.`)
  }
  if (derived.status === 'NOT VERIFIED') failures.push(`${id}: ${derived.reason}`)
  if (derived.status === 'INCONCLUSIVE') exclusions.push(`${id}: ${derived.reason}`)
  if (
    windows.output.some((window) => window.cycles !== cycle) ||
    controls.output.some((window) => window.cycles !== cycle)
  )
    failures.push(`${id}: window cycles differ from workload.`)
  const positive = derived.status === 'OBSERVED_PLATEAU' && failures.length === 0 && cycle > 0
  return { row, cycle, positive, failures, exclusions }
}
function resourceCycle(row: RecordValue): number {
  const workload = stringValue(row, 'workload') ?? ''
  const match = /(?:^|-)cycles-(\d+)(?:-|$)/u.exec(workload)
  return match?.[1] ? Number(match[1]) : 0
}

function benchmarkObservation(
  report: LoadedReport | undefined,
  timing: TimingReconciliationResult | undefined,
): Observation {
  if (!report) return missing('Benchmark report is missing.')
  if (!report.value) return invalid(report.error ?? 'Benchmark report is invalid.')
  const coverage = list(get(report.value, 'familyCoverage')).filter(isRecord)
  const trials = timing?.coverage ?? []
  const cellsFor = (family: string) =>
    Array.from(
      new Set(trials.filter((row) => row.family === family).map((row) => row.workload)),
    ).filter((id) =>
      ['remark', 'tree-sitter'].every((engine) =>
        trials.some((row) => row.workload === id && row.engine === engine),
      ),
    ).length
  const complete = BENCHMARK_FAMILIES.filter((family) => cellsFor(family) > 0).length
  const failures = strings(get(report.value, 'failures')).concat(
    strings(get(report.value, 'missing')),
  )
  const metrics = Object.fromEntries(
    BENCHMARK_FAMILIES.flatMap((family) => {
      const row = coverage.find((entry) => stringValue(entry, 'family') === family)
      const cells = cellsFor(family)
      if (!row || count(get(row, 'pairedObservedCells')) !== cells)
        failures.push(`${family}: paired family summary differs from actual raw workload cells.`)
      return [
        [`${family}.measuredCells`, cells],
        [`${family}.missingFields`, cells > 0 ? 0 : 1],
        [`${family}.domain`, 'browser'],
        [`${family}.build`, 'production'],
      ]
    }),
  )
  return observation({
    selected: BENCHMARK_FAMILIES.length,
    attempted: coverage.length,
    complete,
    failed: failures.length,
    skipped: Math.max(0, BENCHMARK_FAMILIES.length - complete),
    metrics,
    failures,
    reason:
      timing?.verdict === 'VERIFIED'
        ? null
        : 'Benchmark family coverage requires reconciled production raw trials.',
    forceInconclusive:
      timing?.verdict !== 'VERIFIED' || timing.timingStatus !== 'PROMOTION_CAPTURE_RECONCILED',
  })
}

const NATIVE_STREAM_IDS = MARKDOWN_CASES.filter((fixture) => fixture.checkpoints.length > 0).map(
  (fixture) => fixture.id,
)
const BROWSER_STREAM_IDS = FROZEN_SCENARIOS['frame-probes'] ?? []
const NATIVE_REMARK_STREAM_SUFFIX =
  ': named live checkpoints match independent product expectations'
const NATIVE_TREE_STREAM_SUFFIX =
  ' paints all live checkpoints and settles to fresh candidate output'
const BROWSER_STREAM_SUFFIX = ' paints every named prefix and settles to the completed result'

type StreamAssertionKind = 'native' | 'browser'
type StreamAssertion = {
  readonly kind: StreamAssertionKind
  readonly id: string
  readonly engine: RawEngine
  readonly status: string
}

function streamingObservation(report: LoadedReport | undefined, raw: RawEvidence): Observation {
  if (report && !report.value) return invalid(report.error ?? 'Qualification report is invalid.')
  if (raw.tests.length === 0) return missing('Streaming raw assertion reports are missing.')
  const assertions = raw.tests.flatMap((entry) =>
    entry.rows.flatMap((row) => parseStreamAssertion(row, entry.engine)),
  )
  const failures = raw.tests.flatMap((entry) =>
    entry.error ? [`streaming-correctness: ${entry.path} is unreadable: ${entry.error}`] : [],
  )
  const engines = new Set(raw.tests.map((entry) => entry.engine))
  if (engines.size !== 2)
    failures.push('streaming-correctness: exactly two engine reports are required.')
  const native = streamCases(assertions, 'native', NATIVE_STREAM_IDS)
  const browser = streamCases(assertions, 'browser', BROWSER_STREAM_IDS)
  const frame = streamFrameCases(raw, BROWSER_STREAM_IDS)
  failures.push(...native.failures, ...browser.failures, ...frame.failures)
  const complete = native.complete + browser.complete
  const failed = native.failed + browser.failed
  const attempted = native.attempted + browser.attempted
  const allComplete =
    complete === NATIVE_STREAM_IDS.length + BROWSER_STREAM_IDS.length && failures.length === 0
  const metrics: Record<string, number | boolean | string> = {}
  if (frame.observed) metrics.lostRevisions = frame.lostRevisions
  if (allComplete) {
    metrics.staleCompletionReceipts = 0
    metrics.unexplainedDifferences = 0
  }
  return observation({
    selected: NATIVE_STREAM_IDS.length + BROWSER_STREAM_IDS.length,
    attempted,
    complete,
    failed,
    skipped: NATIVE_STREAM_IDS.length + BROWSER_STREAM_IDS.length - complete,
    metrics,
    failures,
    exclusions: native.exclusions.concat(browser.exclusions),
    reason: allComplete
      ? null
      : 'Streaming evidence requires every frozen native and browser case to pass on both engines with frame receipts.',
    forceInconclusive: !allComplete,
  })
}

function parseStreamAssertion(row: RecordValue, engine: RawEngine): StreamAssertion[] {
  const title = stringValue(row, 'title')
  const name = assertionName(row)
  if (!title || !name) return []
  const nativeSuffix = engine === 'remark' ? NATIVE_REMARK_STREAM_SUFFIX : NATIVE_TREE_STREAM_SUFFIX
  const kind = title.endsWith(BROWSER_STREAM_SUFFIX)
    ? 'browser'
    : title.endsWith(nativeSuffix)
      ? 'native'
      : null
  if (!kind) return []
  const suite =
    kind === 'browser'
      ? 'real chat prefix projection '
      : engine === 'tree-sitter'
        ? 'Tree-sitter actual product semantics '
        : ''
  if (name !== suite + title) return []
  const suffix = kind === 'browser' ? BROWSER_STREAM_SUFFIX : nativeSuffix
  const id = title.slice(0, -suffix.length)
  return id ? [{ kind, id, engine, status: assertionStatus(row) }] : []
}

type StreamCases = {
  readonly complete: number
  readonly attempted: number
  readonly failed: number
  readonly failures: readonly string[]
  readonly exclusions: readonly string[]
}

function streamCases(
  assertions: readonly StreamAssertion[],
  kind: StreamAssertionKind,
  required: readonly string[],
): StreamCases {
  const failures: string[] = []
  const exclusions: string[] = []
  let complete = 0
  let attempted = 0
  let failed = 0
  for (const id of required) {
    const rows = assertions.filter((entry) => entry.kind === kind && entry.id === id)
    const passing = rows.filter((entry) => entry.status === 'passed')
    const failedRows = rows.filter((entry) => entry.status === 'failed')
    const skippedRows = rows.filter((entry) => isSkippedStatus(entry.status))
    const engines = new Set(rows.map((entry) => entry.engine))
    attempted += rows.length > 0 ? 1 : 0
    failed += failedRows.length > 0 ? 1 : 0
    if (failedRows.length > 0) failures.push(`${kind}: failed streaming assertion ${id}.`)
    if (skippedRows.length > 0) exclusions.push(`${kind}: skipped streaming assertion ${id}.`)
    if (rows.length === 0) failures.push(`${kind}: missing streaming assertion ${id}.`)
    if (rows.length !== 2 || engines.size !== 2)
      failures.push(`${kind}: streaming assertion ${id} is not paired across both engines.`)
    if (passing.length === 2 && failedRows.length === 0 && skippedRows.length === 0) complete += 1
  }
  return { complete, attempted, failed, failures, exclusions }
}

type StreamFrameCases = {
  readonly observed: boolean
  readonly lostRevisions: number
  readonly failures: readonly string[]
}

function streamFrameCases(raw: RawEvidence, required: readonly string[]): StreamFrameCases {
  if (raw.frames.length === 0)
    return {
      observed: false,
      lostRevisions: 0,
      failures: ['browser: frame logs are missing.'],
    }
  const rows = raw.frames.flatMap((entry) => entry.rows)
  const failures = raw.frames.flatMap((entry) =>
    entry.error ? [`browser: frame log ${entry.path} is unreadable: ${entry.error}`] : [],
  )
  let lostRevisions = 0
  for (const fixture of required) {
    const matches = rows.filter((row) => stringValue(row, 'fixture') === fixture)
    const valid = (['remark', 'tree-sitter'] as const).every(
      (engine) => matches.filter((row) => validStreamFrame(row, engine)).length === 1,
    )
    if (!valid) failures.push(`browser: missing complete frame receipt for ${fixture}.`)
    lostRevisions += missingFrameRevisions(matches)
  }
  return { observed: true, lostRevisions, failures }
}

function missingFrameRevisions(rows: readonly RecordValue[]): number {
  return (['remark', 'tree-sitter'] as const).reduce((sum, engine) => {
    const row = rows.find((entry) => stringValue(entry, 'engine') === engine)
    if (!row) return sum
    const revisions = new Set(list(get(row, 'observedRevisions')))
    return sum + Math.max(0, count(get(row, 'requiredRevisions')) - revisions.size)
  }, 0)
}
function validStreamFrame(row: RecordValue, engine: RawEngine): boolean {
  const revisions = list(get(row, 'observedRevisions'))
  const frames = list(get(row, 'frames')).filter(isRecord)
  const required = count(get(row, 'requiredRevisions'))
  const fixture = MARKDOWN_CASES.find((entry) => entry.id === get(row, 'fixture'))
  if (!fixture || fixture.checkpoints.length !== required) return false
  return (
    stringValue(row, 'engine') === engine &&
    required > 0 &&
    count(get(row, 'observedFrames')) === frames.length &&
    frames.length > 0 &&
    revisions.length === new Set(revisions).size &&
    revisions.every(
      (value) =>
        typeof value === 'number' &&
        Number.isSafeInteger(value) &&
        value > 0 &&
        frames.some((frame) => get(frame, 'revision') === value),
    ) &&
    Array.from({ length: required }, (_, index) => index + 1).every((value) =>
      revisions.includes(value),
    )
  )
}

function scenarioObservation(
  report: LoadedReport | undefined,
  raw: RawEvidence,
  gate: 'interactions' | 'safety' | 'resources',
): Observation {
  if (report && !report.value) return invalid(report.error ?? `${gate} report is invalid.`)
  if (raw.tests.length === 0) return missing(`${gate} raw assertion reports are missing.`)
  const scenarios = FROZEN_SCENARIOS[gate] ?? []
  const failures: string[] = []
  const exclusions: string[] = []
  const metrics: Record<string, number | boolean | string> = {}
  let complete = 0
  let failed = 0
  let attempted = 0
  for (const name of scenarios) {
    const engineRows = raw.tests.flatMap((testReport) =>
      testReport.rows
        .filter((row) => assertionName(row) === name)
        .map((row) => ({ engine: testReport.engine, row })),
    )
    const rows = engineRows.map((entry) => entry.row)
    const paired = rows.length === 2 && new Set(engineRows.map((entry) => entry.engine)).size === 2
    attempted += rows.filter((row) => {
      const status = assertionStatus(row)
      return status === 'passed' || status === 'failed'
    }).length
    const passed = rows.filter((row) => assertionStatus(row) === 'passed')
    const failedRows = rows.filter((row) => assertionStatus(row) === 'failed')
    const skipped = rows.filter((row) => isSkippedStatus(assertionStatus(row)))
    metrics[`scenario.${name}.executed`] = paired && passed.length === 2 ? 1 : 0
    metrics[`scenario.${name}.failed`] = failedRows.length
    if (rows.length === 0) failures.push(`${gate}: missing exact scenario ${name}.`)
    if (!paired) failures.push(`${gate}: scenario ${name} must occur once per engine.`)
    if (failedRows.length > 0) failures.push(`${gate}: failed scenario ${name}.`)
    if (skipped.length > 0) exclusions.push(`${gate}: skipped scenario ${name}.`)
    if (paired && passed.length === 2) complete += 1
    failed += failedRows.length
  }
  const rawErrors = raw.tests.flatMap((entry) =>
    entry.error
      ? [`${gate}: ${entry.engine} raw assertion report is unreadable: ${entry.error}`]
      : [],
  )
  failures.push(...rawErrors)
  const allEngines = new Set(raw.tests.map((entry) => entry.engine)).size === 2
  if (!allEngines) failures.push(`${gate}: exactly two raw engine assertion reports are required.`)
  const allComplete =
    complete === scenarios.length && failures.length === 0 && exclusions.length === 0
  if (allComplete && gate !== 'resources') {
    metrics.lostSelections = 0
    metrics.incorrectClipboardPayloads = 0
    metrics.unsafeActivations = 0
    metrics.isolationFailures = 0
  }
  return observation({
    selected: scenarios.length,
    attempted,
    complete,
    failed,
    skipped: scenarios.length - complete,
    metrics,
    failures,
    exclusions,
    reason: allComplete ? null : `${gate}: raw named scenario evidence is incomplete.`,
    forceInconclusive: !allComplete,
  })
}
function resourceScenarioRaw(
  manifest: PromotionEvidenceAssemblyManifest,
  reports: LoadedReports,
  raw: RawEvidence,
): RawEvidence {
  const runs = list(get(reports.get('qualification')?.value ?? {}, 'runs')).filter(isRecord)
  return {
    ...raw,
    tests: raw.tests.filter((entry) => {
      const run = runs.filter((run) => get(run, 'name') === `browser-${entry.engine}-qualify`)
      return (
        run.length === 1 &&
        stringValue(run[0] ?? {}, 'rawReport') !== null &&
        normalizedArtifact(
          manifest.evidenceDirectory,
          stringValue(run[0] ?? {}, 'rawReport') ?? '',
        ) === normalizedArtifact(manifest.evidenceDirectory, entry.path)
      )
    }),
  }
}
const FRAME_ASSERTIONS = [
  'retains settled code state and every painted token color through append and completion',
  'the frame palette check rejects a changed color with the same token count',
  'never paints held heading markers or removes settled prose during release',
] as const
function frameObservation(report: LoadedReport | undefined, raw: RawEvidence): Observation {
  if (report && !report.value) return invalid(report.error ?? 'Frame-probe report is invalid.')
  const frameIds = FROZEN_SCENARIOS['frame-probes'] ?? []
  const frameProof = streamFrameCases(raw, frameIds)
  const assertionProof = pairedAssertions(
    raw,
    FRAME_ASSERTIONS.map((title) => `real chat prefix projection ${title}`),
  )
  const rows = raw.frames.flatMap((log) => log.rows)
  const complete = frameIds.filter((fixture) =>
    (['remark', 'tree-sitter'] as const).every(
      (engine) =>
        rows.filter(
          (row) => stringValue(row, 'fixture') === fixture && validStreamFrame(row, engine),
        ).length === 1,
    ),
  ).length
  const failures = frameProof.failures.concat(assertionProof.failures)
  const metrics: Record<string, number | boolean | string> = {}
  for (const fixture of frameIds) {
    const paired = (['remark', 'tree-sitter'] as const).every(
      (engine) =>
        rows.filter(
          (row) => stringValue(row, 'fixture') === fixture && validStreamFrame(row, engine),
        ).length === 1,
    )
    metrics[`scenario.${fixture}.executed`] = paired ? 1 : 0
    metrics[`scenario.${fixture}.failed`] = paired ? 0 : 1
  }
  const positive = failures.length === 0 && complete === frameIds.length
  if (positive) {
    metrics.contentFlashes = 0
    metrics.settledFenceColorDrops = 0
  }
  return observation({
    selected: frameIds.length,
    attempted: rows.length,
    complete,
    failed: assertionProof.failed,
    skipped: frameIds.length - complete,
    metrics,
    failures,
    exclusions: assertionProof.exclusions,
    reason: positive
      ? null
      : 'Frame-probe receipts or exact palette/content assertions are incomplete.',
    forceInconclusive: !positive,
  })
}
function pairedAssertions(raw: RawEvidence, names: readonly string[]) {
  const failures: string[] = []
  const exclusions: string[] = []
  let failed = 0
  for (const name of names) {
    const matches = raw.tests.flatMap((entry) =>
      entry.rows
        .filter((row) => assertionName(row) === name)
        .map((row) => ({ engine: entry.engine, status: assertionStatus(row) })),
    )
    const paired = matches.length === 2 && new Set(matches.map((entry) => entry.engine)).size === 2
    if (!paired || matches.some((entry) => entry.status !== 'passed'))
      failures.push(`Missing, duplicate or nonpassing paired assertion: ${name}`)
    failed += matches.filter((entry) => entry.status === 'failed').length
    exclusions.push(
      ...matches
        .filter((entry) => isSkippedStatus(entry.status))
        .map((entry) => `${entry.engine}: ${entry.status}: ${name}`),
    )
  }
  return { failures, exclusions, failed }
}
function assertionName(row: RecordValue): string | null {
  return stringValue(row, 'fullName')
}
function assertionStatus(row: RecordValue): string {
  return stringValue(row, 'status') ?? 'missing'
}
function isSkippedStatus(status: string): boolean {
  return status === 'pending' || status === 'skipped' || status === 'todo' || status === 'disabled'
}

function reportForGate(gate: Gate): ReportKind {
  if (
    gate === 'candidate-capabilities' ||
    gate === 'native-development-semantics' ||
    gate === 'browser-development-semantics' ||
    gate === 'streaming-correctness' ||
    gate === 'interactions' ||
    gate === 'safety' ||
    gate === 'frame-probes'
  )
    return 'qualification'
  if (gate === 'native-heldout-semantics' || gate === 'browser-heldout-semantics') return 'heldout'
  if (gate === 'visual-states') return 'paired-raster'
  if (gate === 'resources' || gate === 'production-timing' || gate === 'benchmark-coverage')
    return 'production-browser'
  return 'paired-native'
}

function observeGate(
  gate: Gate,
  reports: LoadedReports,
  manifest: PromotionEvidenceAssemblyManifest,
  heldout: ReturnType<typeof heldoutObservations>,
  raw: RawEvidence,
  timing: ReadonlyMap<'production' | 'native', TimingReconciliationResult>,
): Observation {
  const report = reports.get(reportForGate(gate))
  switch (gate) {
    case 'candidate-capabilities':
      return candidateObservation(report)
    case 'native-development-semantics':
      return qualificationObservation(report, ['package-tree-sitter'])
    case 'browser-development-semantics':
      return qualificationObservation(report, ['browser-tree-sitter-qualify'])
    case 'native-heldout-semantics':
      return heldout.native
    case 'browser-heldout-semantics':
      return heldout.browser
    case 'streaming-correctness':
      return streamingObservation(report, raw)
    case 'interactions':
    case 'safety':
      return scenarioObservation(report, raw, gate)
    case 'frame-probes':
      return frameObservation(report, raw)
    case 'visual-states':
      return visualObservation(reports.get('paired-raster'))
    case 'resources':
      return resourceObservation(
        reports.get('production-browser'),
        timing.get('production'),
        scenarioObservation(
          reports.get('qualification'),
          resourceScenarioRaw(manifest, reports, raw),
          'resources',
        ),
        reports.get('native-resources'),
      )
    case 'benchmark-coverage':
      return benchmarkObservation(
        reports.get('production-browser') ?? reports.get('benchmark'),
        timing.get('production'),
      )
    case 'native-paired':
      return timingObservation('native', timing.get('native') ?? null, manifest)
    case 'production-timing':
      return timingObservation('production', timing.get('production') ?? null, manifest)
  }
}

function artifactPaths(
  manifest: PromotionEvidenceAssemblyManifest,
  gate: Gate,
  report: string | null,
): readonly string[] {
  const configured = manifest.artifacts?.[gate] ?? []
  const raw =
    gate === 'interactions' || gate === 'safety' || gate === 'resources'
      ? (manifest.rawQualificationReports ?? []).map((entry) => entry.path)
      : gate === 'frame-probes'
        ? (manifest.frameLogs ?? [])
        : []
  const source = report ? [report] : raw.length > 0 ? [] : [`missing/${gate}.report.json`]
  return source.concat(configured, raw)
}

function referencedArtifacts(
  manifest: PromotionEvidenceAssemblyManifest,
  reports: LoadedReports,
  gate: Gate,
): readonly string[] {
  const report = reports.get(reportForGate(gate))
  const root = manifest.evidenceDirectory
  const result = artifactPaths(manifest, gate, report?.path ?? null).map((file) =>
    normalizedArtifact(root, file),
  )
  if (gate === 'visual-states') result.push(...visualArtifactPaths(report))
  if (reportForGate(gate) === 'qualification' || gate === 'visual-states' || gate === 'resources')
    result.push(...bindingArtifactPaths(reports).map((file) => normalizedArtifact(root, file)))
  const native = reports.get('native-resources')
  if (gate === 'resources' && native) {
    result.push(
      normalizedArtifact(root, native.path),
      normalizedArtifact(root, path.join(path.dirname(native.path), 'native-resources.jsonl')),
    )
    const candidate = record(native.value ?? {}, 'candidate')
    result.push(
      ...list(get(candidate ?? {}, 'assets'))
        .filter(isRecord)
        .flatMap((row) => {
          const file = stringValue(row, 'file')
          return file
            ? [normalizedArtifact(root, path.resolve(root, path.dirname(native.path), file))]
            : []
        }),
    )
  }
  if (gate === 'resources' && reports.get('qualification'))
    result.push(normalizedArtifact(root, reports.get('qualification')!.path))
  if (gate === 'streaming-correctness' || gate === 'frame-probes')
    result.push(
      ...(manifest.rawQualificationReports ?? []).map((entry) =>
        normalizedArtifact(root, entry.path),
      ),
      ...(manifest.frameLogs ?? []).map((file) => normalizedArtifact(root, file)),
    )
  if (gate === 'browser-heldout-semantics') {
    const browser = record(report?.value ?? {}, 'browser')
    for (const file of [
      stringValue(browser ?? {}, 'inputPath'),
      manifest.browserReceipt ?? stringValue(browser ?? {}, 'receiptPath'),
    ])
      if (file) result.push(normalizedArtifact(root, file))
  }
  return Array.from(new Set(result))
}
function visualArtifactPaths(report: LoadedReport | undefined): string[] {
  if (!report?.value) return []
  return list(get(report.value, 'compared'))
    .filter(isRecord)
    .flatMap((row) =>
      ['baseline', 'candidate', 'overlay'].flatMap((role) => {
        const file = stringValue(row, role)
        return file ? [path.posix.join(path.posix.dirname(report.path), file)] : []
      }),
    )
}
function normalizedArtifact(root: string, file: string): string {
  return relativeArtifactPath(root, path.resolve(root, file))
}
function bindingArtifactPaths(reports: LoadedReports): string[] {
  return list(get(reports.get('qualification')?.value ?? {}, 'artifactBindings'))
    .filter(isRecord)
    .flatMap((binding) =>
      list(get(binding, 'artifacts'))
        .filter(isRecord)
        .flatMap((artifact) =>
          stringValue(artifact, 'path') ? [stringValue(artifact, 'path') ?? ''] : [],
        ),
    )
}
function bindingPathFindings(
  manifest: PromotionEvidenceAssemblyManifest,
  artifact: RecordValue,
  run: RecordValue | undefined,
  runId: string | null,
  gate: Gate,
): string[] {
  const role = get(artifact, 'role')
  if (role !== 'rawQualificationReport' && role !== 'frameLog') return []
  const expected = stringValue(run ?? {}, role === 'rawQualificationReport' ? 'rawReport' : 'log')
  const actual = stringValue(artifact, 'path') ?? ''
  if (
    expected &&
    normalizedArtifact(manifest.evidenceDirectory, expected) ===
      normalizedArtifact(manifest.evidenceDirectory, actual)
  )
    return []
  return [`${gate}: ${runId} authoritative ${String(role)} path differs from capture binding.`]
}
function captureBindingFindings(
  manifest: PromotionEvidenceAssemblyManifest,
  reports: LoadedReports,
  gate: Gate,
  artifacts: readonly ArtifactRef[],
): string[] {
  if (!['qualification', 'paired-raster'].includes(reportForGate(gate)) && gate !== 'resources')
    return []
  const qualification = reports.get('qualification')?.value
  const bindings = list(get(qualification ?? {}, 'artifactBindings')).filter(isRecord)
  if (!manifest.frozenProvenance || bindings.length === 0)
    return [`${gate}: capture-time artifactBindings/source context is missing.`]
  const frozen = manifest.frozenProvenance
  const expected = {
    revision: frozen.revision,
    cleanTrackedDiff: frozen.trackedDiffSha256,
    lock: frozen.lockfileSha256,
    sourceClosure: frozen.sourceClosureSha256,
  }
  const runs = list(get(qualification ?? {}, 'runs')).filter(isRecord)
  const findings: string[] = []
  const records = bindings.flatMap((binding) => {
    const runId = stringValue(binding, 'runId')
    const before = record(binding, 'sourceBefore') ?? {},
      after = record(binding, 'sourceAfter') ?? {}
    const stable = Object.entries(expected).every(
      ([field, value]) => get(before, field) === value && get(after, field) === value,
    )
    if (!stable || !runs.some((run) => get(run, 'name') === runId))
      findings.push(`${gate}: ${runId} capture source or run identity is invalid.`)
    const run = runs.find((entry) => get(entry, 'name') === runId)
    const runArtifacts = list(get(binding, 'artifacts')).filter(isRecord)
    findings.push(
      ...runArtifacts.flatMap((artifact) =>
        bindingPathFindings(manifest, artifact, run, runId, gate),
      ),
    )
    return list(get(binding, 'artifacts'))
      .filter(isRecord)
      .map((artifact) => ({ artifact, runId }))
  })
  for (const { artifact, runId } of records) {
    const file = stringValue(artifact, 'path')
    const actual = artifacts.find(
      (entry) =>
        file !== null && entry.path === normalizedArtifact(manifest.evidenceDirectory, file),
    )
    if (
      !actual ||
      actual.sha256 !== get(artifact, 'sha256') ||
      actual.byteLength !== get(artifact, 'byteLength')
    )
      findings.push(`${gate}: ${runId} capture hash/byteLength differs for ${file}.`)
  }
  const rawRequired = [
    'streaming-correctness',
    'interactions',
    'safety',
    'frame-probes',
    'resources',
  ].includes(gate)
  const requiredTests: { file: string; role: string; engine: string }[] = rawRequired
    ? (manifest.rawQualificationReports ?? []).map((entry) => ({
        file: entry.path,
        role: 'rawQualificationReport',
        engine: entry.engine,
      }))
    : []
  const required = requiredTests.concat(
    rawRequired
      ? (manifest.frameLogs ?? []).map((file) => ({ file, role: 'frameLog', engine: '' }))
      : [],
  )
  for (const { file, role, engine } of required) {
    if (
      !records.some(
        (entry) =>
          get(entry.artifact, 'role') === role &&
          normalizedArtifact(
            manifest.evidenceDirectory,
            stringValue(entry.artifact, 'path') ?? '',
          ) === normalizedArtifact(manifest.evidenceDirectory, file) &&
          (!engine || entry.runId?.includes(`-${engine}`)),
      )
    )
      findings.push(`${gate}: unbound ${role} ${file}.`)
  }
  if (gate === 'resources') {
    for (const engine of ['remark', 'tree-sitter']) {
      const runId = `browser-${engine}-qualify`
      const selected = bindings.filter((entry) => get(entry, 'runId') === runId)
      if (
        selected.length !== 1 ||
        !records.some(
          (entry) =>
            entry.runId === runId && get(entry.artifact, 'role') === 'rawQualificationReport',
        )
      )
        findings.push(`${gate}: ${runId} raw assertion capture binding is missing or ambiguous.`)
    }
  }
  if (gate === 'visual-states') {
    const report = reports.get('paired-raster')
    const requiredVisual = (report ? [report.path] : []).concat(visualArtifactPaths(report))
    for (const file of requiredVisual)
      if (
        !records.some(
          (entry) =>
            entry.runId === 'paired-raster' &&
            normalizedArtifact(
              manifest.evidenceDirectory,
              stringValue(entry.artifact, 'path') ?? '',
            ) === file,
        )
      )
        findings.push(`${gate}: unbound paired raster artifact ${file}.`)
  }
  if (gate === 'native-development-semantics' || gate === 'browser-development-semantics') {
    const runId =
      gate === 'native-development-semantics'
        ? 'package-tree-sitter'
        : 'browser-tree-sitter-qualify'
    if (
      !records.some(
        (entry) =>
          entry.runId === runId && get(entry.artifact, 'role') === 'rawQualificationReport',
      )
    )
      findings.push(`${gate}: raw assertion capture binding is missing.`)
  }
  return findings
}

async function visualCalibrationFindings(
  manifest: PromotionEvidenceAssemblyManifest,
  reports: LoadedReports,
): Promise<string[]> {
  if (!reports.get('paired-raster')?.value) return []
  const qualification = reports.get('qualification')?.value ?? {}
  const runs = list(get(qualification, 'runs'))
    .filter(isRecord)
    .filter((run) => stringValue(run, 'name')?.startsWith('browser-'))
  const bindings = list(get(qualification, 'artifactBindings')).filter(isRecord)
  const rasterBinding = bindings.find((entry) => get(entry, 'runId') === 'paired-raster') ?? {}
  const artifacts = list(get(rasterBinding, 'artifacts'))
    .filter(isRecord)
    .filter((entry) => get(entry, 'role') === 'pairedRasterCalibration')
  const findings: string[] = []
  const profiles: string[] = []
  const tolerances = new Map<string, number>()
  for (const run of runs) {
    const name = stringValue(run, 'name') ?? '',
      file = stringValue(run, 'log')
    const binding = bindings.find((entry) => get(entry, 'runId') === name)
    const boundLog = list(get(binding ?? {}, 'artifacts'))
      .filter(isRecord)
      .some(
        (entry) =>
          get(entry, 'role') === 'frameLog' &&
          file !== null &&
          normalizedArtifact(manifest.evidenceDirectory, stringValue(entry, 'path') ?? '') ===
            normalizedArtifact(manifest.evidenceDirectory, file),
      )
    if (!file || !boundLog) {
      findings.push(`visual-states: ${name} calibration browser log is unbound.`)
      continue
    }
    const captured = await calibrationRecords(manifest.evidenceDirectory, file)
    if (captured.failure)
      findings.push(`visual-states: ${name} calibration log is invalid: ${captured.failure}`)
    profiles.push(
      ...captured.records.map((entry) =>
        JSON.stringify([entry.engine, entry.browser, entry.width, entry.theme]),
      ),
    )
    for (const calibration of captured.records) {
      const calibrated = await calibrationTolerance(manifest, artifacts, calibration)
      findings.push(...calibrated.findings)
      tolerances.set(
        JSON.stringify([
          calibration.engine,
          calibration.browser,
          calibration.width,
          calibration.theme,
        ]),
        calibrated.tolerance,
      )
    }
    findings.push(
      ...captured.records.flatMap((calibration) =>
        calibrationArtifactFindings(manifest, artifacts, calibration.first, calibration.repeated),
      ),
    )
  }
  const expected = list(get(reports.get('paired-raster')?.value ?? {}, 'compared'))
    .filter(isRecord)
    .flatMap((row) => {
      const key = stringValue(row, 'key'),
        tuple = key ? parseVisualTuple(key) : null
      return tuple
        ? ['remark', 'tree-sitter'].map((engine) =>
            JSON.stringify(Array.of<unknown>(engine).concat(tuple.slice(1))),
          )
        : []
    })
  if (
    profiles.length !== 16 ||
    new Set(profiles).size !== 16 ||
    !expected.every((profile) => profiles.includes(profile))
  )
    findings.push(
      'visual-states: declared paired raster calibration profiles are missing, duplicate or differ from the visual matrix.',
    )
  const raster = reports.get('paired-raster')
  for (const row of list(get(raster?.value ?? {}, 'compared')).filter(isRecord))
    findings.push(...(await visualPixelFindings(manifest, raster?.path ?? '', row, tolerances)))
  return findings
}
async function calibrationRecords(root: string, file: string) {
  try {
    const log = await readFile(await resolveEvidencePath(root, file), 'utf8')
    return { records: rasterRecords(log).calibration, failure: null }
  } catch (failure) {
    return { records: [], failure: errorText(failure) }
  }
}
function calibrationArtifactPath(
  manifest: PromotionEvidenceAssemblyManifest,
  artifacts: readonly RecordValue[],
  file: string,
): string | null {
  const declared = path.resolve(manifest.trustedContext?.root ?? manifest.evidenceDirectory, file)
  const relative = path.relative(manifest.evidenceDirectory, declared)
  const inside =
    relative !== '' &&
    !path.isAbsolute(relative) &&
    relative !== '..' &&
    !relative.startsWith(`..${path.sep}`)
  const matches = artifacts.filter((entry) => {
    const actual = stringValue(entry, 'path'),
      digest = stringValue(entry, 'sha256')
    if (!actual || !digest) return false
    const expected = inside
      ? relative.split(path.sep).join('/')
      : path.posix.join(
          'captured',
          'pairedRasterCalibration',
          `${digest}-${path.basename(declared)}`,
        )
    return normalizedArtifact(manifest.evidenceDirectory, actual) === expected
  })
  return matches.length === 1 ? stringValue(matches[0] ?? {}, 'path') : null
}
function calibrationArtifactFindings(
  manifest: PromotionEvidenceAssemblyManifest,
  artifacts: readonly RecordValue[],
  ...files: readonly string[]
): string[] {
  return Array.from(new Set(files)).flatMap((file) =>
    calibrationArtifactPath(manifest, artifacts, file)
      ? []
      : [`visual-states: unbound paired raster calibration ${file}.`],
  )
}
async function calibrationTolerance(
  manifest: PromotionEvidenceAssemblyManifest,
  artifacts: readonly RecordValue[],
  calibration: Calibration,
) {
  try {
    const first = calibrationArtifactPath(manifest, artifacts, calibration.first)
    const repeated = calibrationArtifactPath(manifest, artifacts, calibration.repeated)
    if (!first || !repeated)
      return { tolerance: -1, findings: ['visual-states: calibration image bytes are unbound.'] }
    const root = manifest.evidenceDirectory
    const difference = pixelDifference(
      await readBitmap(await resolveEvidencePath(root, first), root),
      await readBitmap(await resolveEvidencePath(root, repeated), root),
    )
    if (difference.status !== 'compared' || difference.ratio > 0.001)
      return {
        tolerance: -1,
        findings: [
          `visual-states: ${calibration.browser} calibration exceeds repeated-capture variance.`,
        ],
      }
    return { tolerance: difference.ratio, findings: [] }
  } catch {
    return {
      tolerance: -1,
      findings: ['visual-states: calibration image bytes are missing or invalid.'],
    }
  }
}
async function visualPixelFindings(
  manifest: PromotionEvidenceAssemblyManifest,
  reportPath: string,
  row: RecordValue,
  tolerances: ReadonlyMap<string, number>,
): Promise<string[]> {
  const key = stringValue(row, 'key') ?? '',
    tuple = parseVisualTuple(key)
  if (!tuple) return [`visual-states: invalid pixel identity ${key}.`]
  const profiles = ['remark', 'tree-sitter'].map((engine) =>
    JSON.stringify(Array.of<unknown>(engine).concat(tuple.slice(1))),
  )
  const values = profiles.map((profile) => tolerances.get(profile))
  if (values.some((value) => value === undefined || value < 0))
    return [`visual-states: ${key} browser-specific pixel calibration is missing.`]
  const tolerance = Math.max(...values.filter((value): value is number => value !== undefined))
  try {
    const root = manifest.evidenceDirectory
    const bitmap = async (role: string) =>
      readBitmap(
        await resolveEvidencePath(
          root,
          path.resolve(root, path.dirname(reportPath), stringValue(row, role) ?? ''),
        ),
        root,
      )
    const baseline = await bitmap('baseline'),
      candidate = await bitmap('candidate')
    const difference = pixelDifference(baseline, candidate)
    const overlay = await bitmap('overlay')
    if (!validOverlay(baseline, candidate, overlay))
      return [`visual-states: ${key} overlay differs from paired image bytes.`]
    if (
      difference.status !== 'compared' ||
      difference.ratio > tolerance ||
      nonblankPixels(baseline) < 8 ||
      nonblankPixels(candidate) < 8 ||
      get(row, 'tolerance') !== tolerance ||
      get(row, 'ratio') !== difference.ratio ||
      get(row, 'changedPixels') !== difference.changedPixels
    )
      return [`visual-states: ${key} paired image bytes differ from calibrated comparison.`]
    return []
  } catch {
    return [`visual-states: ${key} paired image bytes are missing or invalid.`]
  }
}

function validOverlay(first: Bitmap, second: Bitmap, overlay: Bitmap): boolean {
  if (
    overlay.width !== first.width ||
    overlay.height !== first.height ||
    first.width !== second.width ||
    first.height !== second.height
  )
    return false
  for (let offset = 0; offset < overlay.data.length; offset += 4) {
    const unchanged = [0, 1, 2, 3].every(
      (channel) => first.data[offset + channel] === second.data[offset + channel],
    )
    const expected = unchanged ? first.data.subarray(offset, offset + 4) : [255, 0, 70, 255]
    if (!expected.every((value, channel) => value === overlay.data[offset + channel])) return false
  }
  return true
}

async function rawRunFindings(
  manifest: PromotionEvidenceAssemblyManifest,
  reports: LoadedReports,
): Promise<string[]> {
  const runs = list(get(reports.get('qualification')?.value ?? {}, 'runs')).filter(isRecord)
  const findings: string[] = []
  const execution = record(reports.get('qualification')?.value ?? {}, 'checkExecution')
  if (
    !execution ||
    get(execution, 'status') !== 'PASSED' ||
    numberValue(execution, 'exitCode') !== 0
  )
    findings.push(
      'qualification.checkExecution: required execution is failed, incomplete or missing.',
    )
  for (const run of runs) {
    const name = stringValue(run, 'name') ?? ''
    const exitCode = numberValue(run, 'exitCode')
    if (
      exitCode === null ||
      checkRunExitCode(exitCode, {
        tests: count(get(run, 'tests')),
        passed: count(get(run, 'passed')),
        failed: count(get(run, 'failed')),
      }) !== 0
    )
      findings.push(
        `${name}: required execution failed or incomplete; tests=${String(get(run, 'tests'))}, passed=${String(get(run, 'passed'))}, failed=${String(get(run, 'failed'))}, pending=${String(get(run, 'pending'))}, todo=${String(get(run, 'todo'))}, exitCode=${String(exitCode)}.`,
      )
    if (!name.startsWith('package-') && !name.startsWith('browser-')) continue
    const raw = await readJson(manifest.evidenceDirectory, stringValue(run, 'rawReport'))
    const rows = list(get(raw ?? {}, 'testResults'))
      .filter(isRecord)
      .flatMap((row) => list(get(row, 'assertionResults')).filter(isRecord))
    for (const row of rows) {
      if (get(row, 'status') === 'passed') continue
      findings.push(
        `${name}: required assertion ${assertionName(row) ?? stringValue(row, 'title') ?? 'unnamed'} status=${assertionStatus(row)}; ${strings(get(row, 'failureMessages')).join('; ')}`,
      )
    }
    const observed = {
      tests: rows.length,
      passed: rows.filter((row) => get(row, 'status') === 'passed').length,
      failed: rows.filter((row) => get(row, 'status') === 'failed').length,
      pending: rows.filter((row) =>
        ['pending', 'skipped', 'disabled'].includes(stringValue(row, 'status') ?? ''),
      ).length,
      todo: rows.filter((row) => get(row, 'status') === 'todo').length,
    }
    if (!raw || Object.entries(observed).some(([field, value]) => get(run, field) !== value))
      findings.push(
        `${name}: raw assertion denominators differ from qualification run counters or rawReport is missing.`,
      )
  }
  return findings
}

function receipt(
  manifest: PromotionEvidenceAssemblyManifest,
  gate: Gate,
  value: Observation,
  hashes: ReadonlyMap<string, string>,
  referenced: readonly string[],
): PromotionReceipt {
  const artifacts = referenced.map((file) => ({
    path: file,
    sha256: hashes.get(file) ?? ZERO_SHA256,
  }))
  return {
    gate,
    status: value.status,
    identity: manifest.identity,
    artifacts,
    counts: {
      executed: value.complete,
      failed: value.failed,
      skipped: value.skipped,
    },
    metrics: countMetrics(value),
    ...(value.comparisons.length > 0 ? { comparisons: value.comparisons.slice() } : {}),
  }
}

function gateReport(gate: Gate, report: string | null, value: Observation): GateAssemblyReport {
  return {
    gate,
    report,
    selected: value.selected,
    attempted: value.attempted,
    complete: value.complete,
    failed: value.failed,
    skipped: value.skipped,
    status: value.status,
    reason: value.reason,
    failures: value.failures,
    exclusions: value.exclusions,
  }
}

function errorText(value: unknown): string {
  return value instanceof Error ? value.message : 'invalid report'
}

async function resolveEvidencePath(rootDirectory: string, file: string): Promise<string> {
  const root = await realpath(rootDirectory)
  const candidate = path.isAbsolute(file) ? file : path.resolve(root, file)
  const resolved = await realpath(candidate)
  const relative = path.relative(root, resolved)
  if (
    !relative ||
    path.isAbsolute(relative) ||
    relative === '..' ||
    relative.startsWith(`..${path.sep}`)
  )
    throw createScriptError('Evidence path escapes evidenceDirectory.')
  return resolved
}
function relativeArtifactPath(root: string, file: string): string {
  const relative = path.relative(root, file)
  return relative.split(path.sep).join('/')
}
async function loadReports(manifest: PromotionEvidenceAssemblyManifest): Promise<LoadedReports> {
  const root = await realpath(manifest.evidenceDirectory)
  const loaded = new Map<ReportKind, LoadedReport>()
  for (const [kindValue, file] of Object.entries(manifest.reports)) {
    if (!file) continue
    const kind = kindValue as ReportKind
    try {
      const resolved = await resolveEvidencePath(root, file)
      const contents = await readFile(resolved, 'utf8')
      const parsed: unknown = JSON.parse(contents)
      if (
        (kind === 'production-browser' || kind === 'paired-native') &&
        !validTimingEnvelope(parsed)
      )
        throw createScriptError('Timing report requires a schema-2 file-backed envelope.')
      loaded.set(kind, {
        path: relativeArtifactPath(root, resolved),
        sha256: createHash('sha256').update(contents).digest('hex'),
        value: isRecord(parsed) ? parsed : null,
        error: isRecord(parsed) ? null : 'Report is not a JSON object.',
      })
    } catch (failure) {
      const unresolved = path.isAbsolute(file) ? file : path.resolve(root, file)
      loaded.set(kind, {
        path: relativeArtifactPath(root, unresolved),
        value: null,
        sha256: null,
        error: errorText(failure),
      })
    }
  }
  return loaded
}
function validTimingEnvelope(value: unknown) {
  if (
    !isRecord(value) ||
    value.schemaVersion !== 2 ||
    'rawTrials' in value ||
    'warmupResults' in value ||
    'rawReport' in value
  )
    return false
  return !list(value.workloads).some((row) => isRecord(row) && 'pairs' in row)
}
async function readJson(root: string, file: string | null): Promise<RecordValue | null> {
  if (!file) return null
  try {
    const resolved = await resolveEvidencePath(root, file)
    const parsed: unknown = JSON.parse(await readFile(resolved, 'utf8'))
    return isRecord(parsed) ? parsed : null
  } catch {
    return null
  }
}
async function hashArtifacts(
  manifest: PromotionEvidenceAssemblyManifest,
  paths: readonly string[],
): Promise<{
  readonly hashes: ReadonlyMap<string, string>
  readonly artifacts: readonly ArtifactRef[]
  readonly findings: readonly string[]
}> {
  const root = await realpath(manifest.evidenceDirectory)
  const hashes = new Map<string, string>()
  const artifacts: ArtifactRef[] = []
  const findings: string[] = []
  for (const file of new Set(paths)) {
    try {
      const resolved = await resolveEvidencePath(root, file)
      const relative = relativeArtifactPath(root, resolved)
      const observed = await hashFile({ root, file: resolved })
      hashes.set(relative, observed.sha256)
      artifacts.push(observed)
    } catch {
      findings.push(
        `${file}: referenced artifact is missing, unreadable, or outside evidenceDirectory.`,
      )
    }
  }
  return { hashes, artifacts, findings }
}

async function reconcileTimings(
  manifest: PromotionEvidenceAssemblyManifest,
  reports: LoadedReports,
) {
  const results = new Map<'production' | 'native', TimingReconciliationResult>()
  const findings: string[] = []
  if (!manifest.frozenProvenance) return { results, findings }
  for (const kind of ['production', 'native'] as const) {
    const file = manifest.timingManifests?.[kind]
    const report = reports.get(kind === 'production' ? 'production-browser' : 'paired-native')
    if (!file || !report?.value) {
      findings.push(`${kind}: timing manifest or original report bytes are missing.`)
      continue
    }
    try {
      const result = await reconcileTimingInput(manifest, kind, file, report)
      if (result) results.set(kind, result)
      else
        findings.push(
          `${kind}: timing manifest kind, exact original report path, frozen identity, provenance or font fingerprint does not match assembly context.`,
        )
    } catch (failure) {
      findings.push(`${kind}: timing capture artifact cannot be reconciled: ${errorText(failure)}`)
    }
  }
  return { results, findings }
}
async function reconcileTimingInput(
  manifest: PromotionEvidenceAssemblyManifest,
  kind: 'production' | 'native',
  file: string,
  report: LoadedReport,
): Promise<TimingReconciliationResult | null> {
  const root = manifest.evidenceDirectory
  const manifestPath = await resolveEvidencePath(root, file)
  const input = await readJson(root, file)
  const directory = path.dirname(manifestPath)
  if (!input || get(input, 'kind') !== kind) return null
  const reportFile = stringValue(input, 'report'),
    frozenFile = stringValue(input, 'frozen')
  if (
    !reportFile ||
    !frozenFile ||
    normalizedArtifact(root, path.resolve(directory, reportFile)) !== report.path
  )
    return null
  const frozen = await readJson(root, path.resolve(directory, frozenFile))
  const frozenIdentity = record(frozen ?? {}, 'identity'),
    provenance = record(frozen ?? {}, 'provenance')
  if (
    !frozenIdentity ||
    !provenance ||
    !Object.entries(manifest.identity).every(
      ([key, value]) => get(frozenIdentity, key) === value,
    ) ||
    !Object.entries(manifest.frozenProvenance ?? {}).every(
      ([key, value]) => get(provenance, key) === value,
    ) ||
    get(frozen ?? {}, 'fontFingerprint') !== manifest.fontFingerprint
  )
    return null
  const paths = [reportFile, frozenFile].concat(
    Object.values(record(input, 'artifacts') ?? {}).filter(
      (value): value is string => typeof value === 'string',
    ),
  )
  for (const referenced of paths)
    await resolveEvidencePath(root, path.resolve(directory, referenced))
  const result = await reconcileTimingManifest({
    manifestPath,
    evidenceRoot: root,
    outputPath: path.join(root, `assembled-${kind}-timing-reconciliation.json`),
  })
  if (
    !result.artifacts.some(
      (artifact) =>
        normalizedArtifact(root, artifact.path) === report.path &&
        artifact.sha256 === report.sha256,
    )
  )
    return null
  return result
}
const nativeAssetRoles = [
  { asset: 'tree-sitter-markdown.wasm', field: 'grammarSha256' },
  { asset: 'tree-sitter-markdown-chat.wasm', field: 'chatGrammarSha256' },
  { asset: 'tree-sitter-md.wasm', field: 'resolverSha256' },
] as const

async function nativeResourceRawFindings(
  manifest: PromotionEvidenceAssemblyManifest,
  report: LoadedReport | undefined,
): Promise<string[]> {
  if (!report?.value) return []
  const file = path.join(path.dirname(report.path), 'native-resources.jsonl')
  try {
    const text = await readFile(await resolveEvidencePath(manifest.evidenceDirectory, file), 'utf8')
    if (!text.endsWith('\n'))
      return ['native-resources: original raw sidecar needs a final LF terminator.']
    const rows: unknown[] = text
      .slice(0, -1)
      .split('\n')
      .map((line) => JSON.parse(line))
    if (stable(rows) !== stable(get(report.value, 'rawWindows')))
      return ['native-resources: original raw sidecar windows differ from report.rawWindows.']
    return []
  } catch {
    return [
      'native-resources: original raw sidecar is missing, invalid or outside evidenceDirectory.',
    ]
  }
}

async function nativeResourceAssetFindings(
  manifest: PromotionEvidenceAssemblyManifest,
  report: LoadedReport | undefined,
): Promise<string[]> {
  if (!report) return ['native-resources: required native resource report is missing.']
  const candidate = record(report.value ?? {}, 'candidate')
  const raw = get(candidate ?? {}, 'assets')
  const assets = list(raw).filter(isRecord)
  const findings: string[] = []
  if (!Array.isArray(raw) || raw.length !== nativeAssetRoles.length || assets.length !== raw.length)
    findings.push(
      'native-resources: candidate assets require exactly the base, CHAT and resolver roles.',
    )
  for (const { asset, field } of nativeAssetRoles) {
    const selected = assets.filter((entry) => get(entry, 'asset') === asset)
    if (selected.length !== 1) {
      findings.push(`native-resources: missing or duplicate asset role ${asset}.`)
      continue
    }
    findings.push(
      ...(await nativeResourceAssetBytes({
        manifest,
        row: selected[0] ?? {},
        asset,
        field,
        reportPath: report.path,
      })),
    )
  }
  return findings
}

async function nativeResourceAssetBytes(input: {
  readonly manifest: PromotionEvidenceAssemblyManifest
  readonly row: RecordValue
  readonly asset: string
  readonly field: (typeof nativeAssetRoles)[number]['field']
  readonly reportPath: string
}): Promise<string[]> {
  const { manifest, row, asset, field, reportPath } = input
  const file = stringValue(row, 'file')
  if (!file || get(row, 'sha256') !== manifest.identity[field])
    return [
      `native-resources: ${asset} candidate asset differs from sealed identity or lacks a file.`,
    ]
  try {
    const declared = path.resolve(manifest.evidenceDirectory, path.dirname(reportPath), file)
    const resolved = await resolveEvidencePath(manifest.evidenceDirectory, declared)
    const actual = await hashFile({ root: manifest.evidenceDirectory, file: resolved })
    if (actual.sha256 === manifest.identity[field] && actual.byteLength === get(row, 'bytes'))
      return []
    return [`native-resources: ${asset} actual bytes differ from sealed identity or byte length.`]
  } catch {
    return [
      `native-resources: ${asset} asset file is missing, unreadable or outside evidenceDirectory.`,
    ]
  }
}

function sourceIdentityFindings(
  manifest: PromotionEvidenceAssemblyManifest,
  reports: LoadedReports,
): string[] {
  const frozen = manifest.frozenProvenance
  if (!frozen) return ['Frozen qualification source provenance is missing.']
  const findings: string[] = []
  if (
    frozen.revision !== manifest.identity.candidateCommit ||
    frozen.lockfileSha256 !== manifest.identity.lockfileSha256 ||
    frozen.trackedDiffSha256 !== createHash('sha256').update('').digest('hex')
  )
    findings.push(
      'Frozen source context differs from sealed candidate/lock or contains a tracked diff.',
    )
  for (const kind of ['qualification', 'production-browser', 'native-resources'] as const) {
    const report = reports.get(kind)?.value
    if (!report) continue
    const actual = record(report, 'provenance') ?? {}
    for (const [field, expected] of Object.entries(frozen)) {
      if (get(actual, field) !== expected)
        findings.push(`${kind}: frozen source provenance mismatch or missing ${field}.`)
    }
    const sources = get(actual, 'sources')
    if (
      !Array.isArray(sources) ||
      createHash('sha256').update(JSON.stringify(sources)).digest('hex') !==
        frozen.sourceClosureSha256
    )
      findings.push(`${kind}: source closure rows do not match frozen source digest.`)
  }
  const candidate = record(reports.get('qualification')?.value ?? {}, 'candidate')
  const artifacts = list(get(candidate ?? {}, 'artifacts')).filter(isRecord)
  for (const kind of ['grammar', 'chatGrammar', 'resolver'] as const) {
    const selected = artifacts.filter((entry) => get(entry, 'kind') === kind)
    if (
      selected.length !== 1 ||
      get(selected[0] ?? {}, 'sha256') !== manifest.identity[`${kind}Sha256`]
    )
      findings.push(
        `qualification: ${kind} candidate artifact differs from sealed identity or is missing.`,
      )
  }
  const production = reports.get('production-browser')?.value
  if (production && get(production, 'frozenBudgetSha256') !== manifest.identity.budgetSha256)
    findings.push('production-browser: frozen budget differs from sealed identity.')
  return findings
}

function identityFindings(
  manifest: PromotionEvidenceAssemblyManifest,
  report: HeldoutReport | null,
  raw: RecordValue | null,
): readonly string[] {
  const candidate = report?.candidate ?? record(raw ?? {}, 'candidate')
  const artifacts = report?.candidate.artifacts ?? record(candidate ?? {}, 'artifacts')
  const actual: Readonly<Record<string, string | null>> = {
    candidateCommit:
      report?.candidate.candidateCommit ?? stringValue(candidate ?? {}, 'candidateCommit'),
    grammarSha256:
      report?.candidate.artifacts.grammarSha256 ?? stringValue(artifacts ?? {}, 'grammarSha256'),
    chatGrammarSha256:
      report?.candidate.artifacts.chatGrammarSha256 ??
      stringValue(artifacts ?? {}, 'chatGrammarSha256'),
    resolverSha256:
      report?.candidate.artifacts.resolverSha256 ?? stringValue(artifacts ?? {}, 'resolverSha256'),
    candidateSourceSha256:
      report?.candidate.candidateSourceSha256 ??
      stringValue(candidate ?? {}, 'candidateSourceSha256'),
    lockfileSha256:
      report?.candidate.artifacts.lockfileSha256 ?? stringValue(artifacts ?? {}, 'lockfileSha256'),
    evaluationManifestSha256: report?.manifestSha256 ?? stringValue(raw ?? {}, 'manifestSha256'),
    workloadManifestSha256: manifest.identity.workloadManifestSha256,
    budgetSha256: manifest.identity.budgetSha256,
  }
  const findings = Object.entries(actual).flatMap(([key, value]) => {
    if (value === null) return []
    const expected = manifest.identity[key as keyof typeof manifest.identity]
    return value === expected ? [] : [`sealed identity mismatch: ${key}`]
  })
  return report || findings.length > 0
    ? findings
    : ['Held-out report is required to bind sealed candidate and evaluation identity.']
}

function parseHash(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/u.test(value))
    throw createScriptError('Promotion identity contains an invalid SHA-256.')
  return value
}
function parseIdentity(value: RecordValue): PromotionEvidence['identity'] {
  const candidateCommit = stringValue(value, 'candidateCommit')
  if (!candidateCommit || !/^[a-f0-9]{40}$/u.test(candidateCommit))
    throw createScriptError('Promotion identity contains an invalid candidate commit.')
  return {
    candidateCommit,
    grammarSha256: parseHash(get(value, 'grammarSha256')),
    chatGrammarSha256: parseHash(get(value, 'chatGrammarSha256')),
    resolverSha256: parseHash(get(value, 'resolverSha256')),
    candidateSourceSha256: parseHash(get(value, 'candidateSourceSha256')),
    lockfileSha256: parseHash(get(value, 'lockfileSha256')),
    budgetSha256: parseHash(get(value, 'budgetSha256')),
    evaluationManifestSha256: parseHash(get(value, 'evaluationManifestSha256')),
    workloadManifestSha256: parseHash(get(value, 'workloadManifestSha256')),
  }
}
function parseNativeWorkloads(value: readonly unknown[]): PromotionEvidence['nativeWorkloads'] {
  return value.map((entry) => {
    if (!isRecord(entry)) throw createScriptError('Native workload row is invalid.')
    const id = stringValue(entry, 'id')
    const selectedMetrics = metrics(get(entry, 'metrics'))
    if (!id || selectedMetrics.length !== 4 || new Set(selectedMetrics).size !== 4)
      throw createScriptError('Native workload row has an incomplete metric set.')
    return {
      id,
      sourceBytes: count(get(entry, 'sourceBytes')),
      scheduleUnits: count(get(entry, 'scheduleUnits')),
      metrics: Array.from(selectedMetrics),
    }
  })
}
function parseExpectedWorkloads(value: readonly unknown[]): PromotionEvidence['expectedWorkloads'] {
  return value.map((entry) => {
    if (!isRecord(entry)) throw createScriptError('Expected workload row is invalid.')
    const id = stringValue(entry, 'id')
    const arrival = stringValue(entry, 'arrival')
    const paintPolicy = stringValue(entry, 'paintPolicy')
    const selectedMetrics = metrics(get(entry, 'metrics'))
    if (
      !id ||
      selectedMetrics.length === 0 ||
      !arrival ||
      !paintPolicy ||
      (arrival !== 'paced' && arrival !== 'burst-coalesced') ||
      (paintPolicy !== 'every-revision' && paintPolicy !== 'sampled')
    )
      throw createScriptError('Expected workload row is incomplete.')
    return {
      id,
      sourceBytes: count(get(entry, 'sourceBytes')),
      scheduleUnits: count(get(entry, 'scheduleUnits')),
      metrics: Array.from(selectedMetrics),
      arrival,
      scheduleId: stringValue(entry, 'scheduleId') ?? '',
      sourceSha256: parseHash(get(entry, 'sourceSha256')),
      expectedInputUpdates: count(get(entry, 'expectedInputUpdates')),
      paintPolicy,
    }
  })
}
function parseRawQualificationReports(
  value: unknown,
): readonly { readonly engine: RawEngine; readonly path: string }[] | undefined {
  if (!Array.isArray(value)) return undefined
  return value.flatMap((entry) => {
    if (!isRecord(entry)) return []
    const engine = stringValue(entry, 'engine')
    const file = stringValue(entry, 'path')
    return (engine === 'remark' || engine === 'tree-sitter') && file ? [{ engine, path: file }] : []
  })
}
function frameEvidenceLine(line: string): RecordValue[] {
  const marker = 'MARKDOWN_BROWSER_FRAMES '
  if (!line.includes(marker)) return []
  try {
    const parsed: unknown = JSON.parse(line.slice(line.indexOf(marker) + marker.length))
    return isRecord(parsed) ? [parsed] : []
  } catch {
    return []
  }
}
async function loadRawEvidence(manifest: PromotionEvidenceAssemblyManifest): Promise<RawEvidence> {
  const root = await realpath(manifest.evidenceDirectory)
  const tests: RawQualification[] = []
  for (const entry of manifest.rawQualificationReports ?? []) {
    try {
      const parsed: unknown = JSON.parse(
        await readFile(await resolveEvidencePath(root, entry.path), 'utf8'),
      )
      const rows = isRecord(parsed)
        ? list(get(parsed, 'testResults'))
            .filter(isRecord)
            .flatMap((suite) => list(get(suite, 'assertionResults')).filter(isRecord))
        : []
      tests.push({
        engine: entry.engine,
        path: entry.path,
        rows,
        error: isRecord(parsed) ? null : 'Raw test report is not an object.',
      })
    } catch (failure) {
      tests.push({
        engine: entry.engine,
        path: entry.path,
        rows: [],
        error: errorText(failure),
      })
    }
  }
  const frames: FrameEvidence[] = []
  for (const file of manifest.frameLogs ?? []) {
    try {
      const text = await readFile(await resolveEvidencePath(root, file), 'utf8')
      const rows = text.split('\n').flatMap(frameEvidenceLine)
      frames.push({ path: file, rows, error: null })
    } catch (failure) {
      frames.push({ path: file, rows: [], error: errorText(failure) })
    }
  }
  return { tests, frames }
}
function parseReportPaths(value: RecordValue): Partial<Record<ReportKind, string>> {
  const result: Partial<Record<ReportKind, string>> = {}
  for (const kind of [
    'qualification',
    'heldout',
    'paired-native',
    'production-browser',
    'paired-raster',
    'native-resources',
    'benchmark',
  ] as const) {
    const file = stringValue(value, kind)
    if (file) result[kind] = file
  }
  return result
}
function parseArtifactPaths(
  value: RecordValue | null,
): Partial<Record<Gate, readonly string[]>> | undefined {
  if (!value) return undefined
  const result: Partial<Record<Gate, readonly string[]>> = {}
  for (const gate of PROMOTION_GATES) {
    const files = strings(get(value, gate))
    if (files.length > 0) result[gate] = files
  }
  return result
}

function parseFrozenProvenance(value: RecordValue | null): TimingFreeze['provenance'] | undefined {
  if (!value) return undefined
  const revision = stringValue(value, 'revision')
  if (!revision || !/^[a-f0-9]{40}$/u.test(revision))
    throw createScriptError('Frozen provenance revision is invalid.')
  return {
    revision,
    trackedDiffSha256: parseHash(get(value, 'trackedDiffSha256')),
    sourceClosureSha256: parseHash(get(value, 'sourceClosureSha256')),
    lockfileSha256: parseHash(get(value, 'lockfileSha256')),
  }
}
function parseTimingManifests(
  value: RecordValue | null,
): PromotionEvidenceAssemblyManifest['timingManifests'] {
  if (!value) return undefined
  const result: Partial<Record<'production' | 'native', string>> = {}
  for (const kind of ['production', 'native'] as const) {
    const file = stringValue(value, kind)
    if (file) result[kind] = file
  }
  return result
}
function parseTrustedOptions(
  value: RecordValue | null,
): PromotionEvidenceAssemblyManifest['trustedContext'] {
  if (!value) return undefined
  const root = stringValue(value, 'root'),
    evaluationReceipt = stringValue(value, 'evaluationReceipt'),
    evaluationLedger = stringValue(value, 'evaluationLedger')
  if (!root || !evaluationReceipt || !evaluationLedger)
    throw createScriptError('Trusted evaluation context paths are incomplete.')
  return { root, evaluationReceipt, evaluationLedger }
}

export async function parsePromotionEvidenceAssemblyManifest(
  value: unknown,
): Promise<PromotionEvidenceAssemblyManifest> {
  if (!isRecord(value) || get(value, 'schemaVersion') !== 1)
    throw createScriptError('Promotion evidence assembly manifest must use schemaVersion 1.')
  const evidenceDirectory = stringValue(value, 'evidenceDirectory')
  const identity = record(value, 'identity')
  const reports = record(value, 'reports')
  const native = get(value, 'nativeWorkloads')
  const expected = get(value, 'expectedWorkloads')
  if (
    !evidenceDirectory ||
    !identity ||
    !reports ||
    !Array.isArray(native) ||
    !Array.isArray(expected)
  )
    throw createScriptError(
      'Promotion evidence assembly manifest is missing frozen identity, workloads, or reports.',
    )
  return {
    schemaVersion: 1,
    evidenceDirectory,
    identity: parseIdentity(identity),
    nativeWorkloads: parseNativeWorkloads(native),
    expectedWorkloads: parseExpectedWorkloads(expected),
    reports: parseReportPaths(reports),
    browserReceipt: stringValue(value, 'browserReceipt') ?? undefined,
    artifacts: parseArtifactPaths(record(value, 'artifacts')),
    rawQualificationReports: parseRawQualificationReports(get(value, 'rawQualificationReports')),
    frameLogs: strings(get(value, 'frameLogs')),
    frozenProvenance: parseFrozenProvenance(record(value, 'frozenProvenance')),
    fontFingerprint: stringValue(value, 'fontFingerprint') ?? undefined,
    timingManifests: parseTimingManifests(record(value, 'timingManifests')),
    trustedContext: parseTrustedOptions(record(value, 'trustedContext')),
  }
}

export async function assemblePromotionEvidence(
  manifest: PromotionEvidenceAssemblyManifest,
): Promise<PromotionEvidenceAssemblyResult> {
  if (manifest.nativeWorkloads.length !== 75)
    throw createScriptError('Promotion assembly requires the frozen 75-workload native matrix.')
  const reports = await loadReports(manifest)
  const heldoutLoaded = reports.get('heldout')
  let heldout: HeldoutReport | null = null
  let heldoutError = heldoutLoaded?.error ?? null
  if (heldoutLoaded?.value) {
    try {
      heldout = parseReport(heldoutLoaded.value)
    } catch (failure) {
      heldoutError = errorText(failure)
    }
  }
  const root = await realpath(manifest.evidenceDirectory)
  const browserInputPath = heldout?.browser.inputPath ?? null
  const browserReceiptPath = manifest.browserReceipt ?? heldout?.browser.receiptPath ?? null
  const browserInput = await readJson(root, browserInputPath)
  const browserReceipt = await readJson(root, browserReceiptPath)
  const heldoutValues = heldoutObservations(heldout, heldoutError, browserReceipt, browserInput)
  const rawEvidence = await loadRawEvidence(manifest)
  const rawRunErrors = await rawRunFindings(manifest, reports)
  const calibrationErrors = await visualCalibrationFindings(manifest, reports)
  const { results: timing, findings: timingFindings } = await reconcileTimings(manifest, reports)
  const observations = new Map(
    PROMOTION_GATES.map((gate) => [
      gate,
      observeGate(gate, reports, manifest, heldoutValues, rawEvidence, timing),
    ]),
  )
  const references = new Map(
    PROMOTION_GATES.map((gate) => [gate, referencedArtifacts(manifest, reports, gate)]),
  )
  for (const [kind, result] of timing) {
    const gate = kind === 'production' ? 'production-timing' : 'native-paired'
    references.set(
      gate,
      (references.get(gate) ?? []).concat(
        result.artifacts.map((artifact) =>
          normalizedArtifact(manifest.evidenceDirectory, artifact.path),
        ),
      ),
    )
  }
  const reportPaths = Array.from(references.values()).flat().concat(bindingArtifactPaths(reports))
  const configuredArtifacts = PROMOTION_GATES.flatMap(
    (gate) => manifest.artifacts?.[gate] ?? [],
  ).concat(
    (manifest.rawQualificationReports ?? []).map((entry) => entry.path),
    manifest.frameLogs ?? [],
  )
  const artifactData = await hashArtifacts(manifest, reportPaths.concat(configuredArtifacts))
  const resourceAssets = await nativeResourceAssetFindings(
    manifest,
    reports.get('native-resources'),
  )
  const sourceFindings = sourceIdentityFindings(manifest, reports).concat(
    resourceAssets,
    await nativeResourceRawFindings(manifest, reports.get('native-resources')),
  )
  const timingArtifactFindings = Array.from(timing.values()).flatMap((result) =>
    result.artifacts.flatMap((artifact) =>
      artifactData.hashes.get(normalizedArtifact(root, artifact.path)) === artifact.sha256
        ? []
        : [
            `${result.kind}: timing artifact changed after reconciliation: ${normalizedArtifact(root, artifact.path)}.`,
          ],
    ),
  )
  const bindingFindings = PROMOTION_GATES.flatMap((gate) => {
    const findings = captureBindingFindings(manifest, reports, gate, artifactData.artifacts)
    const gateSourceFindings = sourceFindings.filter(
      (finding) =>
        finding.startsWith(`${reportForGate(gate)}:`) ||
        finding.startsWith('Frozen') ||
        (gate === 'resources' &&
          (finding.startsWith('qualification:') || finding.startsWith('native-resources:'))),
    )
    const runErrors =
      reportForGate(gate) === 'qualification' || gate === 'visual-states' || gate === 'resources'
        ? rawRunErrors
        : []
    const all = findings.concat(
      gateSourceFindings,
      runErrors,
      gate === 'visual-states' ? calibrationErrors : [],
    )
    const value = observations.get(gate) ?? EMPTY
    if (all.length > 0)
      observations.set(gate, {
        ...value,
        status: value.failed > 0 ? 'failed' : 'inconclusive',
        failures: value.failures.concat(all),
        reason: all.join('; '),
      })
    return all
  })
  const receipts = PROMOTION_GATES.map((gate) =>
    receipt(
      manifest,
      gate,
      observations.get(gate) ?? EMPTY,
      artifactData.hashes,
      references.get(gate) ?? [],
    ),
  )
  const evidence: PromotionEvidence = {
    schemaVersion: 1,
    identity: manifest.identity,
    nativeWorkloads: manifest.nativeWorkloads,
    expectedWorkloads: manifest.expectedWorkloads,
    receipts,
  }
  const verifiedArtifacts = await verifyPromotionArtifacts(evidence, manifest.evidenceDirectory)
  let context
  const contextFindings: string[] = []
  try {
    if (manifest.trustedContext)
      context = await createTrustedPromotionContext({
        ...manifest.trustedContext,
        evidenceDirectory: manifest.evidenceDirectory,
      })
  } catch (failure) {
    contextFindings.push(`Trusted promotion context is unavailable: ${errorText(failure)}`)
  }
  const validation = evaluatePromotion(
    evidence,
    await frozenBudgetSha256(),
    verifiedArtifacts,
    context,
  )
  const finalFindings = validation.findings.concat(
    artifactData.findings,
    timingFindings,
    timingArtifactFindings,
    contextFindings,
    bindingFindings,
    identityFindings(manifest, heldout, heldoutLoaded?.value ?? null),
    sourceFindings,
  )
  const finalValidation: PromotionResult = {
    ...validation,
    verdict: finalFindings.length === 0 ? validation.verdict : 'NOT VERIFIED',
    findings: finalFindings,
  }
  const report: PromotionEvidenceAssemblyReport = {
    schemaVersion: 1,
    verdict: finalValidation.verdict,
    findings: finalFindings,
    gates: PROMOTION_GATES.map((gate) =>
      gateReport(
        gate,
        reports.get(reportForGate(gate))?.path ?? null,
        observations.get(gate) ?? EMPTY,
      ),
    ),
    artifacts: artifactData.artifacts,
    timing: Array.from(timing.values()),
  }
  return { evidence, report, validation: finalValidation }
}

async function main() {
  const { values } = parseArgs({
    options: {
      manifest: { type: 'string' },
      out: { type: 'string' },
      report: { type: 'string' },
    },
  })
  if (!values.manifest || !values.out)
    throw createScriptError('Promotion evidence assembly requires --manifest and --out.')
  const manifestValue: unknown = JSON.parse(await readFile(path.resolve(values.manifest), 'utf8'))
  const manifest = await parsePromotionEvidenceAssemblyManifest(manifestValue)
  const result = await assemblePromotionEvidence(manifest)
  await writeFile(path.resolve(values.out), `${JSON.stringify(result.evidence, null, 2)}\n`)
  if (values.report)
    await writeFile(path.resolve(values.report), `${JSON.stringify(result.report, null, 2)}\n`)
  process.stdout.write(
    `${JSON.stringify({ verdict: result.validation.verdict, out: path.resolve(values.out), report: values.report ? path.resolve(values.report) : null })}\n`,
  )
  process.exitCode = result.validation.verdict === 'VERIFIED' ? 0 : 1
}

if (import.meta.main) await main()
