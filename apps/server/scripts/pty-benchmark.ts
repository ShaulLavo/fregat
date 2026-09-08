import { existsSync } from 'node:fs'
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { arch, cpus, platform, release, tmpdir, totalmem } from 'node:os'
import path from 'node:path'
import { createError } from 'evlog'
import { parseTerminalServerMessage, terminalLeaseIdSchema } from '@workspace/contracts'
import * as v from 'valibot'

import { createAuthConfig } from '../src/auth'
import { createWorkspacePaths } from '../src/fs/path'
import { TerminalService } from '../src/terminal/service'

type ByteCounts = {
  input: number
  output: number
  encodedInput: number
  encodedOutput: number
}
type Sample = { durationMs: number; bytes: ByteCounts }
type PendingOutput = {
  marker: string
  resolve: (at: number) => void
  reject: (error: Error) => void
}

const ORIGIN = 'http://localhost:5173'
const STARTED = 'PTY-BENCHMARK-STARTED'
const READY = 'PTY-BENCHMARK-READY'
const STARTUP_SAMPLES = 20
const ROUND_TRIP_SAMPLES = 100
const STARTUP_WARMUPS = 2
const ROUND_TRIP_WARMUPS = 5
const SAMPLE_TIMEOUT_MS = 5_000
// The temporary worktree has one benchmark owner and no persisted execution leases.
const lifecycle = {
  begin: async () => ({
    terminalLeaseId: v.parse(terminalLeaseIdSchema, crypto.randomUUID()),
    runtimeEpoch: 'benchmark',
    activate: () => Promise.resolve(),
    terminate: () => Promise.resolve(),
    end: () => Promise.resolve(),
  }),
}

class OutputCapture {
  readonly bytes: ByteCounts = { input: 0, output: 0, encodedInput: 0, encodedOutput: 0 }
  readonly pending = new Set<PendingOutput>()
  output = ''
  firstOutputAt: number | null = null
  error: Error | null = null

  send(serialized: string | Uint8Array) {
    const at = performance.now()
    const message = parseTerminalServerMessage(serialized)
    this.bytes.encodedOutput += Buffer.byteLength(serialized)
    if (!message) return this.fail('The service emitted an invalid terminal message')
    if (message.type === 'error') return this.fail(message.message)
    if (message.type !== 'output') return

    this.firstOutputAt ??= at
    this.bytes.output += Buffer.byteLength(message.data)
    this.output += new TextDecoder().decode(message.data)
    for (const wait of this.pending) {
      if (!this.output.includes(wait.marker)) continue
      this.pending.delete(wait)
      wait.resolve(at)
    }
  }

  waitFor(marker: string): Promise<number> {
    if (this.error) return Promise.reject(this.error)
    if (this.output.includes(marker)) return Promise.resolve(performance.now())
    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => this.fail(`Timed out waiting for ${marker}`),
        SAMPLE_TIMEOUT_MS,
      )
      this.pending.add({
        marker,
        resolve: (at) => {
          clearTimeout(timer)
          resolve(at)
        },
        reject: (error) => {
          clearTimeout(timer)
          reject(error)
        },
      })
    })
  }

  fail(message: string) {
    const error = (this.error ??= benchmarkError(message))
    for (const wait of this.pending) wait.reject(error)
    this.pending.clear()
  }
}

async function openSession(root: string, id: string) {
  const capture = new OutputCapture()
  const pidFile = path.join(root, `${id}.pid`)
  const options = {
    lifecycle,
    paths: createWorkspacePaths(root),
    resolveWorktree: async () => root,
    env: {
      HOME: root,
      PATH: process.env.PATH,
      SHELL: path.join(root, 'shell'),
      PTY_BENCH_PID_FILE: pidFile,
    },
  }
  const service = new TerminalService(options)
  const routes = service.routes(createAuthConfig({ allowedOrigins: [ORIGIN] }))
  const socket = {
    raw: {},
    data: {
      headers: { origin: ORIGIN },
      query: { worktreeId: '00000000-0000-4000-8000-000000000001', terminalId: id },
    },
    send: (serialized: string | Uint8Array) => capture.send(serialized),
    close: () => capture.fail('The terminal closed before its expected output arrived'),
  }
  const ready = capture.waitFor(`${READY}\n`)
  const startedAt = performance.now()
  try {
    await Promise.all([routes.open(socket), ready])
  } catch (error) {
    await service.dispose()
    await cleanupProcess(pidFile)
    throw error
  }
  const firstOutputAt = capture.firstOutputAt
  if (firstOutputAt === null || !capture.output.startsWith(STARTED)) {
    await service.dispose()
    await cleanupProcess(pidFile)
    throw benchmarkError('The controlled shell did not produce the first output marker')
  }
  return {
    startup: { durationMs: firstOutputAt - startedAt, bytes: { ...capture.bytes } },
    async ping(marker: string): Promise<Sample> {
      const before = { ...capture.bytes }
      const received = capture.waitFor(marker)
      const serialized = new TextEncoder().encode(marker)
      capture.bytes.input += Buffer.byteLength(marker)
      capture.bytes.encodedInput += Buffer.byteLength(serialized)
      const sentAt = performance.now()
      routes.message(socket, serialized)
      const receivedAt = await received
      const bytes = subtractBytes(capture.bytes, before)
      if (bytes.output !== bytes.input)
        throw benchmarkError('Round-trip output byte count differs from input')
      return { durationMs: receivedAt - sentAt, bytes }
    },
    async close() {
      await service.dispose()
      await cleanupProcess(pidFile)
    },
  }
}

async function startupSamples(root: string) {
  const results: Sample[] = []
  for (let index = -STARTUP_WARMUPS; index < STARTUP_SAMPLES; index += 1) {
    const session = await openSession(root, `startup-${index}`)
    if (index >= 0) results.push(session.startup)
    await session.close()
  }
  return results
}

async function roundTripSamples(root: string) {
  const results: Sample[] = []
  const session = await openSession(root, 'roundtrip')
  try {
    for (let index = -ROUND_TRIP_WARMUPS; index < ROUND_TRIP_SAMPLES; index += 1) {
      const marker = `pty-${String(index).padStart(4, '0')}:`.padEnd(64, 'x')
      const sample = await session.ping(marker)
      if (index >= 0) results.push(sample)
    }
  } finally {
    await session.close()
  }
  return results
}

function subtractBytes(after: ByteCounts, before: ByteCounts): ByteCounts {
  return {
    input: after.input - before.input,
    output: after.output - before.output,
    encodedInput: after.encodedInput - before.encodedInput,
    encodedOutput: after.encodedOutput - before.encodedOutput,
  }
}

function summarize(samples: readonly Sample[]) {
  const durations = samples.map((sample) => sample.durationMs).sort((left, right) => left - right)
  const bytes = { input: 0, output: 0, encodedInput: 0, encodedOutput: 0 }
  for (const sample of samples) {
    for (const key of ['input', 'output', 'encodedInput', 'encodedOutput'] as const)
      bytes[key] += sample.bytes[key]
  }
  return {
    samples: samples.length,
    ms: {
      min: durations[0],
      median:
        (durations[Math.floor((durations.length - 1) / 2)] +
          durations[Math.floor(durations.length / 2)]) /
        2,
      p95: durations[Math.ceil(durations.length * 0.95) - 1],
      max: durations.at(-1),
    },
    bytes,
    measurementsMs: samples.map((sample) => sample.durationMs),
  }
}

async function cleanupProcess(pidFile: string) {
  const contents = await readFile(pidFile, 'utf8').catch(() => '')
  if (!contents) return
  const pid = Number(contents.trim())
  if (!Number.isInteger(pid) || pid <= 1) throw benchmarkError('The shell wrote an invalid PID')
  const deadline = performance.now() + SAMPLE_TIMEOUT_MS
  while (processExists(pid)) {
    if (performance.now() > deadline) {
      process.kill(pid, 'SIGKILL')
      throw benchmarkError(`PTY cleanup exceeded ${SAMPLE_TIMEOUT_MS} ms for PID ${pid}`)
    }
    await Bun.sleep(1)
  }
}

function processExists(pid: number) {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

function benchmarkError(message: string) {
  return createError({
    code: 'PTY_BENCHMARK_FAILED',
    message,
    status: 500,
    why: 'The controlled PTY benchmark did not complete its expected service interaction.',
    fix: 'Inspect the runtime and PTY lifecycle before accepting benchmark results.',
  })
}

async function main() {
  const base = existsSync('/work') ? '/work/tmp' : tmpdir()
  await mkdir(base, { recursive: true })
  const root = await mkdtemp(path.join(base, 'pty-benchmark-'))
  try {
    await writeFile(
      path.join(root, 'shell'),
      `#!/bin/sh\nset -eu\nprintf '%s\\n' "$$" > "$PTY_BENCH_PID_FILE"\nprintf '${STARTED}\\n'\nstty raw -echo\nprintf '${READY}\\n'\nexec cat\n`,
    )
    await chmod(path.join(root, 'shell'), 0o700)
    const startup = await startupSamples(root)
    const roundTrip = await roundTripSamples(root)
    const results = {
      backend: 'bun-native',
      startup: summarize(startup),
      roundTrip: summarize(roundTrip),
    }
    console.log(
      JSON.stringify(
        {
          measuredAt: new Date().toISOString(),
          scope:
            'Production TerminalService routes and binary protocol in-process; excludes orchestration persistence, WebSocket transport, and terminal rendering',
          runtime: { bun: Bun.version, executable: process.execPath },
          hardware: {
            platform: platform(),
            release: release(),
            arch: arch(),
            cpu: cpus()[0]?.model,
            logicalCpus: cpus().length,
            memoryBytes: totalmem(),
          },
          method: {
            startup: 'Service open to first STARTED output byte; fresh shell per sample',
            roundTrip:
              'Input route to matching output callback through exec cat after stty raw -echo',
            startupWarmups: STARTUP_WARMUPS,
            roundTripWarmups: ROUND_TRIP_WARMUPS,
            roundTripPayloadBytes: 64,
            startupByteCounts:
              'All ready and output messages through READY; startup sends no input',
            encodedBytes: 'Raw PTY bytes plus JSON control bytes, excluding WebSocket framing',
            timingUnit: 'milliseconds',
          },
          results,
        },
        null,
        2,
      ),
    )
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

await main()
