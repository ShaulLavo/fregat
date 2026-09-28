import { existsSync } from 'node:fs'
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { parseArgs } from 'node:util'
import { checkoutRoot } from '../agent/paths'
import { releaseFixture } from '../agent/fixture-workspace'
import { createScriptError } from '../structured-errors'
import { runCase } from './run'

const { values } = parseArgs({
  options: {
    sizes: { type: 'string', default: '1,10,50,100,150,200' },
    ext: { type: 'string', default: 'txt' },
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
    'bun run bench:large-file [--sizes 1,10,50,100,150,200] [--ext txt|ts] [--two-byte] [--profile] [--out DIR] [--web-root BUILT_WEB] [--keys 30] [--settle-ms 10000] [--memory-mib 8192]',
  )
  process.exit(0)
}
if (values.ext !== 'txt' && values.ext !== 'ts') throw createScriptError('--ext must be txt or ts')
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

if (!values['web-root']) await buildWeb()
if (!existsSync(path.join(webRoot, 'index.html')))
  throw createScriptError(`No production web build at ${webRoot}`)
const revisions = {
  platform: await revision(checkoutRoot),
  editor: await revision(path.resolve(checkoutRoot, '../Editor')),
}
await writeFile(path.join(output, 'source.json'), JSON.stringify(revisions, null, 2))
let failures = 0
for (const size of sizes) {
  const caseOutput = path.join(
    output,
    `${values.ext}-${size}${values['two-byte'] ? '-unicode' : ''}`,
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
    '--keys',
    String(keys),
    '--settle-ms',
    String(settleMs),
    '--web-root',
    webRoot,
  ]
  if (values['two-byte']) args.push('--two-byte')
  if (values.profile) args.push('--profile')
  const unit = `platform-large-file-${process.pid}-${size}.scope`
  const cmd =
    process.platform === 'linux'
      ? [
          'systemd-run',
          '--user',
          '--scope',
          '--quiet',
          `--unit=${unit}`,
          '-p',
          `MemoryMax=${memoryMiB}M`,
          '-p',
          'MemorySwapMax=0',
          ...args,
        ]
      : args
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
  if (exitCode !== 0) failures += 1
  if (existsSync(path.join(caseOutput, 'fixture')))
    await releaseFixture(path.join(caseOutput, 'fixture'))
  const resultFile = path.join(caseOutput, 'result.json')
  const result: unknown = existsSync(resultFile)
    ? JSON.parse(await readFile(resultFile, 'utf8'))
    : { status: 'failed', sizeMiB: size, exitCode, output: caseOutput }
  await appendFile(path.join(output, 'results.jsonl'), `${JSON.stringify(result)}\n`)
  console.log(JSON.stringify({ sizeMiB: size, exitCode, result: resultFile }))
}
console.log(`Evidence: ${output}`)
process.exitCode = failures > 0 ? 1 : 0

function positiveInteger(raw: string, name: string) {
  const value = Number(raw)
  if (Number.isSafeInteger(value) && value > 0) return value
  throw createScriptError(`${name} must contain positive integers; received ${raw}`)
}

async function revision(root: string) {
  const child = Bun.spawn(['git', 'rev-parse', 'HEAD'], { cwd: root, stdout: 'pipe' })
  return (await new Response(child.stdout).text()).trim()
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
