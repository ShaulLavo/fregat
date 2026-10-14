import { createHash } from 'node:crypto'
import { canonicalHast, observeHast } from '../../packages/markdown/test/qualification'
import { seededChunks } from '../../packages/markdown/test/schedules'
import type { MarkdownBlock } from '../../packages/markdown/src/utils/blocks'
import { blockToHast, createHastProcessor } from '../../packages/markdown/src/utils/hast'
import { createMarkdownSession } from '../../packages/markdown/src/utils/session'
import type { BenchmarkSample } from './bench-types'
import {
  fixedChunks,
  referenceRevisions,
  STREAM_UNITS,
  type BenchmarkFamily,
  type Workload,
} from './workloads'

type HastRoot = ReturnType<typeof blockToHast>
type Extensions = Parameters<typeof createHastProcessor>[0]
type NativeContext = ReturnType<typeof nativeContext>
type Inspection = { digest: string; characters: number; elements: number }
type Update = {
  parseMs: number
  projectionMs: number
  cpuMs: number
  roots: readonly HastRoot[]
  convertedBlocks: number
  reusedBlocks: number
}

export type NativeTrial = {
  readonly samples: readonly BenchmarkSample[]
  readonly failures: readonly string[]
}

export function completedTrial(input: {
  family: BenchmarkFamily
  workload: Workload
  trial: number
  extensions: Extensions
}): NativeTrial {
  const context = nativeContext(input.extensions)
  const result = timedUpdate(context, input.workload.source, false)
  const inspection = inspectOutput(context, result.roots)
  const outputMatches = finalMatches(result.roots, input.workload.source, input.extensions)
  return {
    samples: [sample(input, 1, result, inspection, outputMatches, false)],
    failures: outputMatches
      ? []
      : [`${input.workload.id}: completed projection differs from a fresh session`],
  }
}

export function streamingTrials(input: {
  family: 'streaming-replay' | 'pathological-scaling'
  workload: Workload
  trial: number
  extensions: Extensions
}): NativeTrial {
  const schedules =
    input.family === 'pathological-scaling'
      ? [4096]
      : benchmarkStreamUnits(input.workload.sourceBytes)
  const results = schedules.map((units) =>
    streamingTrial({
      ...input,
      schedule: `fixed-${units}`,
      frames: fixedChunks(input.workload.source, units),
    }),
  )
  if (input.family === 'streaming-replay') {
    results.push(
      streamingTrial({
        ...input,
        schedule: 'seeded-24-176',
        frames: seededChunks(input.workload.source, { seed: 176, maxUnits: 24 }),
      }),
    )
  }
  return {
    samples: results.flatMap((result) => result.samples),
    failures: results.flatMap((result) => result.failures),
  }
}

export function benchmarkStreamUnits(sourceUnits: number): readonly number[] {
  return sourceUnits <= 8192 ? STREAM_UNITS : STREAM_UNITS.filter((units) => units >= 24)
}

function streamingTrial(input: {
  family: BenchmarkFamily
  workload: Workload
  trial: number
  extensions: Extensions
  schedule: string
  frames: Iterable<{ readonly offset: number; readonly text: string }>
}): NativeTrial {
  const context = nativeContext(input.extensions)
  const measured: BenchmarkSample[] = []
  const totals = { parse: 0, projection: 0, cpu: 0, updates: 0, held: 0 }
  let priorDigest: string | null = null
  let finalOffset = 0
  for (const frame of input.frames) {
    const result = timedUpdate(context, frame.text, true)
    const inspection = inspectOutput(context, result.roots)
    const held = priorDigest === inspection.digest
    const workload = { ...input.workload, id: `${input.workload.id}/${input.schedule}` }
    measured.push(sample({ ...input, workload }, frame.offset, result, inspection, null, held))
    priorDigest = inspection.digest
    finalOffset = frame.offset
    accumulate(totals, result, held)
  }
  const settlement = timedUpdate(context, input.workload.source, false)
  const inspection = inspectOutput(context, settlement.roots)
  const outputMatches =
    finalOffset === input.workload.source.length &&
    finalMatches(settlement.roots, input.workload.source, input.extensions)
  const workload = { ...input.workload, id: `${input.workload.id}/${input.schedule}` }
  measured.push({
    ...sample({ ...input, workload }, finalOffset, settlement, inspection, outputMatches, false),
    field: 'settlementMs',
  })
  accumulate(totals, settlement, false)
  for (const aggregate of aggregateSamples(
    { ...input, workload },
    totals,
    outputMatches,
    inspection.digest,
  ))
    measured.push(aggregate)
  return {
    samples: measured,
    failures: outputMatches
      ? []
      : [`${workload.id}: final coverage or fresh-session projection differs`],
  }
}

export function referenceTrial(input: { trial: number; extensions: Extensions }): NativeTrial {
  const context = nativeContext(input.extensions)
  const samples: BenchmarkSample[] = []
  const failures: string[] = []
  for (const [revision, frame] of referenceRevisions().entries()) {
    const result = timedUpdate(context, frame.source, false)
    const inspection = inspectOutput(context, result.roots)
    const outputMatches =
      finalMatches(result.roots, frame.source, input.extensions) &&
      expectedReferences(frame.id, result.roots)
    const workload = {
      id: frame.id,
      source: frame.source,
      sourceBytes: Buffer.byteLength(frame.source),
      shape: 'reference-edits',
    }
    samples.push(
      sample(
        { family: 'reference-invalidation', workload, ...input },
        revision,
        result,
        inspection,
        outputMatches,
        false,
      ),
    )
    if (!outputMatches)
      failures.push(`${frame.id}: earlier links disagree with the expected definition`)
  }
  return { samples, failures }
}

export function resourcesTrial(input: {
  trial: number
  cycles: number
  workload: Workload
  extensions: Extensions
}): NativeTrial {
  collectGarbage()
  const before = process.memoryUsage()
  const prefix = input.workload.source.slice(0, Math.floor(input.workload.source.length / 2))
  const cpu = process.cpuUsage()
  const started = performance.now()
  let digest = ''
  let outputMatches = true
  for (let cycle = 0; cycle < input.cycles; cycle += 1) {
    const result = resourceCycle(prefix, input.workload.source, input.extensions)
    digest = result.digest
    outputMatches &&= result.outputMatches
  }
  const elapsed = performance.now() - started
  const cpuUsed = process.cpuUsage(cpu)
  const reachable = process.memoryUsage()
  const collected = collectGarbage()
  const after = process.memoryUsage()
  const base = {
    family: 'resources',
    fixture: `${input.cycles}-create-update-release`,
    engine: 'remark',
    domain: 'native',
    build: 'source',
    trial: input.trial,
    revision: input.cycles,
    sourceBytes: input.workload.sourceBytes,
    outputMatches,
    cacheState: 'warm-process; sessions-released',
    outputDigest: digest,
  } satisfies Omit<BenchmarkSample, 'field' | 'sample' | 'unit'>
  const fields: readonly [string, number, 'ms' | 'bytes' | 'count'][] = [
    ['nativeCycleBatchMs', elapsed, 'ms'],
    ['nativeCycleBatchCpuMs', (cpuUsed.user + cpuUsed.system) / 1000, 'ms'],
    ['heapBeforeBytes', before.heapUsed, 'bytes'],
    ['heapReachableBytes', reachable.heapUsed, 'bytes'],
    [collected ? 'heapAfterGcBytes' : 'heapAfterReleaseBytes', after.heapUsed, 'bytes'],
    [
      collected ? 'heapAfterGcDeltaBytes' : 'heapAfterReleaseDeltaBytes',
      after.heapUsed - before.heapUsed,
      'bytes',
    ],
    ['rssAfterBytes', after.rss, 'bytes'],
    ['peakRssBytes', process.resourceUsage().maxRSS * 1024, 'bytes'],
    ['releasedSessions', input.cycles, 'count'],
  ]
  return {
    samples: fields.map(([field, value, unit]) => ({ ...base, field, sample: value, unit })),
    failures: outputMatches ? [] : ['Disposed package session retained output'],
  }
}

function nativeContext(extensions: Extensions) {
  return {
    session: createMarkdownSession(),
    processor: createHastProcessor(extensions),
    projections: new WeakMap<MarkdownBlock, HastRoot>(),
    inspections: new WeakMap<HastRoot, Inspection>(),
  }
}

function timedUpdate(context: NativeContext, text: string, live: boolean): Update {
  const cpu = process.cpuUsage()
  const started = performance.now()
  const blocks = context.session.update(text, { heal: live })
  const parsed = performance.now()
  const projection = projectBlocks(context, blocks)
  const finished = performance.now()
  const cpuUsed = process.cpuUsage(cpu)
  return {
    parseMs: parsed - started,
    projectionMs: finished - parsed,
    cpuMs: (cpuUsed.user + cpuUsed.system) / 1000,
    ...projection,
  }
}

function projectBlocks(context: NativeContext, blocks: readonly MarkdownBlock[]) {
  let convertedBlocks = 0
  const roots = blocks.map((block) => {
    const cached = context.projections.get(block)
    if (cached) return cached
    const root = blockToHast(block, context.processor)
    context.projections.set(block, root)
    convertedBlocks += 1
    return root
  })
  return { roots, convertedBlocks, reusedBlocks: blocks.length - convertedBlocks }
}

function inspectOutput(context: NativeContext, roots: readonly HastRoot[]): Inspection {
  const hash = createHash('sha256')
  let characters = 0
  let elements = 0
  for (const root of roots) {
    const inspection = inspectRoot(context, root)
    hash.update(inspection.digest)
    characters += inspection.characters
    elements += inspection.elements
  }
  return { digest: hash.digest('hex'), characters, elements }
}

function inspectRoot(context: NativeContext, root: HastRoot): Inspection {
  const cached = context.inspections.get(root)
  if (cached) return cached
  const observation = observeHast(root)
  const inspection = {
    digest: createHash('sha256').update(JSON.stringify(observation)).digest('hex'),
    characters: observation.text.length,
    elements: observation.elements.length,
  }
  context.inspections.set(root, inspection)
  return inspection
}

function finalMatches(roots: readonly HastRoot[], source: string, extensions: Extensions): boolean {
  const fresh = nativeContext(extensions)
  const result = timedUpdate(fresh, source, false)
  return canonicalHast(combineRoots(roots)) === canonicalHast(combineRoots(result.roots))
}

function combineRoots(roots: readonly HastRoot[]): HastRoot {
  return { type: 'root', children: roots.flatMap((root) => root.children) }
}

function sample(
  input: { family: BenchmarkFamily; workload: Workload; trial: number },
  revision: number,
  update: Update,
  inspection: Inspection,
  outputMatches: boolean | null,
  held: boolean,
): BenchmarkSample {
  return {
    family: input.family,
    fixture: input.workload.id,
    engine: 'remark',
    domain: 'native',
    build: 'source',
    trial: input.trial,
    revision,
    field: 'nativeUpdateMs',
    sample: update.parseMs + update.projectionMs,
    unit: 'ms',
    sourceBytes: input.workload.sourceBytes,
    outputMatches,
    cacheState: 'warm-process; per-message session; block-identity projection-cache',
    outputDigest: inspection.digest,
    detail: {
      parseMs: update.parseMs,
      projectionMs: update.projectionMs,
      cpuMs: update.cpuMs,
      convertedBlocks: update.convertedBlocks,
      reusedBlocks: update.reusedBlocks,
      unchangedProjection: held,
    },
  }
}

function accumulate(
  totals: { parse: number; projection: number; cpu: number; updates: number; held: number },
  update: Update,
  held: boolean,
) {
  totals.parse += update.parseMs
  totals.projection += update.projectionMs
  totals.cpu += update.cpuMs
  totals.updates += 1
  if (held) totals.held += 1
}

function aggregateSamples(
  input: { family: BenchmarkFamily; workload: Workload; trial: number },
  totals: { parse: number; projection: number; cpu: number; updates: number; held: number },
  outputMatches: boolean,
  digest: string,
): BenchmarkSample[] {
  const fields: readonly [string, number, 'ms' | 'count'][] = [
    ['totalNativeParseMs', totals.parse, 'ms'],
    ['totalNativeProjectionMs', totals.projection, 'ms'],
    ['totalNativeCpuMs', totals.cpu, 'ms'],
    ['completedUpdates', totals.updates, 'count'],
    ['unchangedProjectionUpdates', totals.held, 'count'],
    ['droppedUpdates', 0, 'count'],
  ]
  return fields.map(([field, value, unit]) => ({
    family: input.family,
    fixture: input.workload.id,
    engine: 'remark',
    domain: 'native',
    build: 'source',
    trial: input.trial,
    revision: input.workload.source.length,
    field,
    sample: value,
    unit,
    sourceBytes: input.workload.sourceBytes,
    outputMatches,
    cacheState: 'warm-process; all scheduled updates completed synchronously',
    outputDigest: digest,
  }))
}

function expectedReferences(id: string, roots: readonly HastRoot[]): boolean {
  const links = observeHast(combineRoots(roots)).elements.filter((element) => element.tag === 'a')
  if (id === 'unresolved' || id === 'removed-definition') return links.length === 0
  const destination = new Map([
    ['late-definition', 'first'],
    ['edited-definition', 'second'],
    ['early-definition', 'third'],
  ]).get(id)
  return (
    links.length === 64 &&
    links.every((link) => link.attributes.href === `https://example.test/${destination}`)
  )
}

function resourceCycle(
  prefix: string,
  source: string,
  extensions: Extensions,
): { digest: string; outputMatches: boolean } {
  const context = nativeContext(extensions)
  timedUpdate(context, prefix, true)
  const completed = timedUpdate(context, source, false)
  const inspection = inspectOutput(context, completed.roots)
  const cleared = context.session.update('', { heal: false })
  return { digest: inspection.digest, outputMatches: cleared.length === 0 }
}

export function collectGarbage(): boolean {
  if (typeof Bun === 'undefined') return false
  Bun.gc(true)
  return true
}
