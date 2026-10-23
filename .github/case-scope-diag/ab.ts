import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { runCaseScope as runNew } from '../../scripts/large-file/case-scope'
import { runCaseScope as runOld } from './old/case-scope'

const variants = { old: runOld, new: runNew }
const tally: Record<
  string,
  {
    runs: number
    missingPeak: number
    peakBelow100: number
    oomKills: Record<string, number>
    exits: Record<string, number>
  }
> = {}
for (let i = 0; i < 40; i++) {
  for (const [name, run] of Object.entries(variants)) {
    const root = mkdtempSync(path.join(tmpdir(), `ab-${name}-`))
    const unit = `case-scope-ab-${process.pid}-${name}-${i}.scope`
    const outcome = await run({
      unit,
      memoryMiB: 128,
      command: ['bun', '-e', 'const b = Buffer.alloc(400 * 2 ** 20, 1); console.log(b.length)'],
      accountingFile: path.join(root, 'scope.accounting'),
      cwd: root,
      env: process.env,
      stdout: path.join(root, 'stdout.log'),
      stderr: path.join(root, 'stderr.log'),
      timeoutMs: 30_000,
    })
    rmSync(root, { recursive: true, force: true })
    const t = (tally[name] ??= {
      runs: 0,
      missingPeak: 0,
      peakBelow100: 0,
      oomKills: {},
      exits: {},
    })
    t.runs += 1
    if (outcome.memoryPeakBytes === null) t.missingPeak += 1
    else if (outcome.memoryPeakBytes < 100 * 2 ** 20) t.peakBelow100 += 1
    t.oomKills[String(outcome.oomKills)] = (t.oomKills[String(outcome.oomKills)] ?? 0) + 1
    t.exits[String(outcome.exitCode)] = (t.exits[String(outcome.exitCode)] ?? 0) + 1
  }
}
console.log('AB-RESULT', JSON.stringify(tally))
