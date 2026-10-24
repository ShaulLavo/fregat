import { readFile } from 'node:fs/promises'
import { SourceMap } from 'node:module'
import { resolve, sep } from 'node:path'
import { fail } from './errors.mjs'

export async function summarizeLayoutTrace(events, window, location = generatedLocation) {
  if (!Array.isArray(events)) fail('Missing trace events')
  if (
    !Number.isFinite(window.startMicros) ||
    !Number.isFinite(window.endMicros) ||
    !(window.endMicros > window.startMicros)
  )
    fail('Invalid layout measurement window')
  const callsites = new Map()
  let count = 0
  let durationMs = 0
  let unattributedCount = 0
  for (const event of events) {
    if (event.name !== 'Layout') continue
    if (event.ts < window.startMicros || event.ts >= window.endMicros) continue
    if (
      event.ph !== 'X' ||
      !Number.isFinite(event.ts) ||
      !Number.isFinite(event.dur) ||
      event.dur < 0
    )
      fail('Expected complete Chromium Layout events with finite durations')
    const frame = event.args?.beginData?.stackTrace?.[0]
    const callsite = frame ? await location(frame) : '(unattributed)'
    const previous = callsites.get(callsite) ?? { callsite, count: 0, durationMs: 0 }
    previous.count++
    previous.durationMs += event.dur / 1000
    callsites.set(callsite, previous)
    count++
    durationMs += event.dur / 1000
    if (!frame) unattributedCount++
  }
  return {
    count,
    durationMs,
    unattributedCount,
    callsites: [...callsites.values()].sort((left, right) => right.count - left.count),
  }
}

export function createTraceLocation(buildDirectory) {
  const maps = new Map()
  return async (frame) => {
    if (!frame.url?.startsWith('http://localhost:4173/assets/')) return generatedLocation(frame)
    const file = resolve(buildDirectory, `.${new URL(frame.url).pathname}.map`)
    if (!file.startsWith(resolve(buildDirectory) + sep)) fail('Trace source map escapes build')
    if (!maps.has(file)) maps.set(file, new SourceMap(JSON.parse(await readFile(file, 'utf8'))))
    // Timeline stacks use one-based positions; SourceMap and CPU profiles use zero-based ones.
    const original = maps.get(file).findEntry(frame.lineNumber - 1, frame.columnNumber - 1)
    if (!original.originalSource) return generatedLocation(frame)
    const source = original.originalSource.replace(/^.*\/(packages|examples)\//, '$1/')
    return `${frame.functionName || '(anonymous)'} ${source}:${original.originalLine + 1}:${original.originalColumn + 1}`
  }
}

function generatedLocation(frame) {
  return `${frame.functionName || '(anonymous)'} ${frame.url || '(no script)'}:${frame.lineNumber}:${frame.columnNumber}`
}
