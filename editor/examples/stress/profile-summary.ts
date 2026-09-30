import { readFile, readdir } from 'node:fs/promises'
import { SourceMap } from 'node:module'
import { basename, resolve } from 'node:path'
import { fail } from './errors.ts'

interface ProfileFrame {
  functionName: string
  url: string
  lineNumber: number
  columnNumber: number
}
interface CpuProfile {
  nodes: { id: number; callFrame: ProfileFrame; children?: number[] }[]
  samples: number[]
  timeDeltas: number[]
  startTime: number
  endTime: number
}

const directory = resolve(process.argv[2] ?? '/work/tmp/editor-long-line-profile')
const files = (await readdir(directory)).filter((file) => file.endsWith('.cpuprofile')).sort()
if (!files.length) fail('No CPU profiles found')
const sourceMaps = new Map<string, SourceMap>()
for (const file of files) {
  const profile = JSON.parse(await readFile(resolve(directory, file), 'utf8'))
  console.log(JSON.stringify({ file, ...(await summarize(profile)) }))
}

async function summarize(profile: CpuProfile) {
  const parents = new Map<number, number>()
  const locations = new Map<number, string>()
  for (const node of profile.nodes) {
    locations.set(node.id, await location(node.callFrame))
    for (const child of node.children ?? []) parents.set(child, node.id)
  }
  const self = new Map<string, number>()
  const inclusive = new Map<string, number>()
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

function addAncestors(
  totals: Map<string, number>,
  id: number | undefined,
  micros: number,
  parents: ReadonlyMap<number, number>,
  locations: ReadonlyMap<number, string>,
) {
  const seen = new Set()
  while (id !== undefined) {
    const key = locations.get(id)
    if (!key) fail('CPU ancestor refers to a missing node')
    if (!seen.has(key)) add(totals, key, micros)
    seen.add(key)
    id = parents.get(id)
  }
}

function add(totals: Map<string, number>, key: string, micros: number) {
  totals.set(key, (totals.get(key) ?? 0) + micros)
}

function ranked(totals: ReadonlyMap<string, number>, activeMicros: number) {
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

async function location(frame: ProfileFrame) {
  const name = frame.functionName || '(anonymous)'
  if (!frame.url.startsWith('http://localhost:4173/assets/')) return `${name} ${frame.url}`.trim()
  const asset = basename(new URL(frame.url).pathname)
  if (!sourceMaps.has(asset)) {
    const map = JSON.parse(
      await readFile(resolve(directory, 'build/assets', `${asset}.map`), 'utf8'),
    )
    sourceMaps.set(asset, new SourceMap(map))
  }
  const original = sourceMaps.get(asset)!.findEntry(frame.lineNumber, frame.columnNumber)
  if (!('originalSource' in original)) return `${name} ${asset}:${frame.lineNumber + 1}`
  const source = original.originalSource?.replace(/^.*\/(packages|examples)\//, '$1/') ?? asset
  return `${name} ${source}:${(original.originalLine ?? frame.lineNumber) + 1}`
}
