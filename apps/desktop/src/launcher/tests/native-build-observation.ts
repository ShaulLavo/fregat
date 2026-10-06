import { writeSync } from 'node:fs'
import { performance } from 'node:perf_hooks'

type Boundary = 'callback' | 'build' | 'compiler' | 'plutil' | 'other' | 'cleanup' | 'observer'
type Stage = 'before' | 'after' | 'threw' | 'restored' | 'limit'
type Sink = (line: string) => number
const boundaries: readonly Boundary[] = [
  'callback',
  'build',
  'compiler',
  'plutil',
  'other',
  'cleanup',
  'observer',
]
const stages: readonly Stage[] = ['before', 'after', 'threw', 'restored', 'limit']

function ownValue(value: unknown, key: string): unknown {
  if ((typeof value !== 'object' && typeof value !== 'function') || value === null) return undefined
  return Object.getOwnPropertyDescriptor(value, key)?.value
}

function integer(value: unknown) {
  return typeof value === 'number' && Number.isSafeInteger(value) ? value : null
}

function resultFacts(value: unknown) {
  const pid = integer(ownValue(value, 'pid'))
  const exit = integer(ownValue(value, 'exitCode'))
  const signal = ownValue(value, 'signalCode')
  const signalAvailable =
    signal === null || (typeof signal === 'string' && /^SIG[A-Z0-9]{1,16}$/.test(signal))
  return { pid, exit, signal: signalAvailable ? signal : null, signalAvailable }
}

function commandBoundary(args: unknown[]): Boundary {
  const first = args[0]
  const command = Array.isArray(first) ? first : ownValue(first, 'cmd')
  const executable = ownValue(command, '0')
  if (typeof executable !== 'string' || executable.length > 256) return 'other'
  const name = executable.slice(executable.lastIndexOf('/') + 1)
  if (name === 'clang') return 'compiler'
  if (name === 'plutil') return 'plutil'
  return 'other'
}

function createObservation(sink: Sink) {
  const started = performance.now()
  let records = 0
  let bytes = 0
  let written = 0
  let unavailable = 0
  let refused = 0
  let lost = 0
  let truncated = false
  let spawn: ReturnType<typeof resultFacts> | null = null
  let compiler: ReturnType<typeof resultFacts> | null = null
  let plutil: ReturnType<typeof resultFacts> | null = null
  let compilerMs: number | null = null
  let plutilMs: number | null = null
  let buildStarted: number | null = null
  let buildMs: number | null = null

  function emit(line: string) {
    const length = Buffer.byteLength(line)
    if (length > 1024 || bytes + length > 8192) {
      refused++
      lost++
      truncated = true
      return
    }
    records++
    bytes += length
    try {
      const count = sink(line)
      if (Number.isSafeInteger(count) && count >= 0 && count <= length) written += count
      if (count !== length) {
        unavailable++
        lost++
      }
    } catch {
      unavailable++
      lost++
    }
  }

  function phase(boundary: Boundary, stage: Stage) {
    try {
      if (!boundaries.includes(boundary) || !stages.includes(stage)) {
        refused++
        lost++
        return
      }
      if (truncated) {
        lost++
        return
      }
      const elapsedMs = performance.now() - started
      if (
        stage === 'before' &&
        (boundary === 'compiler' || boundary === 'plutil' || boundary === 'other')
      )
        spawn = null
      if (boundary === 'build' && stage === 'before') buildStarted = elapsedMs
      if (boundary === 'build' && stage === 'after' && buildStarted !== null)
        buildMs = elapsedMs - buildStarted
      const snapshot = () => ({
        pid: process.pid,
        boundary,
        stage,
        elapsedMs,
        spawn,
        compiler,
        compilerMs,
        plutil,
        plutilMs,
        buildMs,
        records,
        bytes,
        written,
        unavailable,
        refused,
        lost,
        truncated,
      })
      let line = '[native-build-observation] ' + JSON.stringify(snapshot()) + '\n'
      if (records >= 15 || bytes + Buffer.byteLength(line) + 1024 > 8192) {
        truncated = true
        lost++
        boundary = 'observer'
        stage = 'limit'
        line = '[native-build-observation] ' + JSON.stringify(snapshot()) + '\n'
      }
      emit(line)
    } catch {
      unavailable++
      lost++
    }
  }

  function completed(boundary: Boundary, value: unknown, elapsed: number) {
    try {
      spawn = resultFacts(value)
      if (boundary === 'compiler') {
        compiler = spawn
        compilerMs = elapsed
      }
      if (boundary === 'plutil') {
        plutil = spawn
        plutilMs = elapsed
      }
    } catch {
      unavailable++
      lost++
    }
    phase(boundary, 'after')
  }

  function classify(args: unknown[]): Boundary {
    try {
      return commandBoundary(args)
    } catch {
      unavailable++
      return 'other'
    }
  }

  return { phase, completed, classify }
}

export function observeNativeBuild<T>(
  callback: (phase: ReturnType<typeof createObservation>['phase']) => T,
  sink: Sink = (line) => writeSync(2, line),
): T {
  const observation = createObservation(sink)
  const original = Bun.spawnSync
  const observed = new Proxy(original, {
    apply(target, receiver: unknown, args: unknown[]) {
      const boundary = observation.classify(args)
      observation.phase(boundary, 'before')
      const started = performance.now()
      let result: unknown
      try {
        result = Reflect.apply(target, receiver, args)
      } catch (error) {
        observation.phase(boundary, 'threw')
        throw error
      }
      observation.completed(boundary, result, performance.now() - started)
      return result
    },
  })
  Bun.spawnSync = observed
  try {
    observation.phase('callback', 'before')
    const result = callback(observation.phase)
    observation.phase('callback', 'after')
    return result
  } catch (error) {
    observation.phase('callback', 'threw')
    throw error
  } finally {
    Bun.spawnSync = original
    observation.phase('cleanup', 'restored')
  }
}
