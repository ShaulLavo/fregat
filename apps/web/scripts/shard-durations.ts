import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import * as v from 'valibot'

/**
 * Rewrites `test/shard-durations.json` from Vitest JSON reports of the node and dom projects,
 * which `test/shard-sequencer.ts` reads to balance CI's shards.
 */
const reportSchema = v.object({
  success: v.literal(true),
  testResults: v.array(
    v.pipe(
      v.object({
        endTime: v.pipe(v.number(), v.finite()),
        name: v.string(),
        startTime: v.pipe(v.number(), v.finite()),
      }),
      v.check((result) => result.endTime >= result.startTime, 'File end precedes its start'),
    ),
  ),
})
type Report = v.InferOutput<typeof reportSchema>

const appRoot = path.join(import.meta.dirname, '..')

export function mergeDurations(reports: readonly Report[]) {
  const samples = new Map<string, number[]>()
  for (const result of reports.flatMap((report) => report.testResults)) {
    const normalized = result.name.replaceAll('\\', '/')
    const marker = '/apps/web/'
    const offset = normalized.lastIndexOf(marker)
    const key =
      offset >= 0 ? normalized.slice(offset + marker.length) : path.relative(appRoot, result.name)
    const values = samples.get(key) ?? []
    values.push((result.endTime - result.startTime) / 1000)
    samples.set(key, values)
  }
  return Object.fromEntries(
    [...samples]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, values]) => {
        const sorted = values.sort((a, b) => a - b)
        const middle = Math.floor(sorted.length / 2)
        const median =
          sorted.length % 2 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2
        return [key, Math.round(median * 10) / 10]
      }),
  )
}

if (import.meta.main) {
  const reports = process.argv
    .slice(2)
    .map((file) => v.parse(reportSchema, JSON.parse(readFileSync(file, 'utf8'))))
  if (!reports.length)
    throw new TypeError('Usage: bun scripts/shard-durations.ts <vitest-json-report>…')
  const durations = mergeDurations(reports)
  writeFileSync(
    path.join(appRoot, 'test/shard-durations.json'),
    `${JSON.stringify(durations, null, 2)}\n`,
  )
  console.log(
    `shard durations: ${Object.keys(durations).length} files from ${reports.length} reports`,
  )
}
