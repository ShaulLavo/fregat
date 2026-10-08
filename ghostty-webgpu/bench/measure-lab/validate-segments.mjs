import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import { createHash } from 'node:crypto'

const [input, measureModule, output] = process.argv.slice(2)
const { nativeDelta, assertWork } = await import(pathToFileURL(measureModule).href)
const bytes = await readFile(input)
const data = JSON.parse(bytes)
assert(data.complete, data.failure)
let endpointPairs = 0
for (const record of [
  ...data.runs,
  ...data.idle,
  ...Object.values(data.arms).map((arm) => arm.identification),
  ...(data.injectionCalibration ?? []),
]) {
  const before = record.snapshots?.before ?? record.before
  const after = record.snapshots?.after ?? record.after
  assert.deepEqual(nativeDelta(before, after), record.native)
  for (const snapshot of [before, after]) {
    assert(BigInt(snapshot.nativeCompletedNs) >= BigInt(snapshot.nativeRequestedNs))
    assert(BigInt(snapshot.completedNs) >= BigInt(snapshot.requestedNs))
    for (const process of Object.values(snapshot.usage.processes))
      assert(BigInt(process.completedNs) >= BigInt(process.requestedNs))
  }
  endpointPairs++
}
const lastTarget = {}
for (const [label, arm] of Object.entries(data.arms)) {
  assertWork(arm.warmup, data.protocol.count, data.protocol.warmupTicks)
  lastTarget[label] = arm.warmup.after
  if (arm.rgbaHashes) assert.equal(arm.rgbaHashes.length, data.protocol.count)
}
for (const row of data.runs) {
  assert.deepEqual(
    row.measured.before.map((target) => target.counters),
    lastTarget[row.label].map((target) => target.counters),
  )
  lastTarget[row.label] = row.measured.after
  assert.deepEqual(
    assertWork(row.measured, data.protocol.count, data.protocol.ticks),
    row.targetWork,
  )
  assert(row.native.perPid.find((p) => p.pid === row.activePid && p.type === 'renderer'))
  assert(row.native.perPid.find((p) => p.pid === row.idlePid && p.type === 'renderer'))
  assert.notEqual(row.activePid, row.idlePid)
  assert(Object.values(row.readerReady.capabilities).every((c) => c.available))
}
const example = data.runs[0]
const tampered = structuredClone(example.snapshots.after)
const pid = String(example.activePid)
tampered.usage.processes[pid].values.ri_proc_start_abstime = '1'
assert.throws(() => nativeDelta(example.snapshots.before, tampered), /reused/)
const missing = structuredClone(example.snapshots.after)
delete missing.usage.processes[pid]
assert.throws(() => nativeDelta(example.snapshots.before, missing), /coverage missing/)
const exited = structuredClone(example.snapshots.after)
exited.usage.processes[pid].values.ri_proc_exit_abstime = '1'
assert.throws(() => nativeDelta(example.snapshots.before, exited), /exited/)
const regressed = structuredClone(example.snapshots.after)
regressed.usage.processes[pid].values.ri_instructions = '0'
assert.throws(() => nativeDelta(example.snapshots.before, regressed), /Invalid counter delta/)
const receipt = {
  inputSha256: createHash('sha256').update(bytes).digest('hex'),
  id: data.id,
  endpointPairs,
  segments: data.runs.length,
  allNativeDeltasRecomputed: true,
  allTargetWorkRecomputed: true,
  reusedPidRejected: true,
  missingPidRejected: true,
  exitedPidRejected: true,
  counterRegressionRejected: true,
  finalRasterMatched: data.arms.A.rgbaHashes
    ? JSON.stringify(data.arms.A.rgbaHashes) === JSON.stringify(data.arms.B.rgbaHashes)
    : null,
  coverage:
    'Stable endpoint PID/type/start identities. Counter reads are sequential; wholly inter-endpoint short-lived processes can be missed.',
}
await writeFile(output, JSON.stringify(receipt, null, 2) + '\n')
console.log(JSON.stringify(receipt))
