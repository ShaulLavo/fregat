import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
export function writeReport(report, outputDir) {
  writeFileSync(join(outputDir, 'results.json'), JSON.stringify(report, null, 2))
}
