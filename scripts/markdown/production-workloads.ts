import { createHash } from 'node:crypto'

import {
  mixedWorkload,
  pathologicalWorkloads,
  referenceRevisions,
  workload,
  type Workload,
} from './workloads.ts'

const METRICS = ['updateP95', 'settlementP95', 'mountP95', 'streamCpu'] as const
type ProductionWorkload = Workload & {
  readonly family: string
  readonly arrival: 'paced' | 'burst-coalesced'
  readonly scheduleUnits: number
  readonly scheduleId: string
}

export function productionBrowserWorkloads() {
  const ordinary: ProductionWorkload[] = [256, 2048, 8192, 32768, 131072].map((bytes) => ({
    ...mixedWorkload(bytes),
    family: 'streaming-replay',
    arrival: 'paced' as const,
    scheduleUnits: 24,
    scheduleId: 'paced-fixed-24',
  }))
  const pathological: ProductionWorkload[] = pathologicalWorkloads(1_048_576).map((entry) => ({
    ...entry,
    family: 'pathological-scaling',
    arrival: 'burst-coalesced' as const,
    scheduleUnits: 4096,
    scheduleId: 'burst-fixed-4096-paint-every-32-updates',
  }))
  const revisions = referenceRevisions()
  const references = {
    ...workload('reference-edits', revisions.at(-1)?.source ?? '', 'reference-edits'),
    family: 'reference-invalidation',
    arrival: 'paced' as const,
    scheduleUnits: 0,
    scheduleId: 'pinned-definition-add-edit-remove-replace',
  }
  return ordinary.concat(pathological, [references])
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
      expectedInputUpdates:
        entry.scheduleUnits === 0
          ? referenceRevisions().length
          : Math.ceil(entry.source.length / entry.scheduleUnits) + 1,
      paintPolicy: entry.arrival === 'paced' ? ('every-revision' as const) : ('sampled' as const),
    })),
  }
}
