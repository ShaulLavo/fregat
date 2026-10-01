#!/usr/bin/env bun
import { existsSync } from 'node:fs'
import path from 'node:path'
import { parseArgs } from 'node:util'

import { legacyHold, readReadings, sliceMemory } from './admission'
import { live, type Entry } from './queue'

const MiB = 2 ** 20
const SLOT_FILES = ['slot1.lock', 'slot2.lock', 'slot3.lock'] as const

const { values } = parseArgs({
  options: {
    proc: { default: '/proc', type: 'string' },
    'state-dir': { default: '/work/tmp/wave-heavy', type: 'string' },
  },
})
const stateDir = values['state-dir']
const readings = readReadings(values.proc)
console.log(
  `machine: ${Math.round(readings.memAvailableBytes / MiB)} MiB available, memory pressure ${readings.memoryPressure}%, CPU load ${readings.cpuLoad.toFixed(2)} per core`,
)
const hold = SLOT_FILES.every((slot) => existsSync(path.join(stateDir, slot)))
  ? legacyHold(stateDir, SLOT_FILES)
  : null
console.log(`slot locks: ${hold ?? 'free for heavy jobs'}`)
printEntries('running', live(stateDir, 'jobs'))
printEntries('waiting', live(stateDir, 'queue'))

function printEntries(title: string, entries: readonly Entry[]) {
  console.log(`${title}: ${entries.length}`)
  for (const entry of entries) {
    const age = Math.round((Date.now() - Date.parse(entry.since)) / 1000)
    const estimate = Math.round(entry.estimateBytes / MiB)
    console.log(
      `  ${entry.label} (${entry.jobClass}, ${estimate} MiB) ${age}s pid=${entry.pid} cwd=${entry.cwd}${usage(entry)}`,
    )
  }
}

function usage(entry: Entry) {
  const bytes = sliceMemory(entry.id)
  return bytes === null ? '' : ` using ${Math.round(bytes / MiB)} MiB`
}
