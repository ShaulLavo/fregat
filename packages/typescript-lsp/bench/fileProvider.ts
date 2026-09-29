/*
 * E054 Step 4: how should the worker get a real project's files?
 *
 * Three strategies against one real project, each in a fresh Bun worker:
 *
 * - `preload`: the host sends every file the program reads, in one message. The bundle is recorded
 *   by building the same program on the host first, so this is preload's best case: a host that
 *   already knows exactly which files the program needs, which a host without a resolver does not.
 * - `pull-project`: the worker reads synchronously from the host, one blocking round trip per
 *   uncached question, with the whole project as roots (what tsserver loads).
 * - `pull-open`: the same, with only the open file as a root, so the program is that file's closure.
 *
 * Measured: time until the open file's first diagnostics (end to end, from the host's side),
 * the worker's heap after a full collection, and the first diagnostics after 50 files change
 * outside the editor.
 *
 *   bun bench/fileProvider.ts --project /work/projects/platform/apps/web \
 *     --config tsconfig.app.json --target src/features/git/components/change-file-row.tsx --latency-ms 0,1
 */

import { parseArgs } from 'node:util'
import { join, resolve } from 'node:path'
import ts from 'typescript'
import type { PreloadBundle } from './fileProviderWorker'

type Strategy = 'preload' | 'pull-project' | 'pull-open'

type Result = {
  readonly strategy: Strategy
  readonly latencyMs: number
  readonly endToEndMs: number
  readonly firstDiagnosticsMs: number
  readonly programFiles: number
  readonly hostCalls: number
  readonly bytesRead: number
  readonly heapBytes: number
  readonly burstMs: number
  readonly burstHostCalls: number
  readonly diagnostics: number
}

const BURST_SIZE = 50
const DATA_BYTES = 64 * 1024 * 1024

const { values } = parseArgs({
  options: {
    project: { type: 'string' },
    config: { type: 'string', default: 'tsconfig.json' },
    target: { type: 'string' },
    'latency-ms': { type: 'string', default: '0' },
    runs: { type: 'string', default: '1' },
    strategies: { type: 'string', default: 'preload,pull-project,pull-open' },
  },
})

const projectDirectory = resolve(values.project ?? process.cwd())
const configFile = join(projectDirectory, values.config ?? 'tsconfig.json')
const target = join(projectDirectory, values.target ?? '')
const latencies = (values['latency-ms'] ?? '0').split(',').map(Number)
const runs = Number(values.runs ?? '1')
const strategies = (values.strategies ?? '').split(',') as Strategy[]

const overlay = new Map<string, string>()
const results: Result[] = []

const bundle = strategies.includes('preload') ? recordPreloadBundle() : null
const burstFiles = pickBurstFiles(bundle?.roots ?? projectRoots())

for (let run = 0; run < runs; run += 1) {
  for (const strategy of strategies) {
    for (const latencyMs of strategy === 'preload' ? [0] : latencies) {
      overlay.clear()
      results.push(await measure(strategy, latencyMs))
    }
  }
}

console.log(JSON.stringify(results, null, 2))
console.log(table(results))

async function measure(strategy: Strategy, latencyMs: number): Promise<Result> {
  const worker = new Worker(new URL('./fileProviderWorker.ts', import.meta.url).href)
  const control = new SharedArrayBuffer(8)
  const data = new SharedArrayBuffer(DATA_BYTES)
  const state = new Int32Array(control)
  const bytes = new Uint8Array(data)
  const encoder = new TextEncoder()

  const answer = async (message: { op: string; path: string; extra?: unknown }) => {
    if (latencyMs > 0) await Bun.sleep(latencyMs)
    const encoded = encoder.encode(
      JSON.stringify(hostAnswer(message.op, message.path, message.extra)),
    )
    bytes.set(encoded)
    Atomics.store(state, 1, encoded.length)
    Atomics.store(state, 0, 1)
    Atomics.notify(state, 0)
  }

  const started = performance.now()
  const first = await new Promise<Record<string, number>>((resolveStart) => {
    worker.onmessage = (event) => {
      if (event.data.type === 'fs') void answer(event.data)
      if (event.data.type === 'started') resolveStart(event.data)
    }
    worker.postMessage({
      type: 'start',
      strategy,
      projectDirectory,
      configFile,
      target,
      control,
      data,
      ...(strategy === 'preload' ? { preload: bundle } : {}),
    })
  })
  const endToEndMs = performance.now() - started

  const edits = burstFiles.map((path) => {
    const text = `${ts.sys.readFile(path) ?? ''}\n// edited outside the editor\n`
    overlay.set(path, text)
    return strategy === 'preload' ? { path, text } : { path }
  })
  const burst = await new Promise<Record<string, number>>((resolveBurst) => {
    worker.onmessage = (event) => {
      if (event.data.type === 'fs') void answer(event.data)
      if (event.data.type === 'burst') resolveBurst(event.data)
    }
    worker.postMessage({ type: 'burst', edits })
  })
  worker.terminate()

  return {
    strategy,
    latencyMs,
    endToEndMs,
    firstDiagnosticsMs: first.firstDiagnosticsMs as number,
    programFiles: first.programFiles as number,
    hostCalls: first.hostCalls as number,
    bytesRead: first.bytesRead as number,
    heapBytes: first.heapBytes as number,
    burstMs: burst.requestMs as number,
    burstHostCalls: burst.hostCalls as number,
    diagnostics: first.diagnostics as number,
  }
}

function hostAnswer(op: string, path: string, extra: unknown): unknown {
  if (op === 'readFile') return overlay.get(path) ?? ts.sys.readFile(path) ?? null
  if (op === 'fileExists') return ts.sys.fileExists(path)
  if (op === 'directoryExists') return ts.sys.directoryExists(path)
  if (op === 'getDirectories') return ts.sys.getDirectories(path)
  if (op === 'realpath') return ts.sys.realpath?.(path) ?? path
  if (op === 'readDirectory') {
    const query = extra as {
      extensions?: string[]
      exclude?: string[]
      include?: string[]
      depth?: number
    }
    return ts.sys.readDirectory(path, query.extensions, query.exclude, query.include, query.depth)
  }
  throw new Error(`Unknown host operation ${op}`)
}

/** Builds the program once on the host with a recording system: exactly what preload must send. */
function recordPreloadBundle(): PreloadBundle {
  const files: Record<string, string> = {}
  const directories = new Set<string>()
  const realpaths: Record<string, string> = {}
  const recording: ts.LanguageServiceHost = {
    ...languageServiceHostOver(ts.sys),
    readFile: (path) => record(files, path, ts.sys.readFile(path)),
    getScriptSnapshot: (path) => {
      const text = record(files, path, ts.sys.readFile(path))
      return text === undefined ? undefined : ts.ScriptSnapshot.fromString(text)
    },
    fileExists: (path) => {
      const exists = ts.sys.fileExists(path)
      if (exists) record(files, path, ts.sys.readFile(path))
      return exists
    },
    directoryExists: (path) => {
      const exists = ts.sys.directoryExists(path)
      if (exists) directories.add(path)
      return exists
    },
    realpath: (path) => {
      const real = ts.sys.realpath?.(path) ?? path
      if (real !== path) realpaths[path] = real
      return real
    },
  }
  const service = ts.createLanguageService(recording)
  service.getSemanticDiagnostics(target)
  return {
    files,
    directories: [...directories],
    realpaths,
    roots: recording.getScriptFileNames(),
    options: recording.getCompilationSettings(),
  }
}

function record(
  files: Record<string, string>,
  path: string,
  text: string | undefined,
): string | undefined {
  if (text !== undefined) files[path] = text
  return text
}

function languageServiceHostOver(system: ts.System): ts.LanguageServiceHost {
  const project = parsedProject(system)
  return {
    getCompilationSettings: () => project.options,
    getScriptFileNames: () => project.fileNames,
    getScriptVersion: () => '0',
    getScriptSnapshot: (path) => {
      const text = system.readFile(path)
      return text === undefined ? undefined : ts.ScriptSnapshot.fromString(text)
    },
    getCurrentDirectory: () => projectDirectory,
    getDefaultLibFileName: (options) => ts.getDefaultLibFilePath(options),
    fileExists: system.fileExists,
    readFile: system.readFile,
    directoryExists: system.directoryExists,
    getDirectories: system.getDirectories,
    readDirectory: system.readDirectory,
    realpath: system.realpath,
    useCaseSensitiveFileNames: () => true,
  }
}

function parsedProject(system: ts.System): { fileNames: string[]; options: ts.CompilerOptions } {
  const json = ts.parseConfigFileTextToJson(configFile, system.readFile(configFile) ?? '{}').config
  const parsed = ts.parseJsonConfigFileContent(
    json,
    system,
    projectDirectory,
    undefined,
    configFile,
  )
  return { fileNames: parsed.fileNames, options: { ...parsed.options, noEmit: true } }
}

function projectRoots(): readonly string[] {
  return parsedProject(ts.sys).fileNames
}

function pickBurstFiles(roots: readonly string[]): readonly string[] {
  const candidates = roots.filter(
    (path) => path.startsWith(join(projectDirectory, 'src')) && path !== target,
  )
  const step = Math.max(1, Math.floor(candidates.length / BURST_SIZE))
  return candidates.filter((_, index) => index % step === 0).slice(0, BURST_SIZE)
}

function table(rows: readonly Result[]): string {
  const header =
    '| strategy | latency/call | first diagnostics (end to end) | program files | host calls | MB read | worker heap MB | after 50 external edits | calls after edits |'
  const rule = '| --- | --- | --- | --- | --- | --- | --- | --- | --- |'
  const lines = rows.map(
    (row) =>
      `| ${row.strategy} | ${row.latencyMs} ms | ${ms(row.endToEndMs)} | ${row.programFiles} | ${row.hostCalls} | ${mb(row.bytesRead)} | ${mb(row.heapBytes)} | ${ms(row.burstMs)} | ${row.burstHostCalls} |`,
  )
  return [header, rule, ...lines].join('\n')
}

function ms(value: number): string {
  return `${Math.round(value)} ms`
}

function mb(value: number): string {
  return (value / 1024 / 1024).toFixed(1)
}
