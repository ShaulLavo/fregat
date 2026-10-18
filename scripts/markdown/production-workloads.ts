import { createHash } from 'node:crypto'

import { createScriptError } from '../structured-errors'

import { MARKDOWN_CASES } from '../../packages/markdown/test/fixtures/cases'
import {
  mixedWorkload,
  pathologicalWorkloads,
  referenceRevisions,
  workload,
  type BenchmarkFamily,
  type Workload,
} from './workloads.ts'

const METRICS = ['updateP95', 'settlementP95', 'mountP95', 'streamCpu'] as const
export type ProductionWorkload = Workload & {
  readonly family: BenchmarkFamily
  readonly arrival: 'paced' | 'burst-coalesced'
  readonly scheduleUnits: number
  readonly scheduleId: string
  readonly scene: 'message' | 'timeline' | 'resources'
  readonly cache: 'cold' | 'warm'
  readonly count: number
}

const COLD = ['plain-paragraph', 'fenced-typescript', 'html-details', 'math-display-fallback']
const EXTENSIONS = COLD.slice(1).concat(['math-inline-fallback', 'unknown-fence-language'])
const REALISTIC = [17, 23, 41, 19, 87, 64, 29, 131, 47, 73, 24, 96]

export function productionBrowserWorkloads(): ProductionWorkload[] {
  const completed = [256, 2048, 8192, 32768, 131072].map((bytes) =>
    entry(mixedWorkload(bytes), 'warm-completed'),
  )
  const curated = MARKDOWN_CASES.slice(0, 8).map((fixture) =>
    entry(workload(fixture.id, fixture.source, 'curated'), 'warm-completed'),
  )
  const streams = [256, 2048, 8192, 32768, 131072].flatMap(streamSchedules)
  const realistic = COLD.map((id) => ({
    ...named(id, 'streaming-replay'),
    scheduleUnits: 0,
    scheduleId: 'provider-paced-v1',
    id: `streaming-replay-${id}-provider-paced-v1`,
  }))
  const pathological = [1024, 16384, 262144, 1048576].flatMap((bytes) =>
    pathologicalWorkloads(bytes).map((source) => ({
      ...entry(source, 'pathological-scaling'),
      arrival: 'burst-coalesced' as const,
      scheduleUnits: 4096,
      scheduleId: 'burst-fixed-4096-paint-every-32-updates',
    })),
  )
  const references = referenceRevisions().map((revision) => ({
    ...entry(workload(revision.id, revision.source, 'reference-edits'), 'reference-invalidation'),
    scheduleId: 'pinned-definition-add-edit-remove-replace',
  }))
  const timeline = [1, 20, 100, 500].map((count) => ({
    ...entry(
      workload(`messages-${count}`, 'Stable paragraph.\n\nTail **grows**.', 'timeline'),
      'timeline-input',
    ),
    scene: 'timeline' as const,
    count,
  }))
  const resources = [20, 100, 500].map((count) => ({
    ...entry(
      workload(
        `cycles-${count}`,
        'Cycle **completed**.\n\n```ts\nconst count = 42\n```',
        'lifetimes',
      ),
      'resources',
    ),
    scene: 'resources' as const,
    count,
  }))
  const payload = ['cold', 'warm'].map((cache) => ({
    ...entry(
      workload(cache, '```ts\nconst payload = true\n```\n\nInline $$x^2$$ result.', 'payload'),
      'payload',
    ),
    cache: cache === 'cold' ? ('cold' as const) : ('warm' as const),
  }))
  const cold: ProductionWorkload[] = COLD.map((id) => ({
    ...named(id, 'cold-mount'),
    cache: 'cold',
  }))
  return cold.concat(
    curated,
    completed,
    streams,
    realistic,
    pathological,
    references,
    EXTENSIONS.map((id) => named(id, 'highlighting-extensions')),
    [
      entry(
        workload('mermaid-graph', '```mermaid\ngraph TD\n A[Begin] --> B[End]\n```', 'diagram'),
        'highlighting-extensions',
      ),
    ],
    timeline,
    resources,
    payload,
  )
}

function streamSchedules(bytes: number): ProductionWorkload[] {
  const units = bytes <= 8192 ? [1, 8, 24, 64, 256] : [24, 64, 256]
  return units.map((size) => ({
    ...entry(mixedWorkload(bytes), 'streaming-replay'),
    id: `streaming-replay-mixed-${bytes}-fixed-${size}`,
    scheduleUnits: size,
    scheduleId: `paced-fixed-${size}`,
  }))
}

function entry(source: Workload, family: BenchmarkFamily): ProductionWorkload {
  return {
    ...source,
    id: `${family}-${source.id}`,
    family,
    arrival: 'paced',
    scheduleUnits: 0,
    scheduleId: 'completed-message',
    scene: 'message',
    cache: 'warm',
    count: 1,
  }
}

function named(id: string, family: BenchmarkFamily) {
  const fixture = MARKDOWN_CASES.find((candidate) => candidate.id === id)
  if (!fixture)
    throw createScriptError('Missing production fixture.', {
      internal: { id },
    })
  return entry(workload(id, fixture.source, 'curated'), family)
}

export function productionUpdates(entry: ProductionWorkload) {
  if (entry.family === 'reference-invalidation')
    return referenceRevisions()
      .slice(
        0,
        referenceRevisions().findIndex(
          (revision) => entry.id === `reference-invalidation-${revision.id}`,
        ) + 1,
      )
      .map((revision) => revision.source)
  if (entry.scheduleId === 'provider-paced-v1') return realisticPrefixes(entry.source)
  if (entry.scheduleUnits === 0) return []
  const updates: string[] = []
  for (
    let offset = entry.scheduleUnits;
    offset < entry.source.length;
    offset += entry.scheduleUnits
  )
    updates.push(entry.source.slice(0, offset))
  return updates.concat([entry.source])
}

function realisticPrefixes(source: string) {
  const updates: string[] = []
  let offset = 0
  let index = 0
  while (offset < source.length) {
    offset = Math.min(source.length, offset + (REALISTIC[index % REALISTIC.length] ?? 24))
    updates.push(source.slice(0, offset))
    index += 1
  }
  return updates
}

export function productionTimingManifest() {
  return {
    schemaVersion: 1 as const,
    domain: 'browser' as const,
    build: 'production' as const,
    workloads: productionBrowserWorkloads().map((entry) => ({
      id: entry.id,
      sourceBytes: entry.sourceBytes,
      sourceSha256: createHash('sha256').update(entry.source).digest('hex'),
      scheduleUnits: entry.scheduleUnits,
      scheduleId: entry.scheduleId,
      arrival: entry.arrival,
      metrics: METRICS,
      expectedInputUpdates: productionUpdates(entry).length + 1,
      paintPolicy: entry.arrival === 'paced' ? ('every-revision' as const) : ('sampled' as const),
    })),
  }
}

/** Deadlines are relative to one producer start, never to completion of the previous render. */
export function productionArrivalOffsets(entry: ProductionWorkload): number[] {
  const count = Math.max(1, productionUpdates(entry).length)
  let offset = 0
  return Array.from({ length: count }, (_, index) => {
    const current = offset
    if (entry.arrival === 'burst-coalesced') offset = Math.floor((index + 1) / 32) * 40
    else
      offset += entry.scheduleId === 'provider-paced-v1' ? [18, 24, 36, 12, 48, 20][index % 6] : 40
    return current
  })
}
