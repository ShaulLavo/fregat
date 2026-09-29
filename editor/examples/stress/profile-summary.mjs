import { readFile, readdir } from 'node:fs/promises'
import { SourceMap } from 'node:module'
import { basename, resolve } from 'node:path'
import { fail } from './errors.mjs'

const directory = resolve(process.argv[2] ?? '/work/tmp/editor-long-line-profile')
const files = (await readdir(directory)).filter((file) => file.endsWith('.cpuprofile')).sort()
if (!files.length) fail('No CPU profiles found')
const sourceMaps = new Map()
for (const file of files) {
  const profile = JSON.parse(await readFile(resolve(directory, file), 'utf8'))
  console.log(JSON.stringify({ file, ...(await summarize(profile)) }))
}

async function summarize(profile) {
  const parents = new Map()
  const locations = new Map()
  for (const node of profile.nodes) {
    locations.set(node.id, await location(node.callFrame))
    for (const child of node.children ?? []) parents.set(child, node.id)
  }
  const self = new Map()
  const inclusive = new Map()
  let sampledMicros = 0
  for (const [index, id] of (profile.samples ?? []).entries()) {
    const micros = profile.timeDeltas[index]
    if (!Number.isFinite(micros) || micros < 0) fail('Invalid CPU sampling interval')
    sampledMicros += micros
    const key = locations.get(id)
    if (!key) fail('CPU sample refers to a missing node')
    add(self, key, micros)
    if (key.startsWith('(idle)')) continue
    addAncestors(inclusive, id, micros, parents, locations)
  }
  if (!sampledMicros) fail('CPU profile contains no samples')
  const idleMicros = [...self]
    .filter(([key]) => key.startsWith('(idle)'))
    .reduce((sum, [, value]) => sum + value, 0)
  const activeMicros = sampledMicros - idleMicros
  return {
    durationMs: (profile.endTime - profile.startTime) / 1000,
    samples: profile.samples.length,
    sampledMs: sampledMicros / 1000,
    activeSampledMs: activeMicros / 1000,
    self: ranked(self, activeMicros),
    inclusive: ranked(inclusive, activeMicros),
  }
}

function addAncestors(totals, id, micros, parents, locations) {
  const seen = new Set()
  while (id !== undefined) {
    const key = locations.get(id)
    if (!seen.has(key)) add(totals, key, micros)
    seen.add(key)
    id = parents.get(id)
  }
}

function add(totals, key, micros) {
  totals.set(key, (totals.get(key) ?? 0) + micros)
}

function ranked(totals, activeMicros) {
  return [...totals]
    .filter(([key]) => !key.startsWith('(idle)'))
    .sort((a, b) => b[1] - a[1])
    .slice(0, 35)
    .map(([frame, micros]) => ({
      frame,
      sampledMs: micros / 1000,
      percentOfActive: (micros * 100) / activeMicros,
    }))
}

async function location(frame) {
  const name = frame.functionName || '(anonymous)'
  if (!frame.url.startsWith('http://localhost:4173/assets/')) return `${name} ${frame.url}`.trim()
  const asset = basename(new URL(frame.url).pathname)
  if (!sourceMaps.has(asset)) {
    const map = JSON.parse(
      await readFile(resolve(directory, 'build/assets', `${asset}.map`), 'utf8'),
    )
    sourceMaps.set(asset, new SourceMap(map))
  }
  const original = sourceMaps.get(asset).findEntry(frame.lineNumber, frame.columnNumber)
  const source = original.originalSource?.replace(/^.*\/(packages|examples)\//, '$1/') ?? asset
  return `${name} ${source}:${(original.originalLine ?? frame.lineNumber) + 1}`
}
