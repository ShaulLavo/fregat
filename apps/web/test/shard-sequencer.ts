import { readFileSync } from 'node:fs'
import path from 'node:path'
import { BaseSequencer, type TestSpecification } from 'vitest/node'

/**
 * Seconds per test file from a recent run, relative to `apps/web`. Stale or missing entries only
 * cost balance: every shard computes the same assignment, so each file still runs exactly once.
 */
const DURATIONS_FILE = path.join(import.meta.dirname, 'shard-durations.json')
/** Import, setup and environment time a file pays beyond its tests. */
const FILE_OVERHEAD_SECONDS = 0.5

/**
 * Vitest shards by a hash of the path, which put 2.6x the test time on one shard as on another.
 * This deals files out by recorded duration, longest first, each to the lightest shard.
 */
export default class DurationSequencer extends BaseSequencer {
  override async shard(files: TestSpecification[]) {
    const { count, index } = this.ctx.config.shard ?? { count: 1, index: 1 }
    const durations = readDurations()
    const fallback = median(Object.values(durations))
    const root = this.ctx.config.root
    const weighted = files
      .map((spec) => {
        const key = path.relative(root, spec.moduleId)
        return { key, spec, weight: (durations[key] ?? fallback) + FILE_OVERHEAD_SECONDS }
      })
      .sort((a, b) => b.weight - a.weight || compareKeys(a.key, b.key))
    const loads = Array.from({ length: count }, () => 0)
    const shards: TestSpecification[][] = Array.from({ length: count }, () => [])
    for (const file of weighted) {
      const lightest = loads.indexOf(Math.min(...loads))
      loads[lightest] = (loads[lightest] ?? 0) + file.weight
      shards[lightest]?.push(file.spec)
    }
    return shards[index - 1] ?? []
  }
}

/** Byte order, never locale order: every shard must sort the same way. */
function compareKeys(a: string, b: string) {
  if (a === b) return 0
  return a < b ? -1 : 1
}

function readDurations(): Record<string, number> {
  return JSON.parse(readFileSync(DURATIONS_FILE, 'utf8')) as Record<string, number>
}

function median(values: readonly number[]) {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)] ?? 0
}
