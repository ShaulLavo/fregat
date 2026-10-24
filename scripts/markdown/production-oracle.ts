import { createHash } from 'node:crypto'
import { rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { productionMismatchWitness } from './production-mismatch'
import * as v from 'valibot'
import type {
  ProductionMarkdownFrame,
  ProductionMismatchSample,
  ProductionOracleSink,
} from '../../apps/web/test/factories/markdown-production-types'
import { foldJsonl, writeJsonl, type RawTimingRef } from './timing-artifacts'
import { createScriptError } from '../structured-errors'

export type ProductionInput = Pick<ProductionMarkdownFrame, 'inputSha256' | 'inputUtf16Units'>

export type ProductionOracleWireRecord = Parameters<ProductionOracleSink>[0]
export type ProductionOracleRecord = v.InferOutput<typeof oracleRecord>
export type ProductionOracleIdentity = v.InferOutput<typeof productionOracleIdentitySchema>
export type ProductionOracle = v.InferOutput<typeof productionOracleSchema>
export function oracleIdentity(frame: ProductionMarkdownFrame): ProductionOracleIdentity {
  return {
    inputSha256: frame.inputSha256,
    paintedOutput: frame.paintedOutput,
    observationSha256: hash(JSON.stringify(frame)),
  }
}
export async function writeProductionOracle(options: {
  readonly root: string
  readonly file: string
  readonly records: AsyncIterable<ProductionOracleWireRecord>
  readonly engine?: string
}): Promise<{ correctness: ProductionOracle; freshCompleted: ProductionOracleIdentity }> {
  const frames: ProductionOracleIdentity[] = []
  const state: OracleCaptureState = { final: null, fresh: null, mismatch: null }

  const artifact = await writeJsonl({
    ...options,
    records: observedOracleRecords(options, frames, state),
  })
  if (!state.final || !state.fresh || frames.length === 0) throw invalid('missing completion')
  if (state.mismatch) {
    const verified = await foldJsonl({
      root: options.root,
      file: artifact.path,
      expected: artifact,
      parse: parseProductionOracleRecord,
      consume() {},
    })
    await writeWitness(options.root, `${options.file}.mismatch.json`, {
      ...state.mismatch,
      capture: { state: 'eof-verified', artifacts: [verified] },
    })
    await rm(path.resolve(options.root, `${options.file}.mismatch.provisional.json`))
  }
  const { final, fresh } = state
  return { correctness: { artifact, frames, ...final }, freshCompleted: fresh }
}

type OracleCaptureState = OracleCollection & {
  mismatch: ReturnType<typeof productionMismatchWitness> | null
}

async function* observedOracleRecords(
  options: Parameters<typeof writeProductionOracle>[0],
  frames: ProductionOracleIdentity[],
  state: OracleCaptureState,
) {
  // Only the final observation survives one sink acknowledgement, until fresh completion.
  let final: ProductionMarkdownFrame | null = null
  for await (const record of options.records) {
    if (
      record.kind === 'fresh' &&
      final &&
      record.frame.paintedOutput.digest !== final.paintedOutput.digest
    ) {
      state.mismatch = productionMismatchWitness({
        actual: record.frame,
        expected: final,
        actualEngine: options.engine ?? 'unspecified',
        expectedEngine: options.engine ?? 'unspecified',
      })
      await writeWitness(options.root, `${options.file}.mismatch.provisional.json`, {
        ...state.mismatch,
        capture: { state: 'provisional' },
      })
    }
    final = record.kind === 'final' ? record.frame : null
    collectOracleRecord(parseProductionOracleRecord(record), frames, state)
    yield record
  }
  if (!state.final || !state.fresh || frames.length === 0) throw invalid('missing completion')
}

type OracleCollection = {
  final: Omit<ProductionOracle, 'artifact' | 'frames'> | null
  fresh: ProductionOracleIdentity | null
}
function collectOracleRecord(
  record: ProductionOracleRecord,
  frames: ProductionOracleIdentity[],
  state: OracleCollection,
) {
  if (state.fresh) throw invalid('record after fresh completion')
  if (record.kind === 'frame') {
    if (state.final) throw invalid('frame after final')
    frames.push(oracleIdentity(record.frame))
    return
  }
  if (record.kind === 'final') {
    if (state.final || frames.length === 0) throw invalid('unexpected final')
    state.final = {
      final: oracleIdentity(record.frame),
      fullyReady: record.fullyReady,
      longTasks: record.longTasks,
      resources: record.resources,
    }
    return
  }
  if (!state.final) throw invalid('fresh before final')
  state.fresh = oracleIdentity(record.frame)
}

// The producer cannot advance until the consumer has released its one record.
export async function* oracleCallbackRecords<
  T extends ProductionOracleWireRecord = ProductionOracleWireRecord,
>(produce: (emit: (record: T) => Promise<void>) => Promise<void>): AsyncGenerator<T> {
  type Entry = {
    readonly record: T
    readonly consumed: ReturnType<typeof Promise.withResolvers<void>>
  }
  let next = Promise.withResolvers<Entry | null>()
  let held: Entry | null = null
  let closed = false
  const producer = produce(async (record) => {
    if (closed) throw invalid('consumer stopped')
    const consumed = Promise.withResolvers<void>()
    next.resolve({ record, consumed })
    await consumed.promise
  }).then(
    () => next.resolve(null),
    (error) => {
      if (!closed) next.reject(error)
    },
  )
  try {
    while ((held = await next.promise) !== null) {
      next = Promise.withResolvers<Entry | null>()
      yield held.record
      held.consumed.resolve()
      held = null
    }
  } finally {
    closed = true
    held?.consumed.reject(invalid('consumer stopped'))
    await producer
  }
}

const nonnegative = v.pipe(v.number(), v.finite(), v.minValue(0))
const count = v.pipe(nonnegative, v.integer())
const digest = v.pipe(v.string(), v.regex(/^[a-f0-9]{64}$/u))
const output = v.object({ digest, textBytes: count, elementCount: count })
const observedElement = v.object({
  tag: v.string(),
  text: v.string(),
  attributes: v.record(v.string(), v.string()),
  parents: v.optional(v.array(v.string())),
})
function isObservedElements(value: unknown): value is ProductionMarkdownFrame['elements'] {
  return Array.isArray(value) && value.every((element) => v.is(observedElement, element))
}
const observedFrame = v.looseObject({
  revision: count,
  observedRevision: count,
  inputSha256: digest,
  inputUtf16Units: count,
  live: v.boolean(),
  scheduled: nonnegative,
  received: nonnegative,
  committed: nonnegative,
  painted: nonnegative,
  parseCalls: count,
  parserWallMs: nonnegative,
  output,
  paintedOutput: output,
  text: v.string(),
  // Validate one element at a time without Valibot cloning the full projection array.
  elements: v.custom<ProductionMarkdownFrame['elements']>(isObservedElements),
})
const nativeResourceMs = v.pipe(v.number(), v.finite(), v.brand('NativeResourceMs'))
const usableResourceMs = v.pipe(nonnegative, v.brand('UsableResourceMs'))
export const productionResourceObservationSchema = v.strictObject({
  name: v.string(),
  kind: v.picklist(['host', 'grammar', 'resolver', 'javascript', 'other']),
  initiatorType: v.string(),
  startTime: nonnegative,
  duration: nativeResourceMs,
  transferSize: nonnegative,
  decodedBodySize: nonnegative,
})
export type ProductionResourceObservation = v.InferOutput<
  typeof productionResourceObservationSchema
>
export type ResourceTimingView = {
  readonly raw: ProductionResourceObservation
  readonly timing:
    | { readonly kind: 'usable'; readonly durationMs: v.InferOutput<typeof usableResourceMs> }
    | { readonly kind: 'unusable'; readonly reason: 'negative-native-duration' }
}
export function resourceTimingView(raw: ProductionResourceObservation): ResourceTimingView {
  if (raw.duration < 0)
    return { raw, timing: { kind: 'unusable', reason: 'negative-native-duration' } }
  return { raw, timing: { kind: 'usable', durationMs: v.parse(usableResourceMs, raw.duration) } }
}
export const productionOracleIdentitySchema = v.strictObject({
  inputSha256: digest,
  paintedOutput: output,
  observationSha256: digest,
})
export const productionOracleSchema = v.object({
  artifact: v.strictObject({
    path: v.string(),
    sha256: digest,
    byteLength: count,
    recordCount: count,
  }),
  frames: v.array(productionOracleIdentitySchema),
  final: productionOracleIdentitySchema,
  fullyReady: nonnegative,
  longTasks: v.nullable(v.array(nonnegative)),
  resources: v.array(productionResourceObservationSchema),
})
const oracleRecord = v.variant('kind', [
  v.object({ kind: v.literal('frame'), frame: observedFrame }),
  v.object({
    kind: v.literal('final'),
    frame: observedFrame,
    fullyReady: nonnegative,
    longTasks: v.nullable(v.array(nonnegative)),
    resources: v.array(productionResourceObservationSchema),
  }),
  v.object({ kind: v.literal('fresh'), frame: observedFrame }),
])
// The schema only brands numbers; validation keeps original frames and projection arrays.
function isProductionOracleRecord(value: unknown): value is ProductionOracleRecord {
  return v.is(oracleRecord, value)
}
export function parseProductionOracleRecord(value: unknown): ProductionOracleRecord {
  if (!isProductionOracleRecord(value)) throw invalid('record shape is invalid')
  return value
}

type OracleArm = {
  readonly correctness: ProductionOracle
  readonly freshCompleted: ProductionOracleIdentity
}
function recordsFromFile(root: string, arm: OracleArm, artifacts: RawTimingRef[]) {
  return oracleCallbackRecords<ProductionOracleRecord>(async (emit) => {
    artifacts.push(
      await foldJsonl({
        root,
        file: arm.correctness.artifact.path,
        expected: arm.correctness.artifact,
        parse: parseProductionOracleRecord,
        consume: emit,
      }),
    )
  })
}
export async function reconcileProductionOracles(options: {
  readonly root: string
  readonly first: OracleArm
  readonly second: OracleArm
  readonly inputs: readonly ProductionInput[]
}): Promise<readonly RawTimingRef[]> {
  const artifacts: RawTimingRef[] = []
  const first = recordsFromFile(options.root, options.first, artifacts)
  const second = recordsFromFile(options.root, options.second, artifacts)
  let index = 0
  try {
    while (true) {
      const [a, b] = await Promise.all([first.next(), second.next()])
      if (a.done && b.done) break
      if (a.done || b.done) throw invalid('paired record count differs', index)
      checkRecord(a.value, options.first, options.inputs, index)
      checkRecord(b.value, options.second, options.inputs, index)
      if (a.value.kind !== b.value.kind || projection(a.value.frame) !== projection(b.value.frame))
        throw invalid('paired projection differs', index)
      index++
    }
    if (index !== options.inputs.length + 2)
      throw invalid('missing frame/final/fresh observation', index)
    return artifacts
  } finally {
    await Promise.allSettled([first.return(undefined), second.return(undefined)])
  }
}
export async function retainTimingOracleMismatch(options: {
  readonly root: string
  readonly file: string
  readonly engine: string
  readonly oracle: ProductionOracle
  readonly sample: ProductionMismatchSample
}) {
  const identity = options.oracle.frames[options.sample.expectedIndex]
  if (
    !Number.isInteger(options.sample.expectedIndex) ||
    !identity ||
    JSON.stringify(identity.paintedOutput) !== JSON.stringify(options.sample.expected)
  )
    throw invalid('mismatch expectation is absent from independent schedule')
  let expected: ProductionMarkdownFrame | null = null
  const artifact = await foldJsonl({
    root: options.root,
    file: options.oracle.artifact.path,
    expected: options.oracle.artifact,
    parse: parseProductionOracleRecord,
    consume(record, index) {
      if (index !== options.sample.expectedIndex) return
      if (
        record.kind !== 'frame' ||
        JSON.stringify(oracleIdentity(record.frame)) !== JSON.stringify(identity)
      )
        throw invalid('mismatch expectation differs from independent replay', index)
      expected = record.frame
    },
  })
  if (!expected) throw invalid('mismatch expectation is absent from independent replay')
  await writeWitness(options.root, options.file, {
    ...productionMismatchWitness({
      actual: options.sample.actual,
      expected,
      actualEngine: options.engine,
      expectedEngine: options.engine,
    }),
    capture: { state: 'eof-verified', artifacts: [artifact] },
  })
}

export async function retainPairedOracleMismatch(options: {
  readonly root: string
  readonly file: string
  readonly first: OracleArm & { readonly engine: string }
  readonly second: OracleArm & { readonly engine: string }
}): Promise<boolean> {
  const artifacts: RawTimingRef[] = []
  const first = recordsFromFile(options.root, options.first, artifacts)
  const second = recordsFromFile(options.root, options.second, artifacts)
  let witness: ReturnType<typeof productionMismatchWitness> | null = null
  try {
    while (true) {
      const [a, b] = await Promise.all([first.next(), second.next()])
      if (a.done && b.done) break
      if (a.done || b.done || a.value.kind !== b.value.kind)
        throw invalid('paired record count/order differs')
      if (witness || projection(a.value.frame) === projection(b.value.frame)) continue
      witness = productionMismatchWitness({
        actual: b.value.frame,
        expected: a.value.frame,
        actualEngine: options.second.engine,
        expectedEngine: options.first.engine,
      })
    }
    if (!witness) return false
    await writeWitness(options.root, options.file, {
      ...witness,
      capture: { state: 'eof-verified', artifacts },
    })
    return true
  } finally {
    await Promise.allSettled([first.return(undefined), second.return(undefined)])
  }
}
type CapturedWitness = ReturnType<typeof productionMismatchWitness> & {
  readonly capture:
    | { readonly state: 'provisional' }
    | { readonly state: 'eof-verified'; readonly artifacts: readonly RawTimingRef[] }
}

async function writeWitness(root: string, file: string, witness: CapturedWitness) {
  const text = JSON.stringify(witness) + '\n'
  if (Buffer.byteLength(text) > witness.limits.maxJsonBytes)
    throw invalid('mismatch witness exceeds its bound')
  await writeFile(path.resolve(root, file), text, { flag: 'wx' })
}

function checkRecord(
  record: ProductionOracleRecord,
  arm: OracleArm,
  inputs: readonly ProductionInput[],
  index: number,
) {
  const expectedKind = recordKind(index, inputs.length)
  if (record.kind !== expectedKind || index >= inputs.length + 2)
    throw invalid('record order differs', index)
  const identity = recordIdentity(record.kind, arm, index)
  if (!identity || JSON.stringify(oracleIdentity(record.frame)) !== JSON.stringify(identity))
    throw invalid('observation differs from raw trial', index)
  const input = inputs[Math.min(index, inputs.length - 1)]
  if (
    input === undefined ||
    record.frame.inputSha256 !== input.inputSha256 ||
    record.frame.inputUtf16Units !== input.inputUtf16Units
  )
    throw invalid('input differs from frozen schedule', index)
  const actual = record.frame.paintedOutput
  if (
    actual.digest !== hash(projection(record.frame)) ||
    actual.textBytes !== Buffer.byteLength(record.frame.text) ||
    actual.elementCount !== record.frame.elements.length
  )
    throw invalid('projection receipt differs from observation', index)
  if (record.kind === 'frame' && record.frame.live !== index + 1 < inputs.length)
    throw invalid('live state differs', index)
  if (
    record.kind === 'final' &&
    (identity.observationSha256 !== arm.correctness.frames.at(-1)?.observationSha256 ||
      JSON.stringify({
        fullyReady: record.fullyReady,
        longTasks: record.longTasks,
        resources: record.resources,
      }) !==
        JSON.stringify({
          fullyReady: arm.correctness.fullyReady,
          longTasks: arm.correctness.longTasks,
          resources: arm.correctness.resources,
        }))
  )
    throw invalid('final differs from last frame or metadata', index)
  if (
    record.kind === 'fresh' &&
    (record.frame.live ||
      JSON.stringify(actual) !== JSON.stringify(arm.correctness.final.paintedOutput))
  )
    throw invalid('fresh completion differs from final', index)
  if (index >= inputs.length && record.frame.text.length === 0)
    throw invalid('completed projection is empty', index)
}
function recordKind(index: number, inputs: number): ProductionOracleRecord['kind'] {
  if (index < inputs) return 'frame'
  if (index === inputs) return 'final'
  return 'fresh'
}
function recordIdentity(kind: ProductionOracleRecord['kind'], arm: OracleArm, index: number) {
  if (kind === 'frame') return arm.correctness.frames[index]
  if (kind === 'final') return arm.correctness.final
  return arm.freshCompleted
}
function projection(frame: ProductionMarkdownFrame) {
  return JSON.stringify({ text: frame.text, elements: frame.elements })
}
function invalid(reason: string, index?: number) {
  return createScriptError(`Production oracle ${reason}.`, { internal: { index } })
}
function hash(value: string) {
  return createHash('sha256').update(value).digest('hex')
}
