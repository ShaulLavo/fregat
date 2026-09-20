import { errorMessage } from '@workspace/contracts'
import { elapsedMs, roundMs } from '@workspace/utils/timing'
import path from 'node:path'

import type {
  WorkspaceSearchMatchMode,
  WorkspaceSearchMeasurement,
  WorkspaceSearchProviderSource,
} from '@workspace/contracts'

import type { createWorkspacePaths as createWorkspacePathsFunction } from '../src/fs/path'
import type {
  findInWorkspaceStream as findInWorkspaceStreamFunction,
  FindOptions,
  SearchProviderOptions,
} from '../src/fs/search'
import type { buildWorkspaceIndex as buildWorkspaceIndexFunction } from '../src/fs/workspace-index'

type BenchmarkConfig = {
  includeContent: boolean
  includeNames: boolean
  iterations: number
  limit: number
  matchMode: WorkspaceSearchMatchMode
  maxContentBytes: number
  path: string
  queries: string[]
  root: string
  useWorkspaceIndex: boolean
}

type BenchmarkRun = {
  count: number
  durationMs: number
  fileCount: number
  iteration: number
  measurement?: WorkspaceSearchMeasurement
  query: string
  truncated: boolean
  warningCodes: string[]
}

type BenchmarkSummary = {
  avgDurationMs: number
  avgFirstResultMs?: number
  avgStatCallCount: number
  avgStatDurationMs: number
  providerSources: WorkspaceSearchProviderSource[]
  query: string
  runs: number
}

type SearchModules = {
  buildWorkspaceIndex: typeof buildWorkspaceIndexFunction
  createWorkspacePaths: typeof createWorkspacePathsFunction
  findInWorkspaceStream: typeof findInWorkspaceStreamFunction
}

type BenchmarkContext = {
  modules: SearchModules
  paths: ReturnType<typeof createWorkspacePathsFunction>
  providerOptions: SearchProviderOptions
}

const defaultQueries = ['TODO', 'function', 'import']
const defaultConfig: BenchmarkConfig = {
  includeContent: true,
  includeNames: true,
  iterations: 3,
  limit: 50,
  matchMode: 'literal',
  maxContentBytes: 1_000_000,
  path: '',
  queries: defaultQueries,
  root: process.cwd(),
  useWorkspaceIndex: true,
}

let searchModulesPromise: Promise<SearchModules> | null = null

try {
  await main()
} catch (error) {
  console.error(errorMessage(error))
  process.exit(1)
}

async function main() {
  const config = benchmarkConfig(Bun.argv.slice(2))
  const context = await benchmarkContext(config)
  const runs: BenchmarkRun[] = []

  for (let iteration = 1; iteration <= config.iterations; iteration += 1) {
    for (const query of config.queries) {
      runs.push(await runBenchmarkQuery(config, context, query, iteration))
    }
  }

  console.log(
    JSON.stringify(
      {
        config: printableConfig(config),
        runs,
        summary: summarizeRuns(runs),
      },
      null,
      2,
    ),
  )
}

async function runBenchmarkQuery(
  config: BenchmarkConfig,
  context: BenchmarkContext,
  query: string,
  iteration: number,
): Promise<BenchmarkRun> {
  const options = benchmarkFindOptions(config, query)
  const startedAt = performance.now()
  let count = 0
  let measurement: WorkspaceSearchMeasurement | undefined
  let truncated = false
  let fileCount = 0
  const warningCodes: string[] = []

  for await (const event of context.modules.findInWorkspaceStream(
    context.paths,
    options,
    undefined,
    context.providerOptions,
  )) {
    if (event.type === 'match') {
      count += 1
      continue
    }

    if (event.type === 'warning') {
      warningCodes.push(event.code)
      continue
    }

    count = event.count
    fileCount = event.fileCount ?? 0
    measurement = event.measurement
    truncated = event.truncated
  }

  return {
    count,
    durationMs: elapsedMs(startedAt),
    fileCount,
    iteration,
    measurement,
    query,
    truncated,
    warningCodes,
  }
}

async function benchmarkContext(config: BenchmarkConfig): Promise<BenchmarkContext> {
  const modules = await searchModules()
  const paths = modules.createWorkspacePaths(config.root)
  if (!config.useWorkspaceIndex) return { modules, paths, providerOptions: {} }

  return {
    modules,
    paths,
    providerOptions: {
      workspaceIndex: await modules.buildWorkspaceIndex(paths, { reason: 'benchmark' }),
    },
  }
}

function searchModules() {
  if (!searchModulesPromise) searchModulesPromise = loadSearchModules()

  return searchModulesPromise
}

async function loadSearchModules(): Promise<SearchModules> {
  const [pathModule, searchModule, workspaceIndexModule] = await Promise.all([
    import('../src/fs/path'),
    import('../src/fs/search'),
    import('../src/fs/workspace-index'),
  ])

  return {
    buildWorkspaceIndex: workspaceIndexModule.buildWorkspaceIndex,
    createWorkspacePaths: pathModule.createWorkspacePaths,
    findInWorkspaceStream: searchModule.findInWorkspaceStream,
  }
}

function benchmarkFindOptions(config: BenchmarkConfig, query: string): FindOptions {
  return {
    caseSensitive: false,
    includeContent: config.includeContent,
    includeNames: config.includeNames,
    limit: config.limit,
    matchMode: config.matchMode,
    maxContentBytes: config.maxContentBytes,
    path: config.path,
    query,
    useWorkspaceIndex: config.useWorkspaceIndex,
    wholeWord: false,
  }
}

function benchmarkConfig(args: readonly string[]): BenchmarkConfig {
  const config: BenchmarkConfig = { ...defaultConfig, queries: [] }

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    if (!arg) continue
    if (arg === '--help') return helpConfig()
    if (arg === '--root') {
      config.root = path.resolve(valueAfter(args, index, arg))
      index += 1
      continue
    }
    if (arg === '--path') {
      config.path = valueAfter(args, index, arg)
      index += 1
      continue
    }
    if (arg === '--query') {
      config.queries.push(valueAfter(args, index, arg))
      index += 1
      continue
    }
    if (arg === '--iterations') {
      config.iterations = positiveInteger(valueAfter(args, index, arg), arg)
      index += 1
      continue
    }
    if (arg === '--limit') {
      config.limit = positiveInteger(valueAfter(args, index, arg), arg)
      index += 1
      continue
    }
    if (arg === '--max-content-bytes') {
      config.maxContentBytes = positiveInteger(valueAfter(args, index, arg), arg)
      index += 1
      continue
    }
    if (arg === '--disk-only') {
      config.useWorkspaceIndex = false
      continue
    }
    applyModeFlag(config, arg)
  }

  if (config.queries.length === 0) config.queries = defaultQueries
  return config
}

function applyModeFlag(config: BenchmarkConfig, arg: string) {
  if (arg === '--names-only') {
    config.includeContent = false
    config.includeNames = true
    return
  }

  if (arg === '--content-only') {
    config.includeContent = true
    config.includeNames = false
    return
  }

  if (arg === '--regex') {
    config.matchMode = 'regex'
    return
  }

  throw new Error(`Unknown option "${arg}". Use --help for usage.`)
}

function helpConfig(): BenchmarkConfig {
  console.log(`Usage: bun apps/server/scripts/workspace-search-benchmark.ts [options]

Options:
  --root <path>              Workspace root. Defaults to the current directory.
  --path <path>              Workspace-relative search root. Defaults to root.
  --query <text>             Query to run. Repeat for multiple queries.
  --iterations <count>       Runs per query. Defaults to 3.
  --limit <count>            Result limit. Defaults to 50.
  --max-content-bytes <n>    Per-file content limit. Defaults to 1000000.
  --names-only               Disable content search.
  --content-only             Disable name search.
  --regex                    Treat queries as regular expressions.
  --disk-only                Do not build or use the workspace index.
`)
  process.exit(0)
}

function valueAfter(args: readonly string[], index: number, flag: string) {
  const value = args[index + 1]
  if (value) return value

  throw new Error(`${flag} requires a value.`)
}

function positiveInteger(value: string, flag: string) {
  const parsed = Number(value)
  if (Number.isInteger(parsed) && parsed > 0) return parsed

  throw new Error(`${flag} must be a positive integer.`)
}

function printableConfig(config: BenchmarkConfig) {
  return {
    ...config,
    root: path.resolve(config.root),
  }
}

function summarizeRuns(runs: readonly BenchmarkRun[]): BenchmarkSummary[] {
  const byQuery = new Map<string, BenchmarkRun[]>()

  for (const run of runs) {
    const queryRuns = byQuery.get(run.query) ?? []
    queryRuns.push(run)
    byQuery.set(run.query, queryRuns)
  }

  return Array.from(byQuery, ([query, queryRuns]) => summarizeQueryRuns(query, queryRuns))
}

function summarizeQueryRuns(query: string, runs: readonly BenchmarkRun[]): BenchmarkSummary {
  const firstResultSamples = runs.flatMap((run) => optionalSample(run.measurement?.firstResultMs))
  const providerSources = uniqueProviderSources(runs)

  return {
    avgDurationMs: average(runs.map((run) => run.durationMs)),
    avgFirstResultMs: optionalAverage(firstResultSamples),
    avgStatCallCount: average(runs.map((run) => run.measurement?.statCallCount ?? 0)),
    avgStatDurationMs: average(runs.map((run) => run.measurement?.statDurationMs ?? 0)),
    providerSources,
    query,
    runs: runs.length,
  }
}

function uniqueProviderSources(runs: readonly BenchmarkRun[]) {
  const sources = new Set<WorkspaceSearchProviderSource>()

  for (const run of runs) {
    for (const source of run.measurement?.providerSources ?? []) {
      sources.add(source)
    }
  }

  return Array.from(sources).sort()
}

function optionalSample(value: number | undefined) {
  if (value === undefined) return []

  return [value]
}

function optionalAverage(values: readonly number[]) {
  if (values.length === 0) return undefined

  return average(values)
}

function average(values: readonly number[]) {
  if (values.length === 0) return 0

  const total = values.reduce((sum, value) => sum + value, 0)
  return roundMs(total / values.length)
}
