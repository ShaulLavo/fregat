#!/usr/bin/env bun
// Runs one command on the Pi lane through mesh, in its own memory-capped slice, then copies its
// run directory here. Sync first. The command is joined and run by bash from the lane checkout,
// as ssh does; $LANE_RUN names its output directory there and $HEAVY_JOB_SLICE its slice.
import { parseArgs } from 'node:util'
import { createScriptError, scriptFailureText } from '../../structured-errors'
import { memoryMax } from './lane-root'
import { laneRunName, runOnLane } from './lane-job'
import { resolveLane, verifyLane } from './remote'

const USAGE =
  'bun scripts/heavy/pi/run.ts [--host pi] [--lane fregat-lane] [--memory-max 3G] [--evidence DIR] <label> -- <command…>'

try {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      host: { type: 'string', default: 'pi' },
      lane: { type: 'string', default: 'fregat-lane' },
      'memory-max': { type: 'string', default: '3G' },
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
  const root = resolveLane(values.host, values.lane)
  verifyLane(values.host, root)
  const name = laneRunName(label)
  const evidence = values.evidence ?? `/work/tmp/fregat-evidence/${name}-${values.host}`
  const { exitCode, totals } = await runOnLane({
    host: values.host,
    root,
    name,
    memoryMax: memoryMax(values['memory-max']),
    command: command.join(' '),
    evidence,
  })
  if (totals) console.log(JSON.stringify(totals))
  console.error(
    `[pi-lane] ${label} on ${values.host} exited ${exitCode}; evidence ${totals ? evidence : 'missing'}`,
  )
  process.exit(exitCode)
} catch (error) {
  console.error(scriptFailureText(error))
  process.exit(2)
}
