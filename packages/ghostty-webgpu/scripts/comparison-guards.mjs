import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { counterDelta, createCounterReader, parseCounterSnapshot } from './comparison-counters.mjs'

export function verifyHash(bytes, expected, name) {
  assert.equal(
    createHash('sha256').update(bytes).digest('hex'),
    expected,
    `Bundle asset hash mismatch: ${name}`,
  )
}

export function cpuSample(before, after, milliseconds) {
  const prior = new Map(before.map((entry) => [entry.id, entry]))
  const ids = new Set(after.map((entry) => entry.id))
  assert(
    before.every((entry) => ids.has(entry.id)) && after.every((entry) => prior.has(entry.id)),
    'CPU process set changed during sample',
  )
  const secondsByType = {}
  for (const entry of after) {
    const previous = prior.get(entry.id).cpuTime
    const delta = entry.cpuTime - previous
    assert(
      Number.isFinite(delta) && delta >= 0,
      `CPU counter delta invalid for process ${entry.id}: before=${previous} after=${entry.cpuTime}`,
    )
    secondsByType[entry.type] = (secondsByType[entry.type] ?? 0) + delta
  }
  return {
    before,
    after,
    secondsByType,
    percentOfOneCore:
      (Object.values(secondsByType).reduce((a, b) => a + b, 0) / milliseconds) * 100_000,
    processChurn: false,
  }
}

async function cpuSnapshot(session, now, boundary = {}) {
  boundary.requested = now()
  try {
    const { processInfo } = await session.send('SystemInfo.getProcessInfo')
    boundary.processInfo = processInfo
  } finally {
    boundary.completed = now()
    boundary.sampledAt = (boundary.requested + boundary.completed) / 2
  }
  return boundary
}

async function captureCpuOperation(operation, now) {
  const evidence = { started: now() }
  let failure
  try {
    evidence.sample = await operation()
  } catch (error) {
    failure = error
    evidence.sample = error.partialLatency
    evidence.error = String(error.stack ?? error)
  }
  evidence.completed = now()
  return { evidence, failure }
}

function cpuTiming(before, after, tickSeconds, workCounters) {
  const bracket = (value) =>
    value.requested === undefined
      ? null
      : { requested: value.requested, completed: value.completed }
  const timing = {
    tickSeconds,
    milliseconds: after.sampledAt - before.sampledAt,
    interval: { before: bracket(before), after: bracket(after) },
    acquisitionUncertaintyMilliseconds:
      (before.completed - before.requested + after.completed - after.requested) / 2,
  }
  if (workCounters) timing.workCounters = workCounters
  return timing
}

function retainCpuFailure(error, before, after, operation, tickSeconds, workCounters) {
  error.cpuFailure ??= {
    before: before.processInfo ?? null,
    after: after.processInfo ?? null,
    ...cpuTiming(before, after, tickSeconds, workCounters),
    operation: operation?.evidence,
  }
  return error
}

function finishCpuMeasurement(before, after, operation, tickSeconds, workCounters) {
  const timing = cpuTiming(before, after, tickSeconds, workCounters)
  const interval = timing.milliseconds
  let cpu
  try {
    assert(Number.isFinite(interval) && interval > 0, 'Positive CPU sampling interval required')
    cpu = { ...cpuSample(before.processInfo, after.processInfo, interval), ...timing }
    if (operation.failure) throw operation.failure
  } catch (error) {
    throw retainCpuFailure(error, before, after, operation, tickSeconds, workCounters)
  }
  return {
    sample: operation.evidence.sample,
    milliseconds: operation.evidence.completed - operation.evidence.started,
    cpu,
  }
}

async function measureCpuOnly(
  session,
  operation,
  { now = () => performance.now(), tickSeconds = null } = {},
) {
  const before = {}
  const after = {}
  let captured
  try {
    await cpuSnapshot(session, now, before)
    captured = await captureCpuOperation(operation, now)
    await cpuSnapshot(session, now, after)
    return finishCpuMeasurement(before, after, captured, tickSeconds)
  } catch (error) {
    throw retainCpuFailure(error, before, after, captured, tickSeconds)
  }
}

function workEvidence(reader, counterFailure, before, after, nativeBefore, nativeAfter, setup) {
  const workCounters = { status: 'skipped', reason: counterFailure, setup: reader.setup ?? setup }
  if (!reader.metadata) return workCounters
  workCounters.metadata = reader.metadata
  workCounters.snapshots = { before: nativeBefore?.raw ?? null, after: nativeAfter?.raw ?? null }
  const bracket = (value) =>
    value ? { requested: value.requested, completed: value.completed } : null
  workCounters.boundary = {
    before: { cdp: bracket(before), native: bracket(nativeBefore) },
    after: { cdp: bracket(after), native: bracket(nativeAfter) },
  }
  if (counterFailure) return workCounters
  try {
    const result = {
      ...workCounters,
      ...counterDelta(
        parseCounterSnapshot(nativeBefore.raw, reader.metadata),
        parseCounterSnapshot(nativeAfter.raw, reader.metadata),
        before.processInfo,
        after.processInfo,
      ),
    }
    delete result.reason
    return result
  } catch (error) {
    return { ...workCounters, reason: error.message }
  }
}

export async function measureCpu(
  session,
  operation,
  {
    now = () => performance.now(),
    tickSeconds = null,
    processCounters = false,
    counterReader,
    counterTimeoutMilliseconds,
  } = {},
) {
  if (!processCounters && !counterReader)
    return measureCpuOnly(session, operation, { now, tickSeconds })
  const setupRequested = now()
  const reader =
    counterReader ??
    (await createCounterReader(session, { timeoutMilliseconds: counterTimeoutMilliseconds }))
  const setupCompleted = now()
  let counterFailure = reader.skipped ? reader.reason : null
  async function nativeSnapshot(processes) {
    if (counterFailure) return null
    const requested = now()
    try {
      const raw = await reader.snapshot(processes)
      return { raw, requested, completed: now() }
    } catch (error) {
      counterFailure = error.message
      return { raw: null, requested, completed: now(), error: error.message }
    }
  }
  const before = {}
  const after = {}
  let captured
  let failure
  try {
    const initial = reader.initialProcessInfo ?? (await cpuSnapshot(session, now)).processInfo
    const nativeBefore = await nativeSnapshot(initial)
    await cpuSnapshot(session, now, before)
    captured = await captureCpuOperation(operation, now)
    await cpuSnapshot(session, now, after)
    const nativeAfter = await nativeSnapshot(after.processInfo)
    const workCounters = workEvidence(
      reader,
      counterFailure,
      before,
      after,
      nativeBefore,
      nativeAfter,
      { requested: setupRequested, completed: setupCompleted },
    )
    return finishCpuMeasurement(before, after, captured, tickSeconds, workCounters)
  } catch (error) {
    failure = retainCpuFailure(error, before, after, captured, tickSeconds)
    throw failure
  } finally {
    await closeCounterReader(reader, failure)
  }
}

async function closeCounterReader(reader, failure) {
  try {
    await reader.close?.()
  } catch (error) {
    if (!failure) throw error
    failure.cpuFailure.counterCloseError = String(error.stack ?? error)
  }
}

export class ComparisonDeadlineError extends Error {
  constructor() {
    super('Comparison case deadline exceeded')
  }
}

export async function withDeadline(
  operation,
  milliseconds,
  expire,
  { drain = false, drainMilliseconds = 10_000 } = {},
) {
  let timer
  let cleanup
  const running = Promise.resolve().then(operation)
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => {
      cleanup = Promise.resolve().then(expire)
      reject(new ComparisonDeadlineError())
    }, milliseconds)
  })
  try {
    return await Promise.race([running, deadline])
  } catch (error) {
    if (cleanup) await cleanup
    // A case owns the browser-wide trace until its finalizer drains the stream.
    if (cleanup && drain) {
      await withDeadline(
        () => running.catch(() => {}),
        drainMilliseconds,
        () => {},
      )
    }
    throw error
  } finally {
    clearTimeout(timer)
  }
}
