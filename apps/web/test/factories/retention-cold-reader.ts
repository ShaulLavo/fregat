import { performance } from 'node:perf_hooks'

type CpuReason = 'unsupported' | 'observer-refused' | 'counter-drift'
type CpuSample =
  | { kind: 'measured'; user: number; system: number }
  | { kind: 'missing'; reason: CpuReason }
export type ColdReaderCounters = ReturnType<typeof createColdReaderCounters>
export function createColdReaderCounters() {
  return {
    chunks: 0,
    bytes: 0,
    byteMissing: 0,
    wallMs: 0,
    wallMissing: 0,
    throws: 0,
    cpuSamples: 0,
    userUs: 0,
    systemUs: 0,
    cpuMissing: { unsupported: 0, 'observer-refused': 0, 'counter-drift': 0 },
  }
}
function threadCpu(): CpuSample {
  try {
    if (typeof process.threadCpuUsage !== 'function')
      return { kind: 'missing', reason: 'unsupported' }
    const value = process.threadCpuUsage()
    if (
      !Number.isSafeInteger(value.user) ||
      value.user < 0 ||
      !Number.isSafeInteger(value.system) ||
      value.system < 0
    )
      return { kind: 'missing', reason: 'observer-refused' }
    return { kind: 'measured', user: value.user, system: value.system }
  } catch {
    return { kind: 'missing', reason: 'observer-refused' }
  }
}
function clock() {
  try {
    const now = performance.now()
    return Number.isFinite(now) ? now : null
  } catch {
    return null
  }
}
function bytes(chunk: Buffer) {
  try {
    const value = chunk.byteLength
    return Number.isSafeInteger(value) && value >= 0 ? value : null
  } catch {
    return null
  }
}
function cpuDelta(before: CpuSample, after: CpuSample): CpuSample {
  if (before.kind === 'missing') return before
  if (after.kind === 'missing') return after
  const user = after.user - before.user,
    system = after.system - before.system
  if (user < 0 || system < 0) return { kind: 'missing', reason: 'counter-drift' }
  return { kind: 'measured', user, system }
}
function add(
  counters: ColdReaderCounters,
  byteCount: number | null,
  wall: number | null,
  cpu: CpuSample,
  succeeded: boolean,
) {
  counters.chunks++
  if (byteCount === null) counters.byteMissing++
  else counters.bytes += byteCount
  if (wall === null) counters.wallMissing++
  else counters.wallMs += wall
  if (!succeeded) counters.throws++
  if (cpu.kind === 'missing') {
    counters.cpuMissing[cpu.reason]++
    return
  }
  counters.cpuSamples++
  counters.userUs += cpu.user
  counters.systemUs += cpu.system
}
export function measureColdReader<T>(
  counters: ColdReaderCounters,
  first: ColdReaderCounters | null,
  chunk: Buffer,
  read: () => T,
): T {
  const byteCount = bytes(chunk),
    before = threadCpu(),
    started = clock()
  let succeeded = false
  try {
    const value = read()
    succeeded = true
    return value
  } finally {
    try {
      const ended = clock(),
        after = threadCpu()
      const wall = started !== null && ended !== null && ended >= started ? ended - started : null
      const cpu = cpuDelta(before, after)
      add(counters, byteCount, wall, cpu, succeeded)
      if (first) add(first, byteCount, wall, cpu, succeeded)
    } catch {}
  }
}
function cpuReason(counters: ColdReaderCounters) {
  if (!counters.chunks) return 'no-calls'
  if (counters.cpuMissing.unsupported === counters.chunks) return 'unsupported'
  if (counters.cpuMissing['observer-refused'] === counters.chunks) return 'observer-refused'
  if (counters.cpuMissing['counter-drift'] === counters.chunks) return 'counter-drift'
  if (Object.values(counters.cpuMissing).some((count) => count > 0)) return 'incomplete'
  return null
}
export function coldReaderSummary(counters: ColdReaderCounters) {
  const missing = Object.values(counters.cpuMissing).reduce((sum, count) => sum + count, 0)
  return {
    chunks: counters.chunks,
    bytes: counters.byteMissing ? null : counters.bytes,
    byteMissing: counters.byteMissing,
    observedBytes: counters.bytes,
    wallMs: counters.wallMissing ? null : counters.wallMs,
    wallMissing: counters.wallMissing,
    throws: counters.throws,
    threadUserUs: missing || !counters.cpuSamples ? null : counters.userUs,
    threadSystemUs: missing || !counters.cpuSamples ? null : counters.systemUs,
    observedThreadUserUs: counters.cpuSamples ? counters.userUs : null,
    observedThreadSystemUs: counters.cpuSamples ? counters.systemUs : null,
    cpuSamples: counters.cpuSamples,
    cpuMissing: { ...counters.cpuMissing },
    cpuReason: cpuReason(counters),
  }
}
