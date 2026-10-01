#!/usr/bin/env bun
import { existsSync } from 'node:fs'
import path from 'node:path'
import { parseArgs } from 'node:util'

import { readHomeSetting } from '../home-setting'
import { productionStateHome } from '../state-home'
import {
  drainRequest,
  legacyHold,
  legacyQuietHold,
  liveSlices,
  readReadings,
  sliceMemory,
} from './admission'
import { DEFAULT_STATE_DIR } from './lock'
import { live, type Entry } from './queue'

const MiB = 2 ** 20
const SLOT_FILES = ['slot1.lock', 'slot2.lock', 'slot3.lock'] as const

const { values } = parseArgs({
  options: {
    proc: { default: '/proc', type: 'string' },
    'settings-home': { default: productionStateHome, type: 'string' },
    'slice-root': { default: 'heavy', type: 'string' },
    'state-dir': { default: DEFAULT_STATE_DIR, type: 'string' },
  },
})
const stateDir = values['state-dir']
const root = values['slice-root']
const holdSeconds = readHomeSetting(values['settings-home'], 'developer.heavyJobQuietHoldSeconds')
const readings = readReadings(values.proc)
console.log(
  `machine: ${Math.round(readings.memAvailableBytes / MiB)} MiB available, memory pressure ${readings.memoryPressure}%, CPU load ${readings.cpuLoad.toFixed(2)} per core`,
)
console.log(`drain: ${drainRequest(stateDir, holdSeconds * 1000) ?? 'none requested'}`)
const slots = SLOT_FILES.every((slot) => existsSync(path.join(stateDir, slot)))
const running = live(stateDir, 'jobs')
console.log(`quiet hold: ${quietHold() ?? 'none'}`)
console.log(
  `slot locks: ${(slots ? legacyHold(stateDir, SLOT_FILES) : null) ?? 'free for heavy jobs'}`,
)
printEntries('running', running)
const orphans = liveSlices(root).filter((slice) => !running.some((job) => job.id === slice.id))
for (const orphan of orphans)
  console.log(`  ${orphan.slice} has no wrapper; the next admission stops it`)
printEntries('waiting', live(stateDir, 'queue'))

function printEntries(title: string, entries: readonly Entry[]) {
  console.log(`${title}: ${entries.length}`)
  for (const entry of entries) {
    const age = Math.round((Date.now() - Date.parse(entry.since)) / 1000)
    const estimate = Math.round(entry.estimateBytes / MiB)
    const used = sliceMemory(root, `${root}-${entry.id}.slice`)
    const usage = used === null ? '' : ` using ${Math.round(used / MiB)} MiB`
    console.log(
      `  ${entry.label} (${entry.jobClass}, ${estimate} MiB) ${age}s pid=${entry.pid} cwd=${entry.cwd}${usage}`,
    )
  }
}

// A `--quiet` job is bounded by the hold; another tool holding all three slot locks is not.
function quietHold() {
  const job = running.find((entry) => entry.quiet)
  if (job) {
    const age = Math.round((Date.now() - Date.parse(job.since)) / 1000)
    return `'${job.label}' (pid ${job.pid}) for ${age}s of ${holdSeconds}s`
  }
  const legacy = slots ? legacyQuietHold(stateDir, SLOT_FILES) : null
  if (!legacy) return null
  return `another tool (pid ${legacy.pids.join(', ')}) holds all three slot locks, unbounded, for ${legacy.ageSeconds}s`
}
