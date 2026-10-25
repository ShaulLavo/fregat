import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { gunzipSync } from 'node:zlib'
import { measureCpu } from './comparison-guards.mjs'
import { tracePhase } from './comparison-trace.mjs'

function syntheticCdp({ churn = false, stall, recorderFailure } = {}) {
  let time = 0
  let operated = false
  const calls = []
  const trace = '{"traceEvents":[{"name":"retained"}]}'
  const session = new EventEmitter()
  session.send = async (name) => {
    calls.push(name)
    if (name === stall) return new Promise(() => {})
    if (name === 'SystemInfo.getProcessInfo') {
      const id = churn && operated ? 2 : 1
      const processInfo = [{ id, type: 'renderer', cpuTime: time / 1000 }]
      time += 10
      return { processInfo }
    }
    if (name === 'Tracing.end' && stall !== 'tracingComplete')
      session.emit('Tracing.tracingComplete', { stream: 'trace' })
    if (name === 'IO.read') return { data: trace, eof: true }
    return {}
  }
  const page = {
    async evaluate(callback) {
      const name = callback.toString().includes('traceBegin') ? 'record-begin' : 'record-end'
      calls.push(name)
      if (name === recorderFailure) assert.fail('Recorder failed')
      return { spans: [], counters: [], markers: [], ownership: [] }
    },
  }
  const sample = { completedWork: true }
  const operation = async () => {
    operated = true
    time += 100
    return sample
  }
  return { session, page, calls, trace, sample, operation, now: () => time }
}

async function temporaryOutput(t, prefix) {
  const output = await mkdtemp(join(tmpdir(), prefix))
  t.after(() => rm(output, { recursive: true }))
  return output
}

const counterReader = () => ({
  skipped: true,
  reason: 'Synthetic reader',
  initialProcessInfo: [{ id: 1, type: 'renderer', cpuTime: 0 }],
  close: async () => {},
})

for (const counters of [false, true]) {
  const options = () => (counters ? { counterReader: counterReader() } : {})
  test(`${counters ? 'counter' : 'default'} CPU rejection retains boundaries, timestamps and completed work`, async () => {
    const cdp = syntheticCdp({ churn: true })
    await assert.rejects(
      measureCpu(cdp.session, cdp.operation, { ...options(), now: cdp.now }),
      (error) => {
        assert.match(error.message, /CPU process set changed during sample/)
        const cpu = error.cpuFailure
        assert.deepEqual(cpu.before, [{ id: 1, type: 'renderer', cpuTime: 0 }])
        assert.deepEqual(cpu.after, [{ id: 2, type: 'renderer', cpuTime: 0.11 }])
        assert.deepEqual(cpu.interval, {
          before: { requested: 0, completed: 10 },
          after: { requested: 110, completed: 120 },
        })
        assert.equal(cpu.milliseconds, 110)
        assert.equal(cpu.acquisitionUncertaintyMilliseconds, 10)
        assert.deepEqual(cpu.operation, { started: 10, completed: 110, sample: cdp.sample })
        assert.equal(cpu.percentOfOneCore, undefined)
        return true
      },
    )
  })
}

for (const churn of [false, true]) {
  test(`operation failure ${churn ? 'with CPU rejection' : 'with a stable process set'} retains its partial result and after snapshot`, async () => {
    const cdp = syntheticCdp({ churn })
    const failure = Object.assign(new TypeError('Operation failed'), {
      partialLatency: { completedSamples: 3 },
    })
    await assert.rejects(
      measureCpu(
        cdp.session,
        async () => {
          await cdp.operation()
          throw failure
        },
        { now: cdp.now },
      ),
      (error) => {
        assert.match(error.message, churn ? /CPU process set changed/ : /Operation failed/)
        if (!churn) assert.equal(error, failure)
        assert.equal(error.cpuFailure.after.length, 1)
        assert.deepEqual(error.cpuFailure.operation.sample, failure.partialLatency)
        assert.match(error.cpuFailure.operation.error, /TypeError: Operation failed/)
        return true
      },
    )
    assert.equal(cdp.calls.filter((name) => name === 'SystemInfo.getProcessInfo').length, 2)
  })
}

test('a failed traced CPU window saves the finalized trace and completed operation before rejection', async (t) => {
  const output = await temporaryOutput(t, 'comparison-failure-')
  const cdp = syntheticCdp({ churn: true })
  await assert.rejects(
    tracePhase({ ...cdp, browserSession: cdp.session, output, label: 'churn', traced: true }),
    (error) => {
      assert.match(error.message, /CPU process set changed/)
      assert.equal(error.phaseFailure.trace, 'churn.trace.json.gz')
      assert.deepEqual(error.phaseFailure.sample, cdp.sample)
      assert.deepEqual(error.phaseFailure.cpu.operation.sample, cdp.sample)
      return true
    },
  )
  assert.equal(
    gunzipSync(await readFile(join(output, 'churn.trace.json.gz'))).toString(),
    cdp.trace,
  )
  assert.deepEqual(cdp.calls.slice(-4), ['record-end', 'Tracing.end', 'IO.read', 'IO.close'])
  assert.equal(cdp.session.listenerCount('Tracing.tracingComplete'), 0)
})

test('a simultaneous phase operation error survives CPU rejection and trace finalization', async (t) => {
  const output = await temporaryOutput(t, 'comparison-phase-error-')
  const cdp = syntheticCdp({ churn: true })
  await assert.rejects(
    tracePhase({
      ...cdp,
      browserSession: cdp.session,
      output,
      label: 'operation',
      traced: true,
      operation: async () => {
        await cdp.operation()
        throw Object.assign(new TypeError('Endpoint failed'), { partialLatency: cdp.sample })
      },
    }),
    (error) => {
      assert.match(error.message, /CPU process set changed/)
      assert.match(error.phaseFailure.cpu.operation.error, /Endpoint failed/)
      assert.deepEqual(error.phaseFailure.sample, cdp.sample)
      return true
    },
  )
  assert.equal(
    gunzipSync(await readFile(join(output, 'operation.trace.json.gz'))).toString(),
    cdp.trace,
  )
})

for (const recorderFailure of ['record-begin', 'record-end']) {
  test(`${recorderFailure} failure still saves the finalized trace`, async (t) => {
    const output = await temporaryOutput(t, 'comparison-recorder-error-')
    const cdp = syntheticCdp({ recorderFailure })
    await assert.rejects(
      tracePhase({
        ...cdp,
        browserSession: cdp.session,
        output,
        label: 'recorder',
        traced: true,
      }),
      (error) => {
        assert.match(error.message, /Recorder failed/)
        assert.equal(error.phaseFailure.trace, 'recorder.trace.json.gz')
        return true
      },
    )
    assert.equal(
      gunzipSync(await readFile(join(output, 'recorder.trace.json.gz'))).toString(),
      cdp.trace,
    )
  })
}

for (const stall of ['Tracing.end', 'tracingComplete', 'IO.read', 'IO.close']) {
  test(
    `stalled ${stall} finalization is bounded and preserves the original CPU rejection`,
    { timeout: 1000 },
    async (t) => {
      const output = await temporaryOutput(t, 'comparison-finalizer-error-')
      const cdp = syntheticCdp({ churn: true, stall })
      await assert.rejects(
        tracePhase({
          ...cdp,
          browserSession: cdp.session,
          output,
          label: 'stalled',
          traced: true,
          finalizationMilliseconds: 10,
        }),
        (error) => {
          assert.match(error.message, /CPU process set changed/)
          assert.match(error.phaseFailure.finalizationError, /deadline exceeded/)
          assert.deepEqual(error.phaseFailure.sample, cdp.sample)
          return true
        },
      )
      assert.equal(cdp.session.listenerCount('Tracing.tracingComplete'), 0)
      const files = await readdir(output)
      assert.deepEqual(files, stall === 'IO.close' ? ['stalled.trace.json.gz'] : [])
      if (stall === 'IO.close')
        assert.equal(gunzipSync(await readFile(join(output, files[0]))).toString(), cdp.trace)
    },
  )
}

test('a late trace read cannot save a file after finalization expires', async (t) => {
  const output = await temporaryOutput(t, 'comparison-late-trace-')
  const cdp = syntheticCdp({ churn: true })
  const send = cdp.session.send
  let finishRead
  cdp.session.send = async (name) => {
    if (name === 'IO.read')
      return new Promise((resolve) => {
        finishRead = resolve
      })
    return send(name)
  }
  await assert.rejects(
    tracePhase({
      ...cdp,
      browserSession: cdp.session,
      output,
      label: 'late',
      traced: true,
      finalizationMilliseconds: 10,
    }),
    /CPU process set changed/,
  )
  finishRead({ data: cdp.trace, eof: true })
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(cdp.calls.filter((name) => name === 'IO.close').length, 1)
  assert.deepEqual(await readdir(output), [])
})

for (const counters of [false, true]) {
  test(`a failed after snapshot retains completed work ${counters ? 'with counters' : 'by default'}`, async () => {
    const cdp = syntheticCdp()
    const send = cdp.session.send
    let snapshots = 0
    cdp.session.send = async (name) => {
      if (name === 'SystemInfo.getProcessInfo' && ++snapshots === 2) assert.fail('Snapshot failed')
      return send(name)
    }
    await assert.rejects(
      measureCpu(cdp.session, cdp.operation, {
        now: cdp.now,
        ...(counters ? { counterReader: counterReader() } : {}),
      }),
      (error) => {
        assert.match(error.message, /Snapshot failed/)
        assert.deepEqual(error.cpuFailure.before, [{ id: 1, type: 'renderer', cpuTime: 0 }])
        assert.equal(error.cpuFailure.after, null)
        assert.deepEqual(error.cpuFailure.operation.sample, cdp.sample)
        assert.deepEqual(error.cpuFailure.interval.after, { requested: 110, completed: 110 })
        return true
      },
    )
  })
}
