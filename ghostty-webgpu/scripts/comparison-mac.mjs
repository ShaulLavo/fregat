import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { loadavg } from 'node:os'
import { performance } from 'node:perf_hooks'
import { setTimeout as delay } from 'node:timers/promises'
import { promisify } from 'node:util'
import { GpuQualificationError } from './comparison-gpu.mjs'

const execute = promisify(execFile)

export async function sampleMacHost({ command = execute, load = loadavg, timeoutMilliseconds }) {
  const options = {
    encoding: 'utf8',
    timeout: Math.ceil(timeoutMilliseconds),
    killSignal: 'SIGKILL',
  }
  const [power, processes] = await Promise.all([
    command('/usr/bin/pmset', ['-g', 'batt'], options),
    command('/bin/ps', ['-axo', 'comm='], options),
  ])
  const loadAverage = load()[0]
  assert(Number.isFinite(loadAverage) && loadAverage >= 0, 'Valid host load average required')
  return {
    observedAt: new Date().toISOString(),
    acPower: power.stdout.includes("'AC Power'"),
    t3Code: /(?:^|\/)T3 Code(?: \([^/\r\n]+\))?(?:\.app| Helper|\s*$)/im.test(processes.stdout),
    loadAverage,
  }
}

export function createMacHostGate(
  settings,
  {
    command = execute,
    now = () => performance.now(),
    sleep = delay,
    sample = (timeoutMilliseconds) => sampleMacHost({ command, timeoutMilliseconds }),
  } = {},
) {
  assert(
    Number.isFinite(settings.macIdleLoadAverage) && settings.macIdleLoadAverage > 0,
    'Positive macIdleLoadAverage required',
  )
  const evidence = (kind) => ({
    kind,
    foreignActivityMetric: 'host-load-average-and-t3-process-presence',
    limitation:
      'Host load is an idle proxy. This gate does not measure Metal GPU utilization. Window checks cover AC power and T3 Code presence; load includes the benchmark.',
    status: 'sampling',
    qualified: false,
    settings: {
      macIdleLoadAverage: settings.macIdleLoadAverage,
      gpuSampleMilliseconds: settings.gpuSampleMilliseconds,
      gpuIdleConsecutiveSamples: settings.gpuIdleConsecutiveSamples,
      gpuIdleWaitMilliseconds: settings.gpuIdleWaitMilliseconds,
      gpuCommandTimeoutMilliseconds: settings.gpuCommandTimeoutMilliseconds,
    },
    samples: [],
  })

  function fail(result, reason) {
    Object.assign(result, { status: 'failed', qualified: false, reason })
    throw new GpuQualificationError(reason, result)
  }

  async function acquire(result, timeout = settings.gpuCommandTimeoutMilliseconds) {
    let reading
    try {
      reading = await sample(timeout)
    } catch (error) {
      result.samplingError = { name: error.name, code: error.code ?? null, message: error.message }
      fail(result, 'Mac host qualification sampling failed')
    }
    result.samples.push(reading)
    if (!reading.acPower) fail(result, 'Mac measurements require AC power')
    if (reading.t3Code) fail(result, 'Close T3 Code before Mac measurements')
    return reading
  }

  async function waitForIdle() {
    const result = evidence('idle')
    const started = now()
    let consecutive = 0
    while (now() - started < settings.gpuIdleWaitMilliseconds) {
      const remaining = settings.gpuIdleWaitMilliseconds - (now() - started)
      const reading = await acquire(
        result,
        Math.min(remaining, settings.gpuCommandTimeoutMilliseconds),
      )
      consecutive = reading.loadAverage < settings.macIdleLoadAverage ? consecutive + 1 : 0
      result.waitMilliseconds = now() - started
      if (
        consecutive >= settings.gpuIdleConsecutiveSamples &&
        result.waitMilliseconds <= settings.gpuIdleWaitMilliseconds
      ) {
        return Object.assign(result, { status: 'qualified', qualified: true })
      }
      const pause = Math.min(
        settings.gpuSampleMilliseconds,
        settings.gpuIdleWaitMilliseconds - (now() - started),
      )
      if (pause > 0) await sleep(pause)
    }
    result.waitMilliseconds = now() - started
    fail(result, 'Mac host idle wait expired')
  }

  async function monitorWindow(
    operation,
    { sampleMilliseconds = settings.gpuSampleMilliseconds } = {},
  ) {
    assert(
      Number.isFinite(sampleMilliseconds) && sampleMilliseconds > 0,
      'Positive sampleMilliseconds required',
    )
    const result = evidence('window')
    result.settings.gpuSampleMilliseconds = sampleMilliseconds
    await acquire(result)
    const controller = new AbortController()
    const monitoring = monitor(result, controller.signal, sampleMilliseconds).catch(
      (error) => error,
    )
    let value
    let operationFailure
    let monitoringFailure
    try {
      value = await operation()
    } catch (error) {
      operationFailure = { error }
    } finally {
      controller.abort()
      monitoringFailure = await monitoring
    }
    if (monitoringFailure) throw monitoringFailure
    if (operationFailure) throw operationFailure.error
    await acquire(result)
    return { value, gpu: Object.assign(result, { status: 'qualified', qualified: true }) }
  }

  async function monitor(result, signal, sampleMilliseconds) {
    while (!signal.aborted) {
      try {
        await sleep(sampleMilliseconds, undefined, { signal })
      } catch (error) {
        if (signal.aborted) return
        throw error
      }
      if (!signal.aborted) await acquire(result)
    }
  }

  return { waitForIdle, monitorWindow }
}
