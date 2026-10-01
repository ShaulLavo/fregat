#!/usr/bin/env bun
// Runs one command on the Pi lane in its own memory-capped slice, then copies its run directory
// here. Sync first. It takes the Pi lock the heavy wrapper uses, so it never runs beside a
// wrapper job or a sync. The command is joined and run by bash from the lane checkout, as ssh
// does; $LANE_RUN names its output directory there and $HEAVY_JOB_SLICE its slice.
import { writeFileSync } from 'node:fs'
import { parseArgs } from 'node:util'
import { createScriptError, scriptFailureText } from '../../structured-errors'
import { DEFAULT_LIMITS } from './lane-command'
import { memoryMax } from './lane-root'
import { laneRunName, runOnLane, sshTransport } from './lane-job'
import { holdLaneLock } from './lane-lock'
import { resolveLane, verifyLane } from './remote'

const USAGE =
  'bun scripts/heavy/pi/run.ts [--host pi] [--lane fregat-lane] [--memory-max 3G] [--max-wall 3600] [--lock-dir DIR] [--evidence DIR] <label> -- <command…>'

const cancel = new AbortController()
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) {
  process.on(signal, () => cancel.abort(signal))
}

try {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      host: { type: 'string', default: 'pi' },
      lane: { type: 'string', default: 'fregat-lane' },
      'memory-max': { type: 'string', default: '3G' },
      'max-wall': { type: 'string', default: String(DEFAULT_LIMITS.maxWallSec) },
      'lock-dir': { type: 'string' },
      evidence: { type: 'string' },
      help: { type: 'boolean' },
    },
  })
  if (values.help) {
    console.log(USAGE)
    process.exit(0)
  }
  const [label, ...command] = positionals
  if (!label || command.length === 0) throw createScriptError(USAGE)
  await holdLaneLock(`run.ts ${label}`, values['lock-dir'])
  const root = resolveLane(values.host, values.lane)
  verifyLane(values.host, root)
  const name = laneRunName(label)
  const evidence = values.evidence ?? `/work/tmp/fregat-evidence/${name}-${values.host}`
  const outcome = await runOnLane(
    {
      ...DEFAULT_LIMITS,
      maxWallSec: Number(values['max-wall']),
      host: values.host,
      root,
      name,
      memoryMax: memoryMax(values['memory-max']),
      command: command.join(' '),
      evidence,
    },
    { transport: sshTransport(values.host), signal: cancel.signal },
  )
  if (outcome.totals) writeFileSync(1, `${JSON.stringify(outcome.totals)}\n`)
  console.error(
    `[pi-lane] ${label} on ${values.host} exited ${outcome.exitCode}; evidence ${outcome.totals ? evidence : 'missing'}`,
  )
  process.exit(outcome.exitCode)
} catch (error) {
  console.error(scriptFailureText(error))
  process.exit(2)
}
