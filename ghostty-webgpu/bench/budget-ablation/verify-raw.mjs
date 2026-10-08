import assert from 'node:assert/strict'
import { readdir, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { createHash } from 'node:crypto'
import { arms, assertArmWork } from './proof.mjs'

assert(process.argv[2], 'Lane directory required')
const lane = resolve(process.argv[2])
const record = { windows: [], failures: [] }
const sha = (value) => createHash('sha256').update(value).digest('hex')
const oneValue = (values, message) => assert.equal(new Set(values).size, 1, message)
function assertGeometry(row, protocol) {
  for (const target of row.geometry) {
    const backing = target.geometry.filter((canvas) => canvas.renderingCanvas)
    assert.equal(backing.length, arms[row.actor].parserOnly ? 0 : 1)
    for (const canvas of backing) {
      assert.deepEqual([canvas.width, canvas.height], protocol.expectedDrawingBacking)
      assert.equal(canvas.visible, true)
    }
  }
}
for (const name of await readdir(lane)) {
  if (!name.startsWith('mac-')) continue
  const protocolPath = join(lane, name, 'protocol.json')
  let protocol
  try {
    protocol = JSON.parse(await readFile(protocolPath, 'utf8'))
  } catch {
    continue
  }
  const path = join(lane, name, 'native', protocol.id, 'index.json')
  let bytes
  try {
    bytes = await readFile(path)
  } catch {
    continue
  }
  const data = JSON.parse(bytes)
  assert.equal(data.protocolSha256, sha(await readFile(protocolPath)))
  assert.equal(data.runtimeCommit, protocol.runtimeCommit)
  assert(Date.parse(protocol.registeredAt) < Date.parse(data.startedAt))
  const custody = JSON.parse(await readFile(join(lane, name, 'native', 'custody.json'), 'utf8'))
  assert.equal(custody.clean, true)
  const { nativeDelta } = await import(join(protocol.artifact, 'measure.mjs'))
  for (const row of data.runs) {
    if (row.status !== 'complete') continue
    assert.equal(row.actor, protocol.order[row.index])
    assert.deepEqual(
      nativeDelta(row.snapshots.before, row.snapshots.after, row.readerReady),
      row.native,
    )
    assert.deepEqual(
      JSON.parse(JSON.stringify(assertArmWork(row.measured, protocol.count, protocol.ticks))),
      row.targetWork,
    )
    assert.equal(row.native.commonValidation.status, 'measured')
    assert.equal(row.inputs.length, protocol.count)
    assert.equal(row.content.length, protocol.count)
    assert.equal(row.cells.length, protocol.count)
    oneValue(
      row.inputs.map((input) => JSON.stringify(input)),
      'Target input boundaries differ',
    )
    assert.equal(row.inputs[0].calls, protocol.expectedPublicWritesPerTarget)
    assert.equal(
      row.inputs[0].byteLengths.reduce((a, b) => a + b, 0),
      protocol.expectedInputBytesPerTarget,
    )
    assert.equal(row.inputSha256, row.inputs[0].framedInputSha256)
    for (const target of row.content) {
      assert.equal(target.historyRows, protocol.expectedFinalHistoryRows)
      assert.equal(target.retainedRows, target.historyRows + 12)
    }
    const semantic = row.content.map(({ historyRows, retainedRows, retainedTextSha256 }) => ({
      historyRows,
      retainedRows,
      retainedTextSha256,
    }))
    assert.equal(row.contentSha256, sha(JSON.stringify(semantic)))
    const cellProof = row.cells.map(
      ({ index, rows, columns, mode2027, widthsAndOwnerBoundariesSha256, ownerTextSha256 }) => ({
        index,
        rows,
        columns,
        mode2027,
        widthsAndOwnerBoundariesSha256,
        ownerTextSha256,
      }),
    )
    assert.equal(row.cellLayoutSha256, sha(JSON.stringify(cellProof)))
    for (const cells of row.cells) {
      assert.equal(cells.rows, protocol.expectedFinalHistoryRows + 12)
      assert.equal(cells.columns, 40)
      assert.equal(cells.mode2027, false)
    }
    assertGeometry(row, protocol)
    const imagePath = join(
      lane,
      name,
      'native',
      protocol.id,
      `${String(row.index).padStart(2, '0')}-${row.actor}-${row.workload}.png`,
    )
    assert.equal(sha(await readFile(imagePath)), row.screenshotSha256)
    record.windows.push({
      id: protocol.id,
      index: row.index,
      actor: row.actor,
      rawSha256: sha(bytes),
    })
  }
  if (!data.complete) {
    record.failures.push({ id: protocol.id, failure: data.failure })
    continue
  }
  assert.equal(data.runs.length, protocol.order.length)
  for (const field of ['inputSha256', 'contentSha256', 'cellLayoutSha256'])
    oneValue(
      data.runs.map((row) => row[field]),
      `${field} differs across arms`,
    )
  const nativeRender = data.runs.filter(
    (row) => row.actor.startsWith('G') && !arms[row.actor].parserOnly,
  )
  oneValue(
    nativeRender.map(
      (row) => row.measured.budgetAfter.nativeFrames - row.measured.budgetBefore.nativeFrames,
    ),
    'Native frame work differs',
  )
  const sharedCounters = [
    'actualCoreWrites',
    'rendererCallbacks',
    'actualRenderUpdates',
    'actualAcknowledgements',
    'actualFramePublications',
    'actualScrollNotifications',
  ]
  oneValue(
    nativeRender.map((row) =>
      JSON.stringify(
        row.targetWork.map((target) => sharedCounters.map((key) => target.counters[key])),
      ),
    ),
    'Native render and session work differs',
  )
  for (const actor of protocol.order) {
    if (arms[actor].parserOnly || arms[actor].noGpu) continue
    oneValue(
      data.runs.filter((row) => row.actor === actor).map((row) => row.screenshotSha256),
      'Same-arm complete PNG differs',
    )
  }
}
record.complete = record.windows.length === 24 && record.failures.length === 0
await writeFile(join(lane, 'raw-verification.json'), JSON.stringify(record, null, 2) + '\n')
console.log(JSON.stringify(record))
assert(record.complete, 'Both complete balanced jobs required')
