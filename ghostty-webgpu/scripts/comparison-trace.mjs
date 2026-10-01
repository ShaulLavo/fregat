import assert from 'node:assert/strict'
import { gzipSync } from 'node:zlib'
import { mkdir, readdir, unlink, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { cpuSample } from './comparison-guards.mjs'

export function assertDisplay(periods) {
  assert(
    periods.length === 20 && periods.every((period) => period > 0 && period < 1000),
    'Mac display unavailable',
  )
  const sorted = periods.toSorted((a, b) => a - b)
  assert(sorted[10] >= 15 && sorted[10] <= 18.5, 'Mac display unavailable')
  return sorted[10]
}

export async function prepareTraceOutput(output) {
  await mkdir(dirname(output), { recursive: true })
  // A fresh directory lets failed qualification discard the entire owned window.
  await mkdir(output)
}

export async function discardTraceWindow(output) {
  for (const name of await readdir(output)) await unlink(join(output, name))
}

export function summarizeRecords(records) {
  const milliseconds = {}
  const byTerminal = {}
  for (const span of records.spans)
    milliseconds[span.category] = (milliseconds[span.category] ?? 0) + span.self
  for (const counter of records.counters) {
    const counts = (byTerminal[counter.terminal] ??= {})
    counts[counter.operation] = (counts[counter.operation] ?? 0) + counter.value
  }
  const total = Object.values(milliseconds).reduce((a, b) => a + b, 0)
  const shares = Object.fromEntries(
    Object.entries(milliseconds).map(([name, time]) => [name, (time / total) * 100]),
  )
  const frames = records.spans
    .filter((span) => span.operation === 'drawFrame' || span.operation === 'renderRows')
    .map((span) => {
      const counts = {}
      for (const counter of records.counters) {
        if (
          counter.terminal !== span.terminal ||
          counter.time < span.start ||
          counter.time > span.end
        )
          continue
        counts[counter.operation] = (counts[counter.operation] ?? 0) + counter.value
      }
      return { terminal: span.terminal, start: span.start, end: span.end, counts }
    })
  const ownership = {}
  for (const name of ['scheduler', 'device', 'queue', 'pipelines', 'context', 'programs']) {
    const identities = (records.ownership ?? []).flatMap((owner) => owner[name] ?? [])
    if (identities.length) ownership[name] = new Set(identities).size
  }
  return { milliseconds, instrumentedMilliseconds: total, shares, byTerminal, frames, ownership }
}

async function collectTrace(browserSession, completed) {
  const { stream } = await completed
  const chunks = []
  try {
    for (;;) {
      const part = await browserSession.send('IO.read', { handle: stream })
      chunks.push(Buffer.from(part.data, part.base64Encoded ? 'base64' : 'utf8'))
      if (part.eof) break
    }
  } finally {
    await browserSession.send('IO.close', { handle: stream })
  }
  return Buffer.concat(chunks)
}

export async function tracePhase({ page, browserSession, output, label, operation, traced }) {
  if (traced)
    await browserSession.send('Tracing.start', {
      categories:
        'toplevel,devtools.timeline,blink.user_timing,v8,cc,viz,gpu,disabled-by-default-devtools.timeline,disabled-by-default-v8.cpu_profiler',
      transferMode: 'ReturnAsStream',
    })
  const completed = traced
    ? new Promise((resolve) => browserSession.once('Tracing.tracingComplete', resolve))
    : undefined
  let result
  let trace
  let recording = false
  try {
    const before = (await browserSession.send('SystemInfo.getProcessInfo')).processInfo
    if (traced) {
      await page.evaluate(() => window.__compare.traceBegin())
      recording = true
    }
    const started = performance.now()
    let sample
    let failure
    try {
      sample = await operation()
    } catch (error) {
      sample = error.partialLatency
      failure = String(error.stack ?? error)
    }
    const milliseconds = performance.now() - started
    const after = (await browserSession.send('SystemInfo.getProcessInfo')).processInfo
    const records = traced ? await page.evaluate(() => window.__compare.traceEnd()) : undefined
    recording = false
    result = {
      label,
      traced,
      milliseconds,
      cpu: cpuSample(before, after, milliseconds),
      sample,
      error: failure,
    }
    if (records) {
      result.records = records
      result.summary = summarizeRecords(records)
    }
  } finally {
    if (recording) await page.evaluate(() => window.__compare.traceEnd()).catch(() => {})
    if (traced) {
      await browserSession.send('Tracing.end')
      trace = await collectTrace(browserSession, completed)
    }
  }
  if (!traced) return result
  result.trace = `${label}.trace.json.gz`
  result.traceBytes = trace.length
  await writeFile(join(output, result.trace), gzipSync(trace))
  return result
}
