import assert from 'node:assert/strict'

export const arms = {
  GPARSE: { variant: 'ghostty-webgl', query: '&arm=GPARSE', parserOnly: true },
  GFRAME: { variant: 'ghostty-webgl', query: '&arm=GFRAME', noGpu: true, skipText: true },
  GSKIP: { variant: 'ghostty-webgl', query: '&arm=GSKIP', skipText: true },
  GFULL: { variant: 'ghostty-webgl', query: '&arm=GFULL' },
  XPARSE: { variant: 'xterm-webgl', query: '&arm=XPARSE', parserOnly: true },
  XFULL: { variant: 'xterm-webgl', query: '&arm=XFULL' },
}

export function assertArmWork(measured, count, ticks) {
  assert(arms[measured.arm], `Unknown arm ${measured.arm}`)
  assert.equal(measured.stock.completedTicks, ticks)
  assert.equal(measured.before.length, count)
  assert.equal(measured.after.length, count)
  const targets = measured.after.map((row, index) => ({
    index,
    counters: Object.fromEntries(
      Object.entries(row.counters).map(([key, value]) => [
        key,
        value - (measured.before[index].counters[key] ?? 0),
      ]),
    ),
    metrics: Object.fromEntries(
      Object.entries(row.metrics)
        .filter(([, value]) => typeof value === 'number')
        .map(([key, value]) => [key, value - (measured.before[index].metrics[key] ?? 0)]),
    ),
    historyRows: row.historyRows,
    dirty: row.dirty,
    nativeSessionRevision: row.nativeSessionRevision,
    acceptedFrameSessionRevision: row.acceptedFrameSessionRevision,
    diagnostics: row.diagnostics,
    contextLost: row.contextLost,
  }))
  const native = measured.arm.startsWith('G')
  const config = arms[measured.arm]
  for (const row of targets) {
    assert.equal(row.counters.publicWrites, ticks + 1)
    assert.equal(row.counters.inputBytes, measured.stock.inputBytesPerTerminal + 19)
    assert.equal(row.contextLost === true, false)
    if (native) assert.equal(row.counters.actualCoreWrites, ticks + 1)
    if (!native) {
      assert.equal(row.counters.writeCallbacks, ticks + 1)
      assert(row.counters.actualParserCalls >= ticks + 1)
    }
    if (config.parserOnly) {
      assert.equal(row.counters.rendererCallbacks ?? 0, 0)
      if (native) assert.equal(row.counters.actualRenderUpdates, 0)
      continue
    }
    assert(row.counters.rendererCallbacks > 0)
    if (native) {
      assert.equal(row.dirty, 0)
      assert.equal(row.nativeSessionRevision, row.acceptedFrameSessionRevision)
      assert.equal(row.diagnostics.hasPendingFrame, false)
      assert.equal(row.diagnostics.hasPendingTimer, false)
      assert.equal(row.metrics.deviceRestores ?? 0, 0)
      if (config.skipText) {
        assert.equal(row.counters.copiedRowCaptures, 0)
        assert.equal(row.counters.copiedTextReads, 0)
      } else {
        assert(row.counters.copiedRowCaptures > 0)
        assert(row.counters.copiedTextReads > 0)
      }
    }
  }
  const gl = Object.fromEntries(
    Object.entries(measured.budgetAfter.gl).map(([key, value]) => [
      key,
      value - (measured.budgetBefore.gl[key] ?? 0),
    ]),
  )
  const frames = measured.budgetAfter.nativeFrames - measured.budgetBefore.nativeFrames
  if (config.parserOnly) assert.equal(frames, 0)
  if (native && !config.parserOnly) assert(frames > 0)
  if (config.parserOnly || config.noGpu)
    assert.equal(
      Object.values(gl).reduce((a, b) => a + b, 0),
      0,
      JSON.stringify(gl),
    )
  if (!config.parserOnly && !config.noGpu) {
    assert((gl.bufferSubData ?? 0) + (gl.bufferData ?? 0) > 0, 'Buffer upload work missing')
    assert((gl.drawArraysInstanced ?? 0) + (gl.drawElementsInstanced ?? 0) > 0)
  }
  return targets
}
