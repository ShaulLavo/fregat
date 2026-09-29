import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { createServer } from 'node:http'
import { chromium } from '@playwright/test'
import { build } from 'vite'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { createWriteStream } from 'node:fs'
import { finished } from 'node:stream/promises'

const { values } = parseArgs({
  options: {
    workloads: { type: 'string', default: 'aligned,survivors,mixed,paragraph,original,paste-tail' },
    cycles: { type: 'string', default: '500,1000' },
    repetitions: { type: 'string', default: '3' },
    'typing-samples': { type: 'string', default: '0' },
    'observe-only': { type: 'boolean', default: false },
    'heap-snapshot': { type: 'string' },
    'heap-snapshot-baseline': { type: 'string' },
    'heap-snapshot-before': { type: 'string' },
  },
})
const workloads = values.workloads.split(',')
const cyclesList = values.cycles.split(',').map(Number)
const repetitions = Number(values.repetitions)
const typingSamples = Number(values['typing-samples'])
assert.ok(
  workloads.every((kind) =>
    ['aligned', 'survivors', 'mixed', 'paragraph', 'original', 'paste-tail'].includes(kind),
  ),
)
assert.ok(cyclesList.every((count) => Number.isSafeInteger(count) && count >= 200))
assert.ok(Number.isSafeInteger(repetitions) && repetitions > 0)
assert.ok(Number.isSafeInteger(typingSamples) && typingSamples >= 0 && typingSamples <= 32)

const bundle = await build({
  root: fileURLToPath(new URL('.', import.meta.url)),
  configFile: false,
  logLevel: 'silent',
  build: {
    write: false,
    lib: {
      entry: fileURLToPath(new URL('./reclamation-live-entry.js', import.meta.url)),
      formats: ['es'],
      fileName: () => 'app.js',
    },
  },
})
const output = (Array.isArray(bundle) ? bundle : [bundle]).flatMap((result) => result.output)
const files = new Map(
  output.map((file) => [file.fileName, file.type === 'asset' ? file.source : file.code]),
)
const hash = createHash('sha256')
for (const [name, contents] of [...files].sort(([a], [b]) => a.localeCompare(b))) {
  hash.update(name).update(contents)
}
const bundleHash = hash.digest('hex')
const css = [...files.keys()].find((name) => name.endsWith('.css'))
const server = createServer((request, response) => {
  const name = new URL(request.url, 'http://localhost').pathname.slice(1)
  if (!name) {
    response.setHeader('content-type', 'text/html')
    response.end(
      `<!doctype html><link rel="stylesheet" href="/${css}"><script type="module" src="/app.js"></script>`,
    )
    return
  }
  response.setHeader('content-type', name.endsWith('.css') ? 'text/css' : 'text/javascript')
  response.end(files.get(name) ?? '')
})
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const browser = await chromium.launch({ headless: true })

async function heap(cdp) {
  await cdp.send('HeapProfiler.collectGarbage')
  return (await cdp.send('Runtime.getHeapUsage')).usedSize
}

async function saveHeapSnapshot(cdp, path) {
  const output = createWriteStream(path)
  const write = ({ chunk }) => output.write(chunk)
  cdp.on('HeapProfiler.addHeapSnapshotChunk', write)
  try {
    await cdp.send('HeapProfiler.takeHeapSnapshot')
  } finally {
    cdp.off('HeapProfiler.addHeapSnapshotChunk', write)
    output.end()
    await finished(output)
  }
}

async function stringHeap(cdp) {
  const chunks = []
  const collect = ({ chunk }) => chunks.push(chunk)
  cdp.on('HeapProfiler.addHeapSnapshotChunk', collect)
  try {
    await cdp.send('HeapProfiler.takeHeapSnapshot')
  } finally {
    cdp.off('HeapProfiler.addHeapSnapshotChunk', collect)
  }
  const { snapshot, nodes } = JSON.parse(chunks.join(''))
  const { node_fields: fields, node_types: types } = snapshot.meta
  const kind = fields.indexOf('type')
  const size = fields.indexOf('self_size')
  const categories = { string: 0, 'concatenated string': 0, 'sliced string': 0 }
  for (let at = 0; at < nodes.length; at += fields.length) {
    const name = types[kind][nodes[at + kind]]
    if (Object.hasOwn(categories, name)) categories[name] += nodes[at + size]
  }
  return { categories, bytes: Object.values(categories).reduce((sum, bytes) => sum + bytes, 0) }
}

async function nextPaint(page) {
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  )
}

async function taskBoundary(page) {
  await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 0)))
}

async function calibratedHeap(page, cdp) {
  const completed = await page.evaluate(() => window.reclamationLive.suspendMaintenance())
  const immediate = await heap(cdp)
  const immediateRegistry = await page.evaluate(() => window.reclamationLive.heapCalibration())
  await taskBoundary(page)
  const first = await heap(cdp)
  const firstRegistry = await page.evaluate(() => window.reclamationLive.heapCalibration(true))
  await taskBoundary(page)
  const second = await heap(cdp)
  const secondRegistry = await page.evaluate(() => window.reclamationLive.heapCalibration(true))
  for (const registry of [immediateRegistry, firstRegistry, secondRegistry]) {
    assert.equal(registry.maintenanceCompleted, completed, 'maintenance ran during heap capture')
  }
  assert.equal(
    firstRegistry.sentinelAlive,
    false,
    'first task and GC must collect the weak sentinel',
  )
  assert.equal(
    secondRegistry.sentinelAlive,
    false,
    'second task and GC must keep the sentinel absent',
  )
  return {
    immediateAbsolute: immediate,
    strings: await stringHeap(cdp),
    firstTaskGcAbsolute: first,
    secondTaskGcAbsolute: second,
    stabilityDeltaBytes: second - first,
    immediateRegistry,
    firstRegistry,
    secondRegistry,
  }
}

async function maintain(page, cdp, completed) {
  await page.evaluate(() => window.reclamationLive.resumeMaintenance())
  let peak = 0
  let samples = 0
  const started = Date.now()
  while (Date.now() - started < 30000) {
    const memory = await cdp.send('Runtime.getHeapUsage')
    peak = Math.max(peak, memory.usedSize)
    samples++
    const count = await page.evaluate(
      () => window.reclamationLive.buffer.getStorageMaintenanceStats().completed,
    )
    if (count > completed) return { sampledPeakHeap: peak, heapSamples: samples }
    await page.waitForTimeout(10)
  }
  assert.fail('automatic maintenance did not finish within 30 seconds')
}

function latencySummary(samples) {
  const sorted = samples.toSorted((a, b) => a - b)
  return {
    count: sorted.length,
    p50Ms: sorted[Math.floor(sorted.length * 0.5)] ?? null,
    p95Ms: sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))] ?? null,
  }
}

async function inputProbe(page) {
  if (typingSamples === 0) return null
  await page.evaluate(() => window.reclamationLive.beginInputProbe())
  for (let index = 0; index < typingSamples; index++) await page.keyboard.type('t', { delay: 20 })
  await nextPaint(page)
  const samples = await page.evaluate(() => window.reclamationLive.endInputProbe())
  assert.equal(samples.length, typingSamples, 'every trusted keystroke must reach the frame probe')
  return latencySummary(samples)
}

function assertState(maintained, expected) {
  assert.equal(maintained.revision, expected.revision)
  assert.equal(maintained.dirty, expected.dirty)
  assert.equal(maintained.text, expected.text)
  assert.equal(maintained.snapshotIdentity, true)
  assert.equal(maintained.wrapperIdentity, true)
  assert.deepEqual(maintained.texts, [expected.text, expected.text])
}

async function verifyHistory(page, minimum) {
  const history = await page.evaluate(() => window.reclamationLive.undoRedo())
  assert.equal(history.valid, true)
  assert.ok(history.count >= minimum)
  return history
}

async function verifyInputAndDisposal(page, text) {
  await page.evaluate(() => window.reclamationLive.prepareInput())
  await page.keyboard.type('typed ')
  await page.waitForFunction(
    (expected) =>
      window.reclamationLive.editors.every(
        (editor) => editor.materializeFullText() === `typed ${expected}`,
      ),
    text,
  )
  await page.locator('#editor-1').getByText('typed prefix', { exact: false }).first().waitFor()
  const completed = await page.evaluate(() => {
    const { buffer, editors } = window.reclamationLive
    editors[0].openDocument({ documentId: 'replacement.txt', text: 'replacement' })
    editors[1].dispose()
    return buffer.getStorageMaintenanceStats().completed
  })
  await page.waitForTimeout(500)
  assert.equal(
    await page.evaluate(() => window.reclamationLive.buffer.getStorageMaintenanceStats().completed),
    completed,
  )
  await page.evaluate(() => window.reclamationLive.dispose())
}

async function churnSample(page, cdp, workload, cycles) {
  const heapBaselineCalibration = await calibratedHeap(page, cdp)
  const baseline = heapBaselineCalibration.secondTaskGcAbsolute
  if (values['heap-snapshot-baseline'])
    await saveHeapSnapshot(cdp, values['heap-snapshot-baseline'])
  const churn = await page.evaluate(
    ([kind, count]) => window.reclamationLive.churn(count, kind),
    [workload, cycles],
  )
  const inputBefore = await inputProbe(page)
  const captured = await page.evaluate(() => window.reclamationLive.capture())
  const heapCalibration = await calibratedHeap(page, cdp)
  assert.equal(heapCalibration.secondRegistry.sentinelCreated, true)
  const before = heapCalibration.secondTaskGcAbsolute
  if (values['heap-snapshot-before']) await saveHeapSnapshot(cdp, values['heap-snapshot-before'])
  assert.equal(
    await page.evaluate(() => window.reclamationLive.buffer.getStorageMaintenanceStats().completed),
    0,
    'pre-maintenance heap measurement missed its window',
  )
  const peaks = await maintain(page, cdp, 0)
  await nextPaint(page)
  const heapAfterCalibration = await calibratedHeap(page, cdp)
  const after = heapAfterCalibration.secondTaskGcAbsolute
  if (values['heap-snapshot']) await saveHeapSnapshot(cdp, values['heap-snapshot'])
  const maintained = await page.evaluate(() => window.reclamationLive.maintained())
  assertState(maintained, captured)
  if (!values['observe-only']) {
    assert.ok(maintained.stats.codeUnits > 0)
    assert.ok(maintained.retainedCodeUnits < captured.retainedCodeUnits)
  }
  const inputAfter = await inputProbe(page)
  const history = await verifyHistory(page, 100)
  await verifyInputAndDisposal(page, churn.text)
  return {
    workload,
    cycles,
    churnMs: churn.churnMs,
    registryEntriesAtChurnEnd: churn.registryEntriesAtChurnEnd,
    deletedUnits: churn.deletedUnits,
    retainedCodeUnitsBefore: captured.retainedCodeUnits,
    retainedCodeUnitsAfter: maintained.retainedCodeUnits,
    revision: captured.revision,
    dirty: captured.dirty,
    liveUnits: churn.text.length,
    heapBefore: before - baseline,
    heapAfter: after - baseline,
    heapBeforeAbsolute: before,
    heapBeforeImmediateAbsolute: heapCalibration.immediateAbsolute,
    heapCalibration,
    heapBaselineCalibration,
    heapAfterCalibration,
    heapAfterAbsolute: after,
    ...peaks,
    stats: maintained.stats,
    snapshotIdentity: true,
    wrapperIdentity: true,
    history,
    inputBefore,
    inputAfter,
  }
}

async function originalSample(page, cdp) {
  await nextPaint(page)
  const heapBaselineCalibration = await calibratedHeap(page, cdp)
  const baseline = heapBaselineCalibration.secondTaskGcAbsolute
  const deleted = await page.evaluate(() => window.reclamationLive.deleteOriginal())
  const captured = await page.evaluate(() => window.reclamationLive.capture())
  const heapCalibration = await calibratedHeap(page, cdp)
  const before = heapCalibration.secondTaskGcAbsolute
  const firstPeak = await maintain(page, cdp, 0)
  const protectedState = await page.evaluate(() => window.reclamationLive.maintained())
  assertState(protectedState, captured)
  assert.equal(
    protectedState.stats.codeUnits,
    0,
    'clean baseline and history must protect original text',
  )
  const pinsBefore = await page.evaluate(() => window.reclamationLive.inspectPins())
  assert.equal(pinsBefore.oldSuffix, 'suffix')
  assert.equal(pinsBefore.originalUnits, deleted.originalUnits)
  assert.equal(await page.evaluate(() => window.reclamationLive.buffer.canUndo()), true)
  const history = { protected: true, undoRedoChecked: false }
  const released = await page.evaluate(() => window.reclamationLive.releaseSessionOwners())
  const secondPeak = await maintain(page, cdp, protectedState.stats.completed)
  const maintained = await page.evaluate(() => window.reclamationLive.maintained())
  assertState(maintained, released)
  assert.deepEqual(await page.evaluate(() => window.reclamationLive.inspectPins()), pinsBefore)
  const heapPinnedCalibration = await calibratedHeap(page, cdp)
  const heapWhilePinned = heapPinnedCalibration.secondTaskGcAbsolute
  await page.evaluate(() => window.reclamationLive.releaseSnapshot())
  await nextPaint(page)
  const heapMeasurementCalibration = await calibratedHeap(page, cdp)
  const heapWithMeasurement = heapMeasurementCalibration.secondTaskGcAbsolute
  assert.equal(
    await page.evaluate(() => window.reclamationLive.releaseMeasurements()),
    pinsBefore.measuredColumn,
  )
  const heapAfterCalibration = await calibratedHeap(page, cdp)
  const after = heapAfterCalibration.secondTaskGcAbsolute
  if (values['heap-snapshot']) await saveHeapSnapshot(cdp, values['heap-snapshot'])
  if (!values['observe-only']) {
    assert.ok(maintained.stats.codeUnits > 0, 'original-only deletion must reclaim storage')
    assert.ok(
      heapPinnedCalibration.strings.bytes - heapAfterCalibration.strings.bytes >
        deleted.originalUnits * 0.1,
      'original: dropping external owners must release string storage exceeding 10% of source units',
    )
    assert.ok(
      heapPinnedCalibration.strings.bytes - heapMeasurementCalibration.strings.bytes >
        deleted.originalUnits * 0.1,
      'a retained short measurement must not pin the entire original string',
    )
  }
  await verifyInputAndDisposal(page, released.text)
  return {
    workload: 'original',
    cycles: 1,
    originalUnits: deleted.originalUnits,
    deletedUnits: deleted.deletedUnits,
    retainedCodeUnitsBefore: captured.retainedCodeUnits,
    retainedCodeUnitsAfter: maintained.retainedCodeUnits,
    liveUnits: released.text.length,
    revision: released.revision,
    dirty: released.dirty,
    heapBefore: before - baseline,
    heapAfter: after - baseline,
    heapBeforeAbsolute: before,
    heapAfterAbsolute: after,
    heapCalibration,
    heapBaselineCalibration,
    heapAfterCalibration,
    heapPinnedCalibration,
    heapMeasurementCalibration,
    heapWhilePinned,
    heapWithMeasurement,
    sampledPeakHeap: Math.max(firstPeak.sampledPeakHeap, secondPeak.sampledPeakHeap),
    heapSamples: firstPeak.heapSamples + secondPeak.heapSamples,
    stats: maintained.stats,
    snapshotIdentity: true,
    wrapperIdentity: true,
    oldReadersValid: true,
    history,
  }
}

async function pasteTailSample(page, cdp) {
  const heapBaselineCalibration = await calibratedHeap(page, cdp)
  const baseline = heapBaselineCalibration.secondTaskGcAbsolute
  const pasted = await page.evaluate(() => window.reclamationLive.pasteTail())
  assert.equal(pasted.syncReset, 'rotated')
  const captured = await page.evaluate(() => window.reclamationLive.capture())
  const heapCalibration = await calibratedHeap(page, cdp)
  const before = heapCalibration.secondTaskGcAbsolute
  const peaks = await maintain(page, cdp, 0)
  const maintained = await page.evaluate(() => window.reclamationLive.maintained())
  assertState(maintained, captured)
  const pins = await page.evaluate(() => window.reclamationLive.inspectPins())
  assert.equal(pins.originalUnits, pasted.pastedUnits + 13)
  assert.equal(pins.oldSuffix, 'suffix')
  const heapPinnedCalibration = await calibratedHeap(page, cdp)
  const heapWhilePinned = heapPinnedCalibration.secondTaskGcAbsolute
  await page.evaluate(() => window.reclamationLive.releaseSnapshot())
  await nextPaint(page)
  const heapMeasurementCalibration = await calibratedHeap(page, cdp)
  const heapWithMeasurement = heapMeasurementCalibration.secondTaskGcAbsolute
  assert.equal(
    await page.evaluate(() => window.reclamationLive.releaseMeasurements()),
    pins.measuredColumn,
  )
  const heapAfterCalibration = await calibratedHeap(page, cdp)
  const after = heapAfterCalibration.secondTaskGcAbsolute
  if (!values['observe-only']) {
    assert.ok(maintained.stats.codeUnits > 0)
    assert.ok(
      heapPinnedCalibration.strings.bytes - heapMeasurementCalibration.strings.bytes >
        pasted.pastedUnits * 0.1,
      'surviving paste tail must not pin the original multi-megabyte input',
    )
    assert.ok(
      heapAfterCalibration.strings.bytes - heapBaselineCalibration.strings.bytes <
        pasted.pastedUnits * 0.25,
      'a 64-unit surviving paste tail must retain less than one quarter of the 4 MiB input',
    )
  }
  await verifyInputAndDisposal(page, pasted.text)
  return {
    workload: 'paste-tail',
    cycles: 1,
    pastedUnits: pasted.pastedUnits,
    deletedUnits: pasted.deletedUnits,
    retainedCodeUnitsBefore: captured.retainedCodeUnits,
    retainedCodeUnitsAfter: maintained.retainedCodeUnits,
    liveUnits: pasted.text.length,
    revision: captured.revision,
    dirty: captured.dirty,
    heapBefore: before - baseline,
    heapAfter: after - baseline,
    heapBeforeAbsolute: before,
    heapAfterAbsolute: after,
    heapWhilePinned,
    heapWithMeasurement,
    heapCalibration,
    heapBaselineCalibration,
    heapAfterCalibration,
    heapPinnedCalibration,
    heapMeasurementCalibration,
    ...peaks,
    stats: maintained.stats,
    snapshotIdentity: true,
    wrapperIdentity: true,
    oldReadersValid: true,
    syncPayloadReleased: true,
  }
}

async function runWorkload(page, cdp, workload, cycles) {
  if (workload === 'original') return originalSample(page, cdp)
  if (workload === 'paste-tail') return pasteTailSample(page, cdp)
  return churnSample(page, cdp, workload, cycles)
}

async function sample(workload, cycles) {
  const context = await browser.newContext()
  try {
    const page = await context.newPage()
    const errors = []
    page.on('pageerror', (error) => errors.push(error.message))
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text())
    })
    await page.goto(`http://127.0.0.1:${server.address().port}/?workload=${workload}`)
    await page.waitForFunction(() => Boolean(window.reclamationLive))
    const cdp = await context.newCDPSession(page)
    const result = await runWorkload(page, cdp, workload, cycles)
    assert.deepEqual(errors, [])
    return {
      ...result,
      peerTextsMatch: true,
      trustedTyping: true,
      replacementAndDisposal: true,
      consoleErrors: errors,
    }
  } finally {
    await context.close()
  }
}

function cases() {
  return workloads.flatMap((workload) => {
    const counts = ['original', 'paste-tail'].includes(workload) ? [1] : cyclesList
    return counts.flatMap((cycles) =>
      Array.from({ length: repetitions }, (_, repetition) => ({ workload, cycles, repetition })),
    )
  })
}

function heapSummary(samples, strings = false) {
  const groups = Map.groupBy(
    samples.filter((sample) => sample.workload !== 'original'),
    (sample) => `${sample.workload}/${sample.cycles}`,
  )
  return Array.from(groups, ([workload, group]) => {
    const reductions = group
      .map((sample) => {
        if (!strings) return 1 - sample.heapAfter / sample.heapBefore
        const baseline = sample.heapBaselineCalibration.strings.bytes
        const before = sample.heapCalibration.strings.bytes - baseline
        const after = sample.heapAfterCalibration.strings.bytes - baseline
        assert.ok(before > 0, 'string growth must exceed the baseline')
        return 1 - after / before
      })
      .toSorted((a, b) => a - b)
    return {
      workload,
      samples: group.length,
      medianReduction:
        (reductions[Math.floor((reductions.length - 1) / 2)] +
          reductions[Math.floor(reductions.length / 2)]) /
        2,
    }
  })
}

function verifyHeapSummary(samples) {
  if (values['observe-only']) return
  for (const sample of samples)
    assert.ok(
      sample.retainedCodeUnitsAfter < sample.retainedCodeUnitsBefore,
      `${sample.workload}: retained code units must decrease`,
    )
  for (const group of heapSummary(samples, true)) {
    assert.ok(
      group.medianReduction > 0.1,
      `${group.workload}: median string heap reduction must exceed 10%, got ${100 * group.medianReduction}%`,
    )
  }
}

function report(samples, failure = null) {
  console.log(
    JSON.stringify(
      {
        browser: browser.version(),
        bundleHash,
        measuredAt: new Date().toISOString(),
        options: values,
        workloadDefinitions: {
          aligned: '16,384 UTF-16 unit inserts, deleted whole',
          survivors: '1,024 unit inserts retaining 64 units each',
          mixed: '1,024 unit inserts; three of four deleted whole',
          paragraph: 'replace the same 1,024 unit paragraph each cycle',
          original:
            'delete 4,194,304 units from original text; release session and external owners separately',
          'paste-tail':
            'paste 4,194,368 units, retain the 64-unit writable tail, reset sync-chain payload, release history and external owners',
        },
        failure,
        note: 'Two mounted editors; automatic maintenance; actual GC heap. Every baseline, before, after, and external-owner heap reading uses the second explicit timer-task and GC with maintenance suspended; the immediate CDP-GC reading is preserved separately because weak targets/finalizer bookkeeping may remain until a task boundary. A WeakRef-only sentinel created in each churn job must be absent after both task/GC rounds; original and paste fixtures have no churn sentinel. Registry backingUnits sum page backing lengths with duplicates and are not physical retained bytes. Maintenance completion counts must remain unchanged across each capture; the automatic scheduler resumes at the next maintenance wait. Heap peaks are 10ms CDP samples, not an exact maximum. Input probes measure trusted keydown to the second animation frame on identical text in the same browser before/after maintenance; observational paired timings, not the E002 calibrated regression gate. Original deletion checks history/clean and external-reader release separately; undo is excluded there because DocumentEditChain legitimately retains the restored insertion payload.',
        samples,
        heapSummary: heapSummary(samples),
        stringHeapSummary: heapSummary(samples, true),
        acceptance:
          'Retained code units must decrease; median baseline-subtracted string-category bytes must decrease by >10%. Total heap is observational. String bytes sum self_size for string, concatenated string and sliced string nodes, including backing strings, across the whole isolate; they are not exclusive document retained size. Original/paste external-owner checks use string bytes too.',
      },
      null,
      2,
    ),
  )
}

const samples = []
let currentCase = null
try {
  for (const entry of cases()) {
    currentCase = entry
    samples.push({ ...(await sample(entry.workload, entry.cycles)), repetition: entry.repetition })
  }
  verifyHeapSummary(samples)
  report(samples)
} catch (error) {
  report(samples, { ...currentCase, message: error.message })
  throw error
} finally {
  await browser.close()
  await new Promise((resolve) => server.close(resolve))
}
