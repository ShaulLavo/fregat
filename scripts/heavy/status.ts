#!/usr/bin/env bun
import { existsSync } from 'node:fs'
import path from 'node:path'
import { parseArgs } from 'node:util'

import { drainRequest, legacyHold, liveSlices, readReadings, sliceMemory } from './admission'
import { DEFAULT_STATE_DIR, sliceRootFor } from './lock'
import { live, type Entry } from './queue'

const MiB = 2 ** 20
const SLOT_FILES = ['slot1.lock', 'slot2.lock', 'slot3.lock'] as const

const { values } = parseArgs({
  options: {
    proc: { default: '/proc', type: 'string' },
    'slice-root': { type: 'string' },
    'state-dir': { default: DEFAULT_STATE_DIR, type: 'string' },
  },
})
const stateDir = values['state-dir']
const root = values['slice-root'] ?? sliceRootFor(stateDir)
const readings = readReadings(values.proc)
console.log(
  `machine: ${Math.round(readings.memAvailableBytes / MiB)} MiB available, memory pressure ${readings.memoryPressure}%, CPU load ${readings.cpuLoad.toFixed(2)} per core`,
)
console.log(`drain: ${drainRequest(stateDir) ?? 'none requested'}`)
const hold = SLOT_FILES.every((slot) => existsSync(path.join(stateDir, slot)))
  ? legacyHold(stateDir, SLOT_FILES)
  : null
console.log(`slot locks: ${hold ?? 'free for heavy jobs'}`)
const running = live(stateDir, 'jobs')
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
