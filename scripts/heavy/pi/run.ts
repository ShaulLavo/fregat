#!/usr/bin/env bun
// Runs one command on the Pi lane through mesh, in its own memory-capped slice, then copies its
// run directory here. Sync first. The command is joined and run by bash from the lane checkout,
// as ssh does; $LANE_RUN names its output directory there and $HEAVY_JOB_SLICE its slice.
import { randomBytes } from 'node:crypto'
import { parseArgs } from 'node:util'
import { createScriptError, scriptFailureText } from '../../structured-errors'
import { collectEvidence, laneExitCode } from './evidence'
import { laneJobCommand, laneRunDirectory } from './lane-command'
import { memoryMax } from './lane-root'
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
  const [rawLabel, ...command] = positionals
  if (!rawLabel || command.length === 0) throw createScriptError(USAGE)
  const label = rawLabel.toLowerCase().replaceAll(/[^a-z0-9-]/g, '-')
  const root = resolveLane(values.host, values.lane)
  verifyLane(values.host, root)
  const stamp = new Date().toISOString().replaceAll(/[-:]/g, '').slice(0, 15).toLowerCase()
  // Two launches of one label in the same second must not share a directory or a slice.
  const name = `${stamp}-${label}-${randomBytes(3).toString('hex')}`
  const job = { root, name, memoryMax: memoryMax(values['memory-max']), command: command.join(' ') }
  const evidence = values.evidence ?? `/work/tmp/fregat-evidence/${name}-${values.host}`

  const mesh = Bun.spawnSync(['mesh', values.host, '--', 'bash', '-lc', laneJobCommand(job)], {
    stdin: 'ignore',
    stdout: 'inherit',
    stderr: 'inherit',
  })
  let arrived = true
  try {
    collectEvidence(`${values.host}:${laneRunDirectory(job)}`, evidence)
    console.log(await Bun.file(`${evidence}/lane.json`).text())
  } catch (error) {
    arrived = false
    console.error(scriptFailureText(error))
  }
  const exit = laneExitCode(mesh.exitCode, arrived)
  console.error(
    `[pi-lane] ${label} on ${values.host} exited ${mesh.exitCode}; evidence ${arrived ? evidence : 'missing'}`,
  )
  process.exit(exit)
} catch (error) {
  console.error(scriptFailureText(error))
  process.exit(2)
}
