#!/usr/bin/env bun
// The heavy wrapper's `--host pi` launcher, bundled beside run.js. It mirrors the caller's
// checkout onto the Pi lane, runs the job there in its capped slice from the same directory,
// and writes the slice's totals where the wrapper reads a local scope's.
// Usage: launch.ts <unit> <accounting file> <command…>
import { writeFileSync } from 'node:fs'
import { shellQuote } from '../../../apps/server/src/utils/shell'
import { createScriptError, scriptFailureText } from '../../structured-errors'
import { accountingText, laneRunName, runOnLane, stopLane } from './lane-job'
import { check, resolveLane } from './remote'
import { syncLane } from './sync'

const HOST = 'pi'
const LANE = 'fregat-lane'
const MEMORY_MAX = '3G'

try {
  const [unit, accountingFile, ...command] = Bun.argv.slice(2)
  if (!unit || !accountingFile || command.length === 0) {
    throw createScriptError('Usage: launch.ts <unit> <accounting file> <command…>')
  }
  const directory = check(['git', 'rev-parse', '--show-prefix'], 'Finding the job directory')
    .toString()
    .trim()
  syncLane({ host: HOST, lane: LANE })
  const name = laneRunName(unit.replace(/\.scope$/, ''))
  // The wrapper forwards its signals here; the job runs on the Pi, so they must go there.
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) {
    process.on(signal, () => stopLane(HOST, name, signal))
  }
  const { exitCode, totals } = await runOnLane({
    host: HOST,
    root: resolveLane(HOST, LANE),
    name,
    memoryMax: MEMORY_MAX,
    command: command.map(shellQuote).join(' '),
    directory,
    evidence: `/work/tmp/fregat-evidence/${name}-${HOST}`,
  })
  writeFileSync(accountingFile, accountingText(totals, exitCode))
  process.exit(exitCode)
} catch (error) {
  console.error(scriptFailureText(error))
  process.exit(2)
}
