import { readFile } from 'node:fs/promises'

export function processMemoryBytes(status, field) {
  const match = status.match(new RegExp(`^${field}:\\s+([0-9]+) kB`, 'm'))
  return match ? Number(match[1]) * 1024 : null
}

async function readProcessRss(id) {
  const status = await readFile(`/proc/${id}/status`, 'utf8').catch(() => '')
  return processMemoryBytes(status, 'VmRSS')
}

export function summarizeMemorySamples(samples) {
  const valid = samples.filter(
    (sample) => sample.rssBytes.length > 0 && sample.rssBytes.every(Number.isFinite),
  )
  return {
    samples: samples.length,
    completeSamples: valid.length,
    sampledSimultaneousPeakRssBytes: valid.length
      ? Math.max(...valid.map((sample) => sample.rssBytes.reduce((sum, bytes) => sum + bytes, 0)))
      : null,
    largestSamplingGapMs:
      samples.length > 1
        ? Math.max(...samples.slice(1).map((sample, index) => sample.atMs - samples[index].atMs))
        : null,
    raw: samples,
  }
}

export function monitorProcessMemory(ids, read = readProcessRss) {
  const samples = []
  const started = performance.now()
  let stopped = false
  const task = (async () => {
    while (!stopped) {
      samples.push({
        atMs: performance.now() - started,
        rssBytes: await Promise.all(ids.map(read)),
      })
      if (!stopped) await new Promise((resolve) => setTimeout(resolve, 100))
    }
  })()
  return async () => {
    stopped = true
    await task
    return { processIds: ids, ...summarizeMemorySamples(samples) }
  }
}
