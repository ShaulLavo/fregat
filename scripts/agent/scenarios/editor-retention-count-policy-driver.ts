import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { appendFile, mkdir, readFile, readdir, realpath, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { createServer } from 'node:net'
import { resolve, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  inactiveBound,
  parseRetentionFixtures,
  RETENTION_COUNT_PROTOCOL,
} from '../../../apps/web/test/factories/retention-count-policy-protocol'

const argumentsByName = new Map<string, string>()
const args = process.argv.slice(2)
for (let index = 0; index < args.length; index += 2) {
  const name = args[index]
  const value = args[index + 1]
  if (!name?.startsWith('--') || value === undefined || argumentsByName.has(name))
    throw new TypeError('Expected unique --name value argument pairs')
  argumentsByName.set(name, value)
}
const allowed = new Set([
  '--repo',
  '--port',
  '--file-port',
  '--cycles',
  '--fixtures',
  '--output',
  '--validate-only',
])
for (const name of argumentsByName.keys())
  if (!allowed.has(name)) throw new TypeError(`Unknown argument ${name}`)
function required(name: string) {
  const value = argumentsByName.get(name)
  if (!value) throw new TypeError(`Required argument ${name}`)
  return value
}
function integer(name: string, maximum: number) {
  const value = Number(required(name))
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum)
    throw new TypeError(`Argument ${name} must be an integer between 1 and ${maximum}`)
  return value
}
const repo = resolve(required('--repo'))
const output = resolve(required('--output'))
const cycles = integer('--cycles', 40)
const port = integer('--port', 65535)
const filePort = integer('--file-port', 65535)
if (port === filePort) throw new TypeError('Browser and fixture ports must differ')
const fixtureFile = resolve(required('--fixtures'))
const fixtureText = await readFile(fixtureFile, 'utf8')
const fixtures = parseRetentionFixtures(JSON.parse(fixtureText))
const sourceHead = await git(['rev-parse', 'HEAD'])
const dirty = await git(['status', '--porcelain'])
await mkdir(output, { recursive: true })
if ((await readdir(output)).length > 0)
  throw new TypeError('The output directory must be empty to preserve prior evidence')
const driverFile = fileURLToPath(import.meta.url)
const provenanceFiles = [
  driverFile,
  join(repo, 'apps/web/test/factories/retention-count-policy-protocol.ts'),
  join(repo, 'apps/web/test/factories/retention-count-policy.ts'),
  join(repo, 'apps/web/src/features/editor/tests/retention-count-policy.browser.tsx'),
  join(repo, 'apps/web/vitest.browser.config.ts'),
  join(repo, 'apps/web/src/state/application-runtime.ts'),
  join(repo, 'apps/web/src/features/editor/state/workspace-document-service.ts'),
  join(repo, 'apps/web/src/features/editor/state/document-state.tsx'),
  join(repo, 'apps/web/src/lib/file-open-intent/state/service.ts'),
  join(repo, 'apps/web/src/features/editor/state/inactive-analysis-retention.ts'),
  join(repo, 'apps/web/src/features/editor/state/inactive-analysis-policy.ts'),
  join(repo, 'editor/packages/editor/src/editor/documentAnalysis.ts'),
  join(repo, 'editor/packages/tree-sitter/src/treeSitter/workerClient.ts'),
  join(repo, 'editor/packages/tree-sitter/src/treeSitter/treeSitter.worker.ts'),
  join(repo, 'editor/packages/tree-sitter/src/treeSitter/types.ts'),
  join(repo, 'editor/packages/editor/src/shiki/workerClient.ts'),
  join(repo, 'editor/packages/editor/src/shiki/shiki.worker.ts'),
  join(repo, 'editor/packages/editor/src/shiki/workerTypes.ts'),
  join(repo, 'editor/packages/editor/src/syntax/tokenStore.ts'),
]
const sourceFiles = []
for (const file of provenanceFiles) {
  const text = await readFile(file, 'utf8')
  sourceFiles.push({ file, sha256: hash(text), text })
}
const oracleControls = { knownGood: inactiveBound(2, 2), growthNegative: inactiveBound(3, 2) }
if (!oracleControls.knownGood.passes || oracleControls.growthNegative.passes)
  throw new TypeError('Count oracle calibration failed')
const run = { sourceHead, cycles, fixtures, protocol: RETENTION_COUNT_PROTOCOL }
await writeFile(join(output, 'fixtures.json'), fixtureText)
await writeFile(join(output, 'sources.json'), JSON.stringify(sourceFiles, null, 2))
await writeFile(
  join(output, 'manifest.json'),
  JSON.stringify(
    {
      ...run,
      dirty,
      port,
      filePort,
      fixtureSha256: hash(fixtureText),
      driverSha256: hash(await readFile(driverFile, 'utf8')),
      caseCount: fixtures.length,
      completeCycleTarget: cycles * fixtures.length,
      acceptance: 'headless-resource-diagnostic',
      sourceQualification: 'unqualified-requires-independent-current-head-review-and-CI',
      oracleControls,
      startedAt: new Date().toISOString(),
      runtime: process.version,
      platform: process.platform,
    },
    null,
    2,
  ),
)
if (argumentsByName.get('--validate-only') === 'true') {
  await writeFile(
    join(output, 'result.json'),
    JSON.stringify({ outcome: 'manifest-and-oracle-validated', oracleControls }, null, 2),
  )
  process.exit(0)
}
await assertFree(port)
await assertFree(filePort)
const samplePath = join(output, 'samples.jsonl')
await writeFile(samplePath, '')
const configPath = join(output, 'retention.vitest.config.mts')
const packageAliases = await editorSourceAliases()
const dependencyRoot = await realpath(join(repo, 'node_modules/.bun'))
await writeFile(
  configPath,
  `import base from ${JSON.stringify(join(repo, 'apps/web/vitest.browser.config.ts'))}
import { appendFile } from 'node:fs/promises'
const run = ${JSON.stringify(run)}
export default {
  ...base,
  root: ${JSON.stringify(join(repo, 'apps/web'))},
  optimizeDeps: { ...base.optimizeDeps, include: [...base.optimizeDeps.include,
    '@singapore-editor/core > @shikijs/engine-oniguruma',
    '@singapore-editor/core > @shikijs/engine-oniguruma/wasm-inlined', 'shiki/core',
    '@singapore-editor/tree-sitter > tree-sitter-md', '@singapore-editor/tree-sitter > web-tree-sitter'] },
  server: { ...base.server, fs: { ...base.server.fs, allow: [...base.server.fs.allow, ${JSON.stringify(dependencyRoot)}] } },
  resolve: { ...base.resolve, alias: [
    ...Object.entries(${JSON.stringify(packageAliases)}).map(([find, replacement]) => ({ find: new RegExp('^' + find + '$'), replacement })),
    { find: /^@singapore-editor\\/textbuffer\\/internal\\/(.+)$/, replacement: ${JSON.stringify(join(repo, 'editor/packages/textbuffer/src/$1.ts'))} },
    ...Object.entries(base.resolve.alias).map(([find, replacement]) => ({ find, replacement })),
  ] },
  test: {
    ...base.test,
    include: ['src/features/editor/tests/retention-count-policy.browser.tsx'],
    browser: {
      ...base.test.browser,
      commands: {
        ...base.test.browser.commands,
        retentionManifest: () => run,
        retentionSample: async (_context, sample) => {
          await appendFile(${JSON.stringify(samplePath)}, JSON.stringify(sample) + '\\n')
        },
        retentionScreenshot: async (context, label) => {
          await context.page.screenshot({ path: ${JSON.stringify(output)} + '/' + label + '.png', fullPage: true })
          const frame = await context.frame()
          for (const name of ['b', 'a-first', 'a-second']) {
            await frame.locator('[data-retention-view="' + name + '"]').screenshot({
              path: ${JSON.stringify(output)} + '/' + label + '-' + name + '.png',
            })
          }
        },
      },
    },
  },
}
`,
)
const command = ['--bun', 'vitest', 'run', '--config', configPath]
const logPath = join(output, 'vitest.log')
await writeFile(logPath, '')
const child = spawn('bun', command, {
  cwd: join(repo, 'apps/web'),
  env: {
    ...process.env,
    VITEST_BROWSER_PORT: String(port),
    VITEST_BROWSER_FILE_SERVER_PORT: String(filePort),
  },
  stdio: ['ignore', 'pipe', 'pipe'],
})
const writes: Promise<void>[] = []
child.stdout.on('data', (data: Buffer) => {
  process.stdout.write(data)
  writes.push(appendFile(logPath, data))
})
child.stderr.on('data', (data: Buffer) => {
  process.stderr.write(data)
  writes.push(appendFile(logPath, data))
})
const stop = () => child.kill('SIGTERM')
process.once('SIGINT', stop)
process.once('SIGTERM', stop)
const exitCode = await new Promise<number>((resolveExit, reject) => {
  child.once('error', reject)
  child.once('exit', (code) => resolveExit(code ?? 1))
})
process.removeListener('SIGINT', stop)
process.removeListener('SIGTERM', stop)
await Promise.all(writes)
const samples: unknown[] = (await readFile(samplePath, 'utf8'))
  .split('\n')
  .filter(Boolean)
  .map((line) => JSON.parse(line))
const endpoints = samples.filter((sample) =>
  hasValue(sample, 'kind', RETENTION_COUNT_PROTOCOL.successfulCycleMarker),
)
const keys = new Set(endpoints.map(endpointKey))
const failures = samples.filter((sample) => hasValue(sample, 'kind', 'failure'))
const outcome =
  exitCode === 0 &&
  endpoints.length === cycles * fixtures.length &&
  keys.size === endpoints.length &&
  !keys.has(null) &&
  failures.length === 0
    ? 'headless-count-controls-complete'
    : 'incomplete-or-failed'
await writeFile(
  join(output, 'result.json'),
  JSON.stringify(
    {
      outcome,
      exitCode,
      sampleCount: samples.length,
      completeCycles: endpoints.length,
      expectedCycles: cycles * fixtures.length,
      failures,
      acceptance: 'hardware-and-full-required-matrix-unqualified',
      sourceQualification: 'unqualified-requires-independent-current-head-review-and-CI',
      finishedAt: new Date().toISOString(),
    },
    null,
    2,
  ),
)
process.exit(exitCode === 0 && outcome === 'headless-count-controls-complete' ? 0 : 1)

function hash(text: string) {
  return createHash('sha256').update(text).digest('hex')
}
async function git(args: readonly string[]) {
  const child = spawn('git', args, { cwd: repo, stdio: ['ignore', 'pipe', 'pipe'] })
  let text = ''
  child.stdout.on('data', (data: Buffer) => {
    text += data.toString()
  })
  const code = await new Promise<number | null>((resolveExit, reject) => {
    child.once('error', reject)
    child.once('exit', resolveExit)
  })
  if (code !== 0) throw new TypeError(`Git command failed with code ${code}`)
  return text.trim()
}
async function assertFree(port: number) {
  const server = createServer()
  await new Promise<void>((resolveReady, reject) => {
    server.once('error', reject)
    server.listen(port, '127.0.0.1', resolveReady)
  })
  await new Promise<void>((resolveClose, reject) =>
    server.close((error) => (error ? reject(error) : resolveClose())),
  )
}

function hasValue(sample: unknown, key: string, value: string) {
  return (
    typeof sample === 'object' &&
    sample !== null &&
    key in sample &&
    Reflect.get(sample, key) === value
  )
}

function endpointKey(sample: unknown) {
  if (
    typeof sample !== 'object' ||
    sample === null ||
    !('fixture' in sample) ||
    !('cycle' in sample)
  )
    return null
  if (typeof sample.fixture !== 'string' || typeof sample.cycle !== 'number') return null
  if (!fixtures.some((fixture) => fixture.id === sample.fixture)) return null
  if (!Number.isInteger(sample.cycle) || sample.cycle < 1 || sample.cycle > cycles) return null
  return `${sample.fixture}:${sample.cycle}`
}

async function editorSourceAliases() {
  const aliases: Record<string, string> = {}
  const root = join(repo, 'editor/packages')
  for (const directory of await readdir(root)) {
    const file = join(root, directory, 'package.json')
    if (!existsSync(file)) continue
    const manifest: unknown = JSON.parse(await readFile(file, 'utf8'))
    addPackageAliases(aliases, join(root, directory), manifest)
  }
  return aliases
}

function addPackageAliases(aliases: Record<string, string>, root: string, manifest: unknown) {
  if (
    typeof manifest !== 'object' ||
    manifest === null ||
    !('name' in manifest) ||
    !('exports' in manifest)
  )
    return
  if (
    typeof manifest.name !== 'string' ||
    typeof manifest.exports !== 'object' ||
    manifest.exports === null
  )
    return
  for (const [key, value] of Object.entries(manifest.exports)) {
    const target = exportTarget(value)
    if (!target?.startsWith('./dist/')) continue
    const source = join(root, target.replace('./dist/', './src/').replace(/\.js$/, '.ts'))
    if (!existsSync(source)) continue
    aliases[key === '.' ? manifest.name : manifest.name + key.slice(1)] = source
  }
}

function exportTarget(value: unknown): string | null {
  if (typeof value === 'string') return value
  if (typeof value !== 'object' || value === null) return null
  if ('import' in value && typeof value.import === 'string') return value.import
  if ('default' in value && typeof value.default === 'string') return value.default
  return null
}
