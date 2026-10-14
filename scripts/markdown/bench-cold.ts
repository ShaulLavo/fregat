import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { canonicalHast, createRemarkReplay } from '../../packages/markdown/test/qualification'
import { createScriptError } from '../structured-errors'
import type { BenchmarkSample } from './bench-types'
import type { NativeTrial } from './bench-native'
import type { Workload } from './workloads'
import type { createHastProcessor } from '../../packages/markdown/src/utils/hast'

const execute = promisify(execFile)

export async function coldTrial(input: {
  workload: Workload
  trial: number
  extensions: Parameters<typeof createHastProcessor>[0]
}): Promise<NativeTrial> {
  const controller = new AbortController()
  const abort = () => controller.abort()
  process.once('SIGINT', abort)
  process.once('SIGTERM', abort)
  try {
    const { stdout } = await execute(
      process.execPath,
      [
        fileURLToPath(new URL('./bench-cold-worker.ts', import.meta.url)),
        JSON.stringify({ source: input.workload.source }),
      ],
      { timeout: 30000, maxBuffer: 1024 * 1024, signal: controller.signal },
    )
    return coldSamples(input, parseColdResult(JSON.parse(stdout)))
  } finally {
    controller.abort()
    process.removeListener('SIGINT', abort)
    process.removeListener('SIGTERM', abort)
  }
}

type ColdResult = {
  dependencyImportMs: number
  initializationMs: number
  parseMs: number
  projectionMs: number
  firstResultMs: number
  cpuMs: number
  sourceBytes: number
  digest: string
}

function parseColdResult(value: unknown): ColdResult {
  if (!value || typeof value !== 'object') throw invalidColdResult()
  if (!('dependencyImportMs' in value) || !validNumber(value.dependencyImportMs))
    throw invalidColdResult()
  if (!('initializationMs' in value) || !validNumber(value.initializationMs))
    throw invalidColdResult()
  if (!('parseMs' in value) || !validNumber(value.parseMs)) throw invalidColdResult()
  if (!('projectionMs' in value) || !validNumber(value.projectionMs)) throw invalidColdResult()
  if (!('firstResultMs' in value) || !validNumber(value.firstResultMs)) throw invalidColdResult()
  if (!('cpuMs' in value) || !validNumber(value.cpuMs)) throw invalidColdResult()
  if (!('sourceBytes' in value) || !validNumber(value.sourceBytes)) throw invalidColdResult()
  if (
    !('digest' in value) ||
    typeof value.digest !== 'string' ||
    !/^[a-f0-9]{64}$/u.test(value.digest)
  )
    throw invalidColdResult()
  return {
    dependencyImportMs: value.dependencyImportMs,
    initializationMs: value.initializationMs,
    parseMs: value.parseMs,
    projectionMs: value.projectionMs,
    firstResultMs: value.firstResultMs,
    cpuMs: value.cpuMs,
    sourceBytes: value.sourceBytes,
    digest: value.digest,
  }
}

function validNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
}

function invalidColdResult() {
  return createScriptError('Cold worker returned an invalid measurement', {
    internal: { boundary: 'cold-worker-result' },
  })
}

function coldSamples(
  input: {
    workload: Workload
    trial: number
    extensions: Parameters<typeof createHastProcessor>[0]
  },
  result: ColdResult,
): NativeTrial {
  const root = createRemarkReplay({ extensions: input.extensions }).update(
    input.workload.source,
    false,
  )
  const digest = createHash('sha256').update(canonicalHast(root)).digest('hex')
  const outputMatches =
    digest === result.digest && result.sourceBytes === input.workload.sourceBytes
  const fields: readonly [string, number][] = [
    ['nativeColdDependencyImportMs', result.dependencyImportMs],
    ['nativeColdInitializationMs', result.initializationMs],
    ['nativeColdParseMs', result.parseMs],
    ['nativeColdProjectionMs', result.projectionMs],
    ['nativeColdFirstResultMs', result.firstResultMs],
    ['nativeColdCpuMs', result.cpuMs],
  ]
  const samples: BenchmarkSample[] = fields.map(([field, value]) => ({
    family: 'cold-mount',
    fixture: input.workload.id,
    engine: 'remark',
    domain: 'native',
    build: 'source',
    trial: input.trial,
    revision: 1,
    field,
    sample: value,
    unit: 'ms',
    sourceBytes: input.workload.sourceBytes,
    outputMatches,
    cacheState: 'fresh-process; filesystem-cache-uncontrolled; raw-and-math-loaded',
    outputDigest: result.digest,
  }))
  return {
    samples,
    failures: outputMatches ? [] : [`${input.workload.id}: cold process output differs`],
  }
}
