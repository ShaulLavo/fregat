import { spawn } from 'node:child_process'
import { createWriteStream } from 'node:fs'
import { appendFile, lstat, mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { finished } from 'node:stream/promises'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { fail } from './errors.mjs'
import { readResult, validateFinalBlocks, validateRun } from './fallback-validation.mjs'

const repository = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
let child
let interrupted = false
const interrupt = () => {
  interrupted = true
  child?.kill('SIGTERM')
}
process.on('SIGINT', interrupt)
process.on('SIGTERM', interrupt)

async function main() {
  const { values } = parseArgs({
    options: {
      design: { type: 'string' },
      'baseline-core': { type: 'string' },
      'candidate-core': { type: 'string' },
      'cpu-affinity': { type: 'string' },
    },
  })
  for (const name of ['design', 'baseline-core', 'candidate-core', 'cpu-affinity'])
    if (!values[name]) fail(`Missing --${name}`)
  const designPath = resolve(values.design)
  const design = await readResult(designPath)
  if (design.purpose !== 'final') fail('Expected a preregistered final design')
  validateFinalBlocks(design.blocks)
  if (!(Date.parse(design.predeclaredAt) <= Date.now())) fail('Invalid preregistration time')
  const runs = design.blocks.flatMap((block) => runsForBlock(block, dirname(designPath), values))
  if (new Set(runs.map((run) => run.output)).size !== runs.length)
    fail('Every capture needs a distinct output path')
  if (runs.some((run) => !run.output.endsWith('.json'))) fail('Capture outputs must end in .json')
  for (const run of runs) await requireAbsent(run.output)
  const timeline = `${designPath}.timeline.jsonl`
  await writeFile(timeline, '', { flag: 'wx' })
  for (const run of runs) await capture(run, timeline, values['cpu-affinity'])
}

function runsForBlock(block, directory, values) {
  return block.order.map((arm) => ({
    block: block.id,
    arm,
    output: resolve(directory, block[arm]),
    core: resolve(arm === 'candidate' ? values['candidate-core'] : values['baseline-core']),
  }))
}

async function requireAbsent(path) {
  const exists = await lstat(path).then(
    () => true,
    (error) => {
      if (error.code !== 'ENOENT') throw error
      return false
    },
  )
  if (exists) fail(`Refusing to overwrite ${path}`)
}

async function capture(run, timeline, affinity) {
  if (interrupted) fail('Experiment interrupted; completed captures are preserved')
  await requireAbsent(run.output)
  await mkdir(dirname(run.output), { recursive: true })
  const logPath = run.output.replace(/\.json$/, '') + '.log'
  await requireAbsent(logPath)
  const args = [
    '-c',
    affinity,
    process.execPath,
    'examples/stress/first-paint.mjs',
    '--core-directory',
    run.core,
    '--repetitions',
    '5',
    '--fixtures',
    'short-lines',
    '--plugins',
    'none',
    '--modes',
    'direct,prepared',
    '--fallback-cases',
    '--output',
    run.output,
  ]
  await record(timeline, { event: 'capture.start', ...run, args })
  if (interrupted) fail('Experiment interrupted before capture; completed captures are preserved')
  const log = createWriteStream(logPath, { flags: 'wx' })
  child = spawn('taskset', args, { cwd: repository, stdio: ['ignore', 'pipe', 'pipe'] })
  child.stdout.pipe(log, { end: false })
  child.stderr.pipe(log, { end: false })
  const status = await new Promise((accept, reject) => {
    child.once('error', reject)
    child.once('close', (code, signal) => accept({ code, signal }))
    log.once('error', reject)
  })
  child = undefined
  log.end()
  await finished(log)
  await record(timeline, { event: 'capture.finish', ...run, ...status })
  if (status.code !== 0 || interrupted) fail(`Capture failed: ${logPath}`)
  validateRun(await readResult(run.output))
}

async function record(timeline, event) {
  const pressure = await readFile('/proc/pressure/cpu', 'utf8')
  const entry = { ...event, at: new Date().toISOString(), cpuPressure: pressure.trim() }
  await appendFile(timeline, JSON.stringify(entry) + '\n')
  console.log(JSON.stringify(entry))
}

try {
  await main()
} catch (error) {
  child?.kill('SIGTERM')
  fail(error instanceof Error ? error.message : String(error))
} finally {
  process.off('SIGINT', interrupt)
  process.off('SIGTERM', interrupt)
}
