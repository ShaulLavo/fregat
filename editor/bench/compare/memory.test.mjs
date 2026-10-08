import { test } from 'node:test'
import assert from 'node:assert/strict'
import { monitorProcessMemory, summarizeMemorySamples, processMemoryBytes } from './memory.mjs'

test('peak RSS sums simultaneous samples and preserves unavailable observations', () => {
  const samples = [
    { atMs: 0, rssBytes: [100, 10] },
    { atMs: 100, rssBytes: [10, 100] },
    { atMs: 300, rssBytes: [null, 1000] },
  ]
  const result = summarizeMemorySamples(samples)
  assert.equal(result.sampledSimultaneousPeakRssBytes, 110)
  assert.equal(result.completeSamples, 2)
  assert.equal(result.largestSamplingGapMs, 200)
  assert.deepEqual(result.raw, samples)
  assert.equal(summarizeMemorySamples([samples[2]]).sampledSimultaneousPeakRssBytes, null)
})

test('an unavailable process list reports unavailable RSS', async () => {
  const stop = monitorProcessMemory([])
  const result = await stop()
  assert.equal(result.completeSamples, 0)
  assert.equal(result.sampledSimultaneousPeakRssBytes, null)
})

test('memory monitoring stops and records the observed processes', async () => {
  const stop = monitorProcessMemory([1, 2], async (id) => id * 100)
  const result = await stop()
  assert.deepEqual(result.processIds, [1, 2])
  assert.equal(result.samples, 1)
  assert.equal(result.sampledSimultaneousPeakRssBytes, 300)
})

test('Linux process memory accepts tab-separated fields and preserves unknown values', () => {
  const status = 'Name:\tchrome\nVmRSS:\t  12345 kB\nVmHWM:\t67890 kB\n'
  assert.equal(processMemoryBytes(status, 'VmRSS'), 12345 * 1024)
  assert.equal(processMemoryBytes(status, 'VmHWM'), 67890 * 1024)
  assert.equal(processMemoryBytes('VmRSS: 10 kB', 'VmRSS'), 10 * 1024)
  assert.equal(processMemoryBytes('', 'VmRSS'), null)
  assert.equal(processMemoryBytes('VmHWM:	unavailable', 'VmHWM'), null)
})
