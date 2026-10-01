import { existsSync } from 'node:fs'
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { parseArgs } from 'node:util'
import { checkoutRoot } from '../agent/paths'
import { releaseFixture } from '../agent/fixture-workspace'
import { createScriptError } from '../structured-errors'
import { runCase, type Highlighting } from './run'
import { comparisonReport } from './report'
import { caseScopeCommand } from './case-scope'
import { captureRevision, recordedBuildSource } from './provenance'

const { values } = parseArgs({
  options: {
    sizes: { type: 'string', default: '1,10,50,100,150,200' },
    ext: { type: 'string', default: 'txt' },
    highlighting: { type: 'string', default: 'default' },
    out: { type: 'string' },
    'web-root': { type: 'string' },
    'two-byte': { type: 'boolean', default: false },
    profile: { type: 'boolean', default: false },
    keys: { type: 'string', default: '30' },
    'settle-ms': { type: 'string', default: '10000' },
    'memory-mib': { type: 'string', default: '8192' },
    case: { type: 'string' },
    help: { type: 'boolean' },
  },
})

if (values.help) {
  console.log(
    'bun run bench:large-file [--sizes 1,10,50,100,150,200] [--ext txt|ts] [--highlighting shiki,tree-sitter] [--two-byte] [--profile] [--out DIR] [--web-root BUILT_WEB] [--keys 30] [--settle-ms 10000] [--memory-mib 8192]',
  )
  process.exit(0)
}
if (values.ext !== 'txt' && values.ext !== 'ts') throw createScriptError('--ext must be txt or ts')
const highlightingModes = values.highlighting.split(',').map(highlightingMode)
const keys = positiveInteger(values.keys, '--keys')
const settleMs = positiveInteger(values['settle-ms'], '--settle-ms')
const memoryMiB = positiveInteger(values['memory-mib'], '--memory-mib')
const sizes = values.sizes.split(',').map((size) => positiveInteger(size, '--sizes'))
const output = path.resolve(
  values.out ??
    `/work/tmp/fregat-evidence/${new Date().toISOString().replaceAll(/[-:.]/g, '')}-large-files`,
)
await mkdir(output, { recursive: true })
if (!process.env.PLAYWRIGHT_BROWSERS_PATH && existsSync('/work/cache/ms-playwright'))
  process.env.PLAYWRIGHT_BROWSERS_PATH = '/work/cache/ms-playwright'
const webRoot = path.resolve(values['web-root'] ?? path.join(output, 'web'))

if (values.case) {
  const result = await runCase({
    sizeMiB: positiveInteger(values.case, '--case'),
    extension: values.ext,
    highlighting: highlightingModes[0]!,
    twoByte: values['two-byte'],
    keys,
    settleMs,
    profile: values.profile,
    output,
    webRoot,
  })
  await writeFile(path.join(output, 'result.json'), JSON.stringify(result, null, 2))
  console.log(JSON.stringify(result))
  process.exit(result.status === 'passed' ? 0 : 1)
}

const beforeBuild = await sourceRevisions('before')
if (!values['web-root']) await buildWeb()
if (!existsSync(path.join(webRoot, 'index.html')))
  throw createScriptError(`No production web build at ${webRoot}`)
const revisions = await sourceRevisions('after')
const buildSourceFile = path.join(webRoot, 'benchmark-source.json')
if (!values['web-root'])
  await writeFile(
    buildSourceFile,
    JSON.stringify(
      {
        schemaVersion: 2,
        buildSourceState:
          beforeBuild.platform.fingerprint === revisions.platform.fingerprint &&
          beforeBuild.editor.fingerprint === revisions.editor.fingerprint
            ? 'stable'
            : 'changed-during-build',
        beforeBuild,
        afterBuild: revisions,
      },
      null,
      2,
    ),
  )
const builtWebSource = existsSync(buildSourceFile)
  ? recordedBuildSource(JSON.parse(await readFile(buildSourceFile, 'utf8')))
  : { cleanliness: 'unknown', reason: 'Reused build predates benchmark provenance metadata.' }
await writeFile(
  path.join(output, 'source.json'),
  JSON.stringify({ ...revisions, builtWebSource }, null, 2),
)
let failures = 0
const results: unknown[] = []
const cases = sizes.flatMap((size) =>
  highlightingModes.map((highlighting) => ({ size, highlighting })),
)
for (const { size, highlighting } of cases) {
  const caseOutput = path.join(
    output,
    `${values.ext}-${size}${values['two-byte'] ? '-unicode' : ''}${highlighting === 'default' ? '' : `-${highlighting}`}`,
  )
  await mkdir(caseOutput)
  const args = [
    process.execPath,
    import.meta.path,
    '--case',
    String(size),
    '--out',
    caseOutput,
    '--ext',
    values.ext,
    '--highlighting',
    highlighting,
    '--keys',
    String(keys),
    '--settle-ms',
    String(settleMs),
    '--web-root',
    webRoot,
  ]
  if (values['two-byte']) args.push('--two-byte')
  if (values.profile) args.push('--profile')
  const unit = `platform-large-file-${process.pid}-${size}-${highlighting}.scope`
  const cmd = caseScopeCommand({
    unit,
    memoryMiB,
    command: args,
    slice: process.env.HEAVY_JOB_SLICE || undefined,
  })
  const child = Bun.spawn(cmd, {
    cwd: checkoutRoot,
    env: { ...process.env, TMPDIR: caseOutput },
    stdout: Bun.file(path.join(caseOutput, 'stdout.log')),
    stderr: Bun.file(path.join(caseOutput, 'stderr.log')),
  })
  const timeout = setTimeout(() => {
    if (process.platform === 'linux') Bun.spawnSync(['systemctl', '--user', 'stop', unit])
    else child.kill('SIGTERM')
  }, 360_000)
  const exitCode = await child.exited
  clearTimeout(timeout)
  if (process.platform === 'linux') {
    const state = Bun.spawnSync([
      'systemctl',
      '--user',
      'show',
      unit,
      '-p',
      'Result',
      '-p',
      'MemoryPeak',
    ])
    await writeFile(path.join(caseOutput, 'scope.txt'), state.stdout)
    Bun.spawnSync(['systemctl', '--user', 'stop', unit], { stdout: 'ignore', stderr: 'ignore' })
    Bun.spawnSync(['systemctl', '--user', 'reset-failed', unit], {
      stdout: 'ignore',
      stderr: 'ignore',
    })
  }
  if (exitCode !== 0) failures += 1
  if (existsSync(path.join(caseOutput, 'fixture')))
    await releaseFixture(path.join(caseOutput, 'fixture'))
  const resultFile = path.join(caseOutput, 'result.json')
  const result: unknown = existsSync(resultFile)
    ? JSON.parse(await readFile(resultFile, 'utf8'))
    : { status: 'failed', sizeMiB: size, highlighting, exitCode, output: caseOutput }
  await appendFile(path.join(output, 'results.jsonl'), `${JSON.stringify(result)}\n`)
  results.push(result)
  await writeFile(path.join(output, 'comparison.md'), comparisonReport(results))
  console.log(JSON.stringify({ sizeMiB: size, highlighting, exitCode, result: resultFile }))
}
console.log(`Evidence: ${output}`)
process.exitCode = failures > 0 ? 1 : 0

function highlightingMode(value: string): Highlighting {
  if (value === 'default' || value === 'shiki' || value === 'tree-sitter') return value
  throw createScriptError('--highlighting accepts default, shiki or tree-sitter')
}

function positiveInteger(raw: string, name: string) {
  const value = Number(raw)
  if (Number.isSafeInteger(value) && value > 0) return value
  throw createScriptError(`${name} must contain positive integers; received ${raw}`)
}

async function sourceRevisions(phase: string) {
  return {
    platform: await captureRevision(checkoutRoot, path.join(output, `platform-${phase}.patch`)),
    editor: await captureRevision(
      path.resolve(checkoutRoot, 'editor'),
      path.join(output, `editor-${phase}.patch`),
    ),
  }
}

async function buildWeb() {
  const child = Bun.spawn(['bun', '--bun', 'vite', 'build', '--base', '/', '--outDir', webRoot], {
    cwd: path.join(checkoutRoot, 'apps/web'),
    env: { ...process.env, NODE_ENV: 'production', VITE_SERVER_URL: undefined },
    stdout: Bun.file(path.join(output, 'build.log')),
    stderr: 'inherit',
  })
  if (await child.exited) throw createScriptError(`Web build failed; see ${output}/build.log`)
}
