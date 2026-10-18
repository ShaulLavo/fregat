import { hash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'

import { MARKDOWN_CASES } from '../../packages/markdown/test/fixtures/cases'
import { observeHast, readyRemarkExtensions } from '../../packages/markdown/test/qualification'
import { seededChunks } from '../../packages/markdown/test/schedules'
import {
  blockToHast,
  createHastProcessor,
  type HastExtensions,
} from '../../packages/markdown/src/utils/hast'
import {
  createMarkdownSession,
  type MarkdownSession,
  type MarkdownSessionFactory,
} from '../../packages/markdown/src/utils/session'
import {
  createTreeSitterMarkdownSession,
  initializeTreeSitterMarkdown,
} from '../../packages/markdown/src/utils/tree-sitter-session'
import type { MarkdownBlock } from '../../packages/markdown/src/utils/blocks'
import { qualificationProvenance } from './provenance'
import { createScriptError } from '../structured-errors'

type Engine = 'remark' | 'tree-sitter'
type Root = ReturnType<typeof blockToHast>
type ResourceSource = { readonly id: string; readonly source: string; readonly sha256: string }
type MemoryReading = {
  readonly heapUsedBytes: number
  readonly rssBytes: number
  readonly wasmReservedBytes: number
  readonly gcPerformed: boolean
}
export type ResourceWindow = {
  readonly engine: Engine
  readonly cycles: number
  readonly window: number
  readonly before: MemoryReading
  readonly after: MemoryReading
  readonly outputFailures: readonly string[]
  readonly cleanupFailures: readonly string[]
  readonly clearedSessions: number
  readonly clearedProjectionEntries: number
}

function digest(roots: readonly Root[]): string {
  const root: Root = { type: 'root', children: roots.flatMap((entry) => entry.children) }
  return hash('sha256', JSON.stringify(observeHast(root)), 'hex')
}

export function resourceSession(input: {
  readonly factory: MarkdownSessionFactory
  readonly extensions: HastExtensions
  readonly project?: typeof blockToHast
}) {
  let session: MarkdownSession | null = input.factory()
  const processor = createHastProcessor(input.extensions)
  const projections = new Map<MarkdownBlock, Root>()
  let roots: readonly Root[] = []
  const project = input.project ?? blockToHast
  return {
    update(text: string, live: boolean): string {
      if (!session)
        throw createScriptError('The resource-probe session has been released.', {
          internal: { boundary: 'native-resource-session' },
        })
      roots = session.update(text, { heal: live }).map((block) => {
        const cached = projections.get(block)
        if (cached) return cached
        const converted = project(block, processor)
        projections.set(block, converted)
        return converted
      })
      return digest(roots)
    },
    release() {
      const entries = projections.size
      try {
        const cleared = session?.update('', { heal: false })
        return { cleared: cleared === undefined || cleared.length === 0, entries }
      } finally {
        projections.clear()
        roots = []
        session = null
      }
    },
    retainedProjectionEntries: () => projections.size,
  }
}

function cycle(input: {
  readonly engine: Engine
  readonly source: ResourceSource
  readonly expectedDigest: string
  readonly extensions: HastExtensions
}) {
  const context = resourceSession({
    factory: input.engine === 'remark' ? createMarkdownSession : createTreeSitterMarkdownSession,
    extensions: input.extensions,
  })
  let matches = false
  let error: string | null = null
  let cleanup = { cleared: false, entries: 0 }
  try {
    for (const frame of seededChunks(input.source.source, { seed: 176, maxUnits: 24 }))
      context.update(frame.text, true)
    matches = context.update(input.source.source, false) === input.expectedDigest
  } catch {
    error = 'The native session or safe projection failed.'
  } finally {
    try {
      cleanup = context.release()
    } catch {
      error = 'The native session could not clear its retained source.'
    }
  }
  return { matches, error, cleanup, retained: context.retainedProjectionEntries() }
}

function collectGarbage(): boolean {
  if (typeof Bun !== 'undefined') {
    Bun.gc(true)
    return true
  }
  if (typeof globalThis.gc !== 'function') return false
  globalThis.gc()
  return true
}

function memory(readWasm: () => number): MemoryReading {
  const gcPerformed = collectGarbage()
  const reading = process.memoryUsage()
  return {
    heapUsedBytes: reading.heapUsed,
    rssBytes: reading.rss,
    wasmReservedBytes: readWasm(),
    gcPerformed,
  }
}

export function summarizeResourceWindows(rows: readonly ResourceWindow[]) {
  const groups = new Map<string, ResourceWindow[]>()
  for (const row of rows) {
    const key = `${row.engine}/${row.cycles}`
    const group = groups.get(key) ?? []
    group.push(row)
    groups.set(key, group)
  }
  return Array.from(groups.values(), (group) => {
    group.sort((a, b) => a.window - b.window)
    const first = group[0]
    const tail = group.slice(1)
    const after = group.map((row) => row.after)
    const heaps = after.map((row) => row.heapUsedBytes)
    const reserved = after.map((row) => row.wasmReservedBytes)
    const delta = (field: keyof Omit<MemoryReading, 'gcPerformed'>) =>
      tail.map((row, index) => row.after[field] - (group[index]?.after[field] ?? row.after[field]))
    const failed = group.some(
      (row) => row.outputFailures.length > 0 || row.cleanupFailures.length > 0,
    )
    return {
      engine: first?.engine,
      cycles: first?.cycles,
      windows: group.length,
      status: failed ? 'FAILED' : 'INCONCLUSIVE',
      gcStatus: after.every((row) => row.gcPerformed) ? 'POST_GC' : 'NOT_MEASURED',
      heapAfterReleaseBytes: heaps,
      rssAfterReleaseBytes: after.map((row) => row.rssBytes),
      wasmReservedBytes: reserved,
      heapWindowDeltasBytes: delta('heapUsedBytes'),
      rssWindowDeltasBytes: delta('rssBytes'),
      wasmWindowDeltasBytes: delta('wasmReservedBytes'),
      heapObservedRangeBytes: Math.max(...heaps) - Math.min(...heaps),
      wasmHighWaterReuseObserved:
        group.length >= 3 &&
        reserved.every((bytes) => bytes > 0) &&
        delta('wasmReservedBytes')
          .slice(-2)
          .every((bytes) => bytes === 0),
      reason: failed
        ? 'At least one source projection or cleanup check failed.'
        : 'Raw process-wide readings quantify reuse and growth; native samples do not prove browser retained-object or memory budgets.',
    }
  })
}

async function runWindow(input: {
  readonly engine: Engine
  readonly cycles: number
  readonly window: number
  readonly sources: readonly ResourceSource[]
  readonly expected: ReadonlyMap<string, string>
  readonly extensions: HastExtensions
  readonly readWasm: () => number
}): Promise<ResourceWindow> {
  const before = memory(input.readWasm)
  const outputFailures: string[] = []
  const cleanupFailures: string[] = []
  let clearedSessions = 0
  let clearedProjectionEntries = 0
  for (let index = 0; index < input.cycles; index++) {
    const source = input.sources[index % input.sources.length]
    if (!source)
      throw createScriptError('The native probe needs a source.', { internal: { sourceCount: 0 } })
    const result = cycle({ ...input, source, expectedDigest: input.expected.get(source.id) ?? '' })
    if (!result.matches || result.error) outputFailures.push(source.id)
    if (!result.cleanup.cleared || result.retained !== 0) cleanupFailures.push(source.id)
    if (result.cleanup.cleared) clearedSessions++
    clearedProjectionEntries += result.cleanup.entries
  }
  await new Promise<void>((resolve) => setTimeout(resolve, 0))
  return {
    engine: input.engine,
    cycles: input.cycles,
    window: input.window,
    before,
    after: memory(input.readWasm),
    outputFailures,
    cleanupFailures,
    clearedSessions,
    clearedProjectionEntries,
  }
}

async function candidateIdentity(root: string) {
  const require = createRequire(path.join(root, 'packages/markdown/package.json'))
  const packageFile = require.resolve('tree-sitter-md/package.json')
  const metadata: unknown = JSON.parse(await readFile(packageFile, 'utf8'))
  if (
    !metadata ||
    typeof metadata !== 'object' ||
    !('version' in metadata) ||
    typeof metadata.version !== 'string'
  )
    throw createScriptError('The candidate package needs a version.', {
      internal: { boundary: 'candidate-package' },
    })
  const entry = require.resolve('tree-sitter-md')
  const module = await import(pathToFileURL(entry).href)
  const assets = await Promise.all(
    ['tree-sitter-md.wasm', 'tree-sitter-markdown.wasm'].map(async (asset) => ({
      asset,
      sha256: hash('sha256', await readFile(require.resolve(`tree-sitter-md/${asset}`)), 'hex'),
    })),
  )
  if (typeof module.memoryBytes !== 'function')
    throw createScriptError('The candidate must expose native memory accounting.', {
      internal: { boundary: 'candidate-memory-export' },
    })
  return {
    identity: {
      version: metadata.version,
      javascriptSha256: hash('sha256', await readFile(entry), 'hex'),
      assets,
    },
    readWasm: (): number => {
      const bytes: unknown = module.memoryBytes()
      if (typeof bytes !== 'number' || !Number.isSafeInteger(bytes) || bytes <= 0)
        throw createScriptError('The initialized candidate needs a positive WASM byte count.', {
          internal: { boundary: 'candidate-memory-bytes' },
        })
      return bytes
    },
  }
}

async function measureScale(input: {
  readonly cycles: number
  readonly windows: number
  readonly sources: readonly ResourceSource[]
  readonly expected: ReadonlyMap<string, string>
  readonly extensions: HastExtensions
  readonly readWasm: () => number
}) {
  const rows: ResourceWindow[] = []
  for (let window = 0; window < input.windows; window++) {
    const engines: readonly Engine[] =
      window % 2 ? ['tree-sitter', 'remark'] : ['remark', 'tree-sitter']
    for (const engine of engines) rows.push(await runWindow({ ...input, engine, window }))
  }
  return rows
}

async function runNativeResourceProbe(root: string, windows = 4) {
  const provenance = await qualificationProvenance(root)
  const candidate = await candidateIdentity(root)
  await initializeTreeSitterMarkdown()
  const extensions = await readyRemarkExtensions()
  const sources = MARKDOWN_CASES.map(({ id, source }) => ({
    id,
    source,
    sha256: hash('sha256', source, 'hex'),
  }))
  const expected = new Map<string, string>()
  for (const source of sources) {
    const context = resourceSession({ factory: createMarkdownSession, extensions })
    try {
      expected.set(source.id, context.update(source.source, false))
    } finally {
      context.release()
    }
  }
  let rows: ResourceWindow[] = []
  for (const cycles of [20, 100, 500])
    rows = rows.concat(
      await measureScale({
        cycles,
        windows,
        sources,
        expected,
        extensions,
        readWasm: candidate.readWasm,
      }),
    )
  const summaries = summarizeResourceWindows(rows)
  return {
    schemaVersion: 1,
    verdict: 'NOT VERIFIED',
    nativeStatus: summaries.some((summary) => summary.status === 'FAILED')
      ? 'FAILED'
      : 'INCONCLUSIVE',
    provenance,
    candidate: candidate.identity,
    sources: sources.map(({ id, source, sha256 }) => ({
      id,
      sha256,
      sourceBytes: Buffer.byteLength(source),
    })),
    measurementBoundary:
      'One realm initializes the parser and HTML/math stages once. Both engines use actual sessions and safe HAST transforms. Every cycle streams, settles, clears its session and releases projection roots/cache. Candidate parse handles dispose inside the production adapter. WASM reserved bytes describe the shared runtime, including during remark windows. RSS and JS heap are process-wide. Raw GC readings retain no DOM or browser claims.',
    rawWindows: rows,
    summaries,
    browser: {
      status: 'NOT_MEASURED',
      fields: [
        'browser-live-heap',
        'retained-DOM-nodes',
        'retained-workers',
        'retained-subscriptions',
        'actual-timeline-unmount',
      ],
      reason:
        'This is a native session probe. Browser lifecycle/resource qualification runs separately.',
    },
    cleanup: {
      created: ['finite native process, session and projection objects'],
      stopped: ['all cycle consumers before session reset/cache release'],
      retained: [
        'shared initialized WASM runtime until this finite process exits',
        'requested report and raw samples',
      ],
      ownerDataAccessed: false,
    },
  }
}

async function main() {
  const { values } = parseArgs({
    options: { out: { type: 'string' }, windows: { type: 'string', default: '4' } },
  })
  const windows = Number(values.windows)
  if (!values.out || !Number.isSafeInteger(windows) || windows < 3 || windows > 8)
    throw createScriptError('Choose --out DIRECTORY and 3–8 repeated windows.', {
      internal: { boundary: 'native-resource-arguments' },
    })
  const root = path.resolve(import.meta.dirname, '../..')
  const report = await runNativeResourceProbe(root, windows)
  await mkdir(values.out, { recursive: true })
  await writeFile(
    path.join(values.out, 'native-resources.json'),
    JSON.stringify(report, null, 2) + '\n',
  )
  await writeFile(
    path.join(values.out, 'native-resources.jsonl'),
    report.rawWindows.map((row) => JSON.stringify(row)).join('\n') + '\n',
  )
  process.stdout.write(
    JSON.stringify({
      nativeStatus: report.nativeStatus,
      summaries: report.summaries,
      output: values.out,
    }) + '\n',
  )
  process.exitCode = report.nativeStatus === 'FAILED' ? 1 : 0
}

if (import.meta.main) await main()
