import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as v from 'valibot'

const unknot = fileURLToPath(import.meta.resolve('unknot/bin/unknot.mjs'))

const reportSchema = v.object({
  files: v.number(),
  findings: v.array(
    v.object({
      rule: v.string(),
      key: v.string(),
      title: v.string(),
      at: v.string(),
      notes: v.array(v.string()),
    }),
  ),
})

function checkApp(app: string) {
  const result = Bun.spawnSync(['node', unknot, app, '--json'], { stderr: 'inherit' })
  if (result.signalCode || result.exitCode > 1) return result.exitCode || 2
  const report = v.parse(reportSchema, JSON.parse(result.stdout.toString()))
  const file = join(app, '.unknot.allow')
  const baseline = new Set(
    existsSync(file)
      ? readFileSync(file, 'utf8')
          .split('\n')
          .map((line) => line.trim())
          .filter((line) => line && !line.startsWith('#'))
      : [],
  )

  // Unknot can allow a new file cycle inside an existing module cycle. Use the exact keys.
  const newFindings = report.findings.filter(({ rule, key }) => !baseline.delete(`${rule} ${key}`))
  for (const finding of newFindings) {
    console.error(`${app}/${finding.at} [${finding.rule}] ${finding.title}`)
    for (const note of finding.notes) console.error(`  ${note}`)
  }
  for (const fixed of baseline) console.error(`Remove from ${file}: ${fixed}`)
  console.log(
    `${app}: ${report.files} files, ${newFindings.length} new, ${baseline.size} fixed, ${report.findings.length - newFindings.length} allowed`,
  )
  return newFindings.length || baseline.size ? 1 : 0
}

let exitCode = 0
for (const app of ['apps/web', 'apps/server', 'apps/tui']) {
  exitCode = Math.max(exitCode, checkApp(app))
}
process.exitCode = exitCode
