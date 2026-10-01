#!/usr/bin/env bun
// The heavy wrapper's `--host pi` launcher, bundled beside run.js. The wrapper holds pi.lock for
// this process's whole life, so it exits only once the Pi job is confirmed stopped or abandoned.
// It mirrors the caller's Fregat checkout onto the lane, runs the job there in its capped slice
// from the same directory, and writes the slice's totals where the wrapper reads a local scope's.
// Usage: launch.ts <unit> <accounting file> <max wall seconds> <command…>
import { writeFileSync } from 'node:fs'
import { shellQuote } from '../../../apps/server/src/utils/shell'
import { createScriptError, scriptFailureText } from '../../structured-errors'
import { fregatCheckout } from './checkout'
import { DEFAULT_LIMITS } from './lane-command'
import {
  accountingText,
  laneRunName,
  runOnLane,
  signalExit,
  signalsDelivered,
  sshTransport,
} from './lane-job'
import { check, resolveLane } from './remote'
import { syncLane } from './sync'

const HOST = 'pi'
const LANE = 'fregat-lane'
const MEMORY_MAX = '3G'

// Recorded from the first instant: a signal during sync or startup must stop the launch.
const cancel = new AbortController()
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) {
  process.on(signal, () => {
    if (!cancel.signal.aborted) console.error(`[pi-lane] ${signal}: cancelling the Pi job`)
    cancel.abort(signal)
  })
}

try {
  const [unit, accountingFile, maxWall, ...command] = Bun.argv.slice(2)
  if (!unit || !accountingFile || !maxWall || command.length === 0) {
    throw createScriptError(
      'Usage: launch.ts <unit> <accounting file> <max wall seconds> <command…>',
    )
  }
  fregatCheckout()
  const directory = check(['git', 'rev-parse', '--show-prefix'], 'Finding the job directory')
    .toString()
    .trim()
  await signalsDelivered()
  if (!cancel.signal.aborted) syncLane({ host: HOST, lane: LANE })
  await signalsDelivered()
  if (cancel.signal.aborted) {
    console.error('[pi-lane] cancelled before the Pi job started')
    const exitCode = signalExit(cancel.signal.reason)
    writeFileSync(accountingFile, accountingText(null, exitCode))
    process.exit(exitCode)
  }
  const name = laneRunName(unit.replace(/\.scope$/, ''))
  const outcome = await runOnLane(
    {
      ...DEFAULT_LIMITS,
      maxWallSec: Number(maxWall),
      host: HOST,
      root: resolveLane(HOST, LANE),
      name,
      memoryMax: MEMORY_MAX,
      command: command.map(shellQuote).join(' '),
      directory,
      evidence: `/work/tmp/fregat-evidence/${name}-${HOST}`,
    },
    { transport: sshTransport(HOST), signal: cancel.signal },
  )
  if (!outcome.started) console.error('[pi-lane] cancelled before the Pi job started')
  writeFileSync(accountingFile, accountingText(outcome.totals, outcome.exitCode))
  process.exit(outcome.exitCode)
} catch (error) {
  console.error(scriptFailureText(error))
  process.exit(2)
}
