import assert from 'node:assert/strict'
import { performance } from 'node:perf_hooks'

function copy(text, apply) {
  const batches = []
  for (let at = 0; at < text.length; at += 8192) {
    const units = new Uint16Array(Math.min(8192, text.length - at))
    for (let index = 0; index < units.length; index++) units[index] = text.charCodeAt(at + index)
    batches.push(
      apply ? Reflect.apply(String.fromCharCode, null, units) : String.fromCharCode(...units),
    )
  }
  return batches.join('')
}

function sample(text, apply, iterations) {
  const started = performance.now()
  for (let index = 0; index < iterations; index++) assert.equal(copy(text, apply), text)
  return (performance.now() - started) / iterations
}

function measure(size) {
  const text = 'x\ud800y\udfff'.repeat(size / 4)
  const iterations = Math.max(16, Math.floor(4194304 / size))
  sample(text, false, 10)
  sample(text, true, 10)
  const samples = { spread: [], apply: [] }
  for (let run = 0; run < 7; run++) {
    for (const apply of run % 2 ? [true, false] : [false, true]) {
      samples[apply ? 'apply' : 'spread'].push(sample(text, apply, iterations))
    }
  }
  return {
    size,
    iterations,
    samples,
    medianMs: Object.fromEntries(
      Object.entries(samples).map(([kind, times]) => [kind, times.toSorted((a, b) => a - b)[3]]),
    ),
  }
}

console.log(
  JSON.stringify(
    { runtime: process.version, results: [64, 1024, 16384, 1048576].map(measure) },
    null,
    2,
  ),
)
