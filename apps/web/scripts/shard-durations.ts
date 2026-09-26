import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

/**
 * Rewrites `test/shard-durations.json` from a Vitest JSON report of the node and dom projects,
 * which `test/shard-sequencer.ts` reads to balance CI's shards.
 */
type Report = { testResults: Array<{ endTime: number; name: string; startTime: number }> }

const appRoot = path.join(import.meta.dirname, '..')
const reportPath = process.argv[2]
if (!reportPath) throw new TypeError('Usage: bun scripts/shard-durations.ts <vitest-json-report>')

const report = JSON.parse(readFileSync(reportPath, 'utf8')) as Report
const durations = Object.fromEntries(
  report.testResults
    .map((result) => [
      path.relative(appRoot, result.name),
      Math.round((result.endTime - result.startTime) / 100) / 10,
    ])
    .sort(([a], [b]) => String(a).localeCompare(String(b))),
)
writeFileSync(
  path.join(appRoot, 'test/shard-durations.json'),
  `${JSON.stringify(durations, null, 2)}\n`,
)
console.log(`shard durations: ${Object.keys(durations).length} files`)
