import { createHash } from 'node:crypto'
import * as v from 'valibot'
import { MARKDOWN_CASES } from '../../packages/markdown/test/fixtures/cases'

const bytes = v.pipe(v.number(), v.safeInteger(), v.minValue(0))
const reading = v.object({
  heapUsedBytes: bytes,
  rssBytes: bytes,
  wasmReservedBytes: v.pipe(bytes, v.minValue(1)),
  gcPerformed: v.boolean(),
})
const windowSchema = v.object({
  engine: v.picklist(['remark', 'tree-sitter']),
  cycles: v.picklist([20, 100, 500]),
  window: bytes,
  before: reading,
  after: reading,
  outputFailures: v.array(v.string()),
  cleanupFailures: v.array(v.string()),
  clearedSessions: bytes,
  clearedProjectionEntries: bytes,
})
const diagnosticsSchema = v.object({
  failures: v.optional(v.array(v.string()), []),
  exclusions: v.optional(v.array(v.string()), []),
})
const reportSchema = v.object({
  schemaVersion: v.literal(1),
  nativeStatus: v.string(),
  sources: v.array(v.object({ id: v.string(), sha256: v.string(), sourceBytes: bytes })),
  rawWindows: v.array(windowSchema),
  summaries: v.array(v.record(v.string(), v.unknown())),
  ...diagnosticsSchema.entries,
})
type Window = v.InferOutput<typeof windowSchema>

function sourceFindings(sources: v.InferOutput<typeof reportSchema>['sources']): string[] {
  const complete =
    sources.length === MARKDOWN_CASES.length &&
    MARKDOWN_CASES.every((fixture) => {
      const rows = sources.filter((row) => row.id === fixture.id)
      return (
        rows.length === 1 &&
        rows[0]?.sourceBytes === Buffer.byteLength(fixture.source) &&
        rows[0]?.sha256 === createHash('sha256').update(fixture.source).digest('hex')
      )
    })
  return complete ? [] : ['native-resources: original source matrix or source bytes differ.']
}

function summarize(rows: readonly Window[]) {
  const after = rows.map((row) => row.after)
  const deltas = (field: 'heapUsedBytes' | 'rssBytes' | 'wasmReservedBytes') =>
    after.slice(1).map((row, index) => row[field] - (after[index]?.[field] ?? row[field]))
  const heaps = after.map((row) => row.heapUsedBytes)
  const reuse =
    after.every((row) => row.wasmReservedBytes > 0) &&
    deltas('wasmReservedBytes')
      .slice(-2)
      .every((delta) => delta === 0)
  const plateau = deltas('heapUsedBytes')
    .slice(-2)
    .every((delta) => delta <= 0)
  return {
    engine: rows[0]?.engine,
    cycles: rows[0]?.cycles,
    windows: rows.length,
    gcStatus: rows.every((row) => row.before.gcPerformed && row.after.gcPerformed)
      ? 'POST_GC'
      : 'NOT_MEASURED',
    heapAfterReleaseBytes: heaps,
    rssAfterReleaseBytes: after.map((row) => row.rssBytes),
    wasmReservedBytes: after.map((row) => row.wasmReservedBytes),
    heapWindowDeltasBytes: deltas('heapUsedBytes'),
    rssWindowDeltasBytes: deltas('rssBytes'),
    wasmWindowDeltasBytes: deltas('wasmReservedBytes'),
    heapObservedRangeBytes: Math.max(...heaps) - Math.min(...heaps),
    wasmHighWaterReuseObserved: rows.length >= 3 && reuse,
    status: plateau && reuse ? 'OBSERVED_PLATEAU' : 'INCONCLUSIVE',
  }
}

function groupFindings(rows: Window[], summaries: readonly Record<string, unknown>[]): string[] {
  rows.sort((a, b) => a.window - b.window)
  const id = `${rows[0]?.engine}/${rows[0]?.cycles}`
  const findings: string[] = []
  if (rows.length < 3 || rows.length > 8 || rows.some((row, index) => row.window !== index))
    findings.push(`native-resources: ${id} needs 3–8 unique consecutive raw windows.`)
  const derived = summarize(rows)
  const selected = summaries.filter(
    (row) => row.engine === derived.engine && row.cycles === derived.cycles,
  )
  if (selected.length !== 1)
    findings.push(`native-resources: ${id} summary is missing or duplicate.`)
  const summary = selected[0] ?? {}
  for (const [field, value] of Object.entries(derived)) {
    if (JSON.stringify(summary[field]) === JSON.stringify(value)) continue
    findings.push(`native-resources: ${id} ${field} differs from original raw windows.`)
  }
  if (derived.status !== 'OBSERVED_PLATEAU' || derived.gcStatus !== 'POST_GC')
    findings.push(`native-resources: ${id} post-GC heap plateau and WASM reuse are inconclusive.`)
  return findings
}

export function reconcileNativeResources(value: unknown) {
  const parsed = v.safeParse(reportSchema, value)
  if (!parsed.success) {
    const diagnostics = v.safeParse(diagnosticsSchema, value)
    return {
      complete: false,
      failures: [
        'native-resources: original native report/windows are missing or malformed.',
      ].concat(
        diagnostics.success
          ? diagnostics.output.failures.map((failure) => `native-resources: ${failure}`)
          : [],
      ),
      exclusions: diagnostics.success
        ? diagnostics.output.exclusions.map((reason) => `native-resources: ${reason}`)
        : [],
    }
  }
  const report = parsed.output
  const failures = report.failures.map((failure) => `native-resources: ${failure}`)
  failures.push(...sourceFindings(report.sources))
  if (report.nativeStatus !== 'OBSERVED_PLATEAU')
    failures.push(`native-resources: nativeStatus is ${report.nativeStatus}.`)
  if (report.summaries.length !== 6)
    failures.push('native-resources: exactly six engine/cycle summaries are required.')
  const groups = new Map<string, Window[]>()
  for (const row of report.rawWindows) {
    const key = `${row.engine}/${row.cycles}`
    const group = groups.get(key) ?? []
    group.push(row)
    groups.set(key, group)
    failures.push(
      ...row.outputFailures
        .concat(row.cleanupFailures)
        .map((failure) => `native-resources: ${key}/window-${row.window}: ${failure}`),
    )
    if (row.clearedSessions !== row.cycles || row.clearedProjectionEntries === 0)
      failures.push(
        `native-resources: ${key}/window-${row.window} session/projection release is incomplete.`,
      )
  }
  if (groups.size !== 6)
    failures.push('native-resources: both engines need raw 20/100/500-cycle windows.')
  for (const rows of groups.values()) failures.push(...groupFindings(rows, report.summaries))
  const exclusions = report.exclusions.map((reason) => `native-resources: ${reason}`)
  return { complete: failures.length === 0 && exclusions.length === 0, failures, exclusions }
}
