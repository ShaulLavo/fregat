import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { hash as digest } from 'node:crypto'
import {
  appendFileSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { acquireX6Drain, releaseX6Drain, type DrainReceipt } from './ghostty-x6-public-drain.ts'
import { auditX6Overlap, type IntervalBlock, type RunnerJob } from './ghostty-x6-public-overlap.ts'
import { analyzeX6, x6Protocol } from './ghostty-x6-public-statistics.ts'
import { verifyX6Slices } from './ghostty-x6-public-slices.ts'
import { verifyX6Journal } from './ghostty-x6-public-journal.ts'
import { verifyPublicCounters, type CountRow } from './ghostty-x6-public-counters.ts'
import {
  bindX6Source,
  verifyX6RuntimeReuse,
  type SourceBinding,
} from './ghostty-x6-public-reuse.ts'
import {
  assertX6WindowDirectory,
  claimX6Window,
  verifyX6WindowClaim,
  type ReplacementClaim,
} from './ghostty-x6-public-claim.ts'

interface Host {
  readonly runnerDirectory: string
  readonly runnerFile: string
  readonly quietTurnFile: string
  readonly stateDirectory: string
  readonly settingsHome: string
  readonly windowDirectories: { readonly initial: string; readonly replacement: string }
}
interface Manifest {
  readonly sourceHead: string
  readonly sourceStatus: string
  readonly actualBase: string
  readonly sourceApproval: string
  readonly qualifiedCi: object
  readonly sourceHashes: Record<string, string>
  readonly artifacts: Record<string, string>
}
interface Unit {
  readonly sourceHead: string
  readonly actualBase: string
  readonly root: string
  readonly sourceApproval: string
  readonly qualifiedCi: object
  readonly bundle: string
  readonly bundleSha256: string
  readonly font: string
  readonly counterVerificationFile: string
  readonly counterVerificationSha256: string
  readonly protocol: typeof x6Protocol
  readonly files: Record<string, string>
  readonly sourceBindings: readonly SourceBinding[]
  readonly runtimeReuse: ReturnType<typeof verifyX6RuntimeReuse>
  readonly runtimeReuseQualification: {
    readonly file: string
    readonly sha256: string
    readonly checkpointHead: string
  }
  readonly node: { readonly path: string; readonly version: string; readonly sha256: string }
  readonly bun: { readonly path: string; readonly version: string; readonly sha256: string }
  readonly host: Host
  readonly settingsProbeFile: string
  readonly configuration: Record<string, unknown>
  readonly platform: object
}
interface Approval {
  readonly sourceProduct: string
  readonly bundleSha256: string
  readonly bundleKind: 'uninstrumented'
  readonly reviewReference: string
  readonly registrationFile: string
  readonly registrationSha256: string
  readonly replacement?: ReplacementClaim
}
interface HeavyRun {
  readonly id: string
  readonly label: string
  readonly quiet: boolean
  readonly cwd: string
}
interface CompletedRun {
  readonly requestId: string
  readonly jobsDuringRun: readonly RunnerJob[]
  readonly timestamp: string
  readonly serversAtAdmission: readonly object[]
  readonly exitCode: number
  readonly quietHoldExpired: boolean
}

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const launcher = fileURLToPath(import.meta.url)
const [command, inputArgument, outputArgument, argument, reuseArgument, qualificationArgument] =
  process.argv.slice(2)
assert(inputArgument && outputArgument)
const input = resolve(inputArgument)
const output = resolve(outputArgument)
const readJson = <T>(file: string): T => JSON.parse(readFileSync(file, 'utf8')) as T
const save = (directory: string, file: string, value: unknown) =>
  writeFileSync(join(directory, file), JSON.stringify(value, null, 2), { flag: 'wx' })
const git = (...args: string[]) => {
  const result = spawnSync('git', ['-C', root, ...args], { encoding: 'utf8' })
  assert.equal(result.status, 0, result.stderr)
  return result.stdout.trim()
}
const heavyKeys = [
  'developer.heavyJobClasses',
  'developer.heavyJobStopGraceSeconds',
  'developer.heavyJobQuietHoldSeconds',
  'developer.heavyJobQuietPolicy',
  'developer.heavyJobCpuLoadLimit',
  'developer.heavyJobMemoryPressureLimit',
  'developer.heavyJobMemoryReserveMiB',
  'developer.heavyJobLogDirectory',
] as const

async function configuration(unit: Pick<Unit, 'settingsProbeFile' | 'host'>) {
  const probe = (await import(pathToFileURL(unit.settingsProbeFile).href)) as {
    readHomeSetting(home: string, key: string): unknown
    SETTINGS_REGISTRY: Record<string, { default: unknown }>
  }
  return Object.fromEntries(
    heavyKeys.map((key) => [
      key,
      {
        effective: probe.readHomeSetting(unit.host.settingsHome, key),
        default: probe.SETTINGS_REGISTRY[key]!.default,
      },
    ]),
  )
}

function addTree(files: Record<string, string>, directory: string): void {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const file = join(directory, entry.name)
    if (entry.isDirectory()) {
      addTree(files, file)
      continue
    }
    assert(entry.isFile(), `Regular frozen dependency input required: ${file}`)
    files[file] = digest('sha256', readFileSync(file), 'hex')
  }
}

async function prepare(): Promise<void> {
  assert(argument, 'Explicit host configuration required')
  const manifest = readJson<Manifest>(join(input, 'manifest.json'))
  assert.equal(git('merge-base', manifest.actualBase, 'HEAD'), manifest.actualBase)
  assert.equal(git('status', '--porcelain'), '')
  assert(reuseArgument, 'Exact qualified type-only runtime reuse evidence required')
  const runtimeReuse = verifyX6RuntimeReuse(input, resolve(reuseArgument))
  assert(qualificationArgument, 'Independent exact type-reuse custody required')
  const qualificationFile = resolve(qualificationArgument)
  const qualification = readJson<{
    authorReceipt: string
    authorReceiptSha256: string
    toolingCheckpoint: { head: string }
  }>(qualificationFile)
  assert.equal(qualification.authorReceipt, runtimeReuse.evidenceFile)
  assert.equal(qualification.authorReceiptSha256, runtimeReuse.evidenceSha256)
  assert.equal(
    git('merge-base', qualification.toolingCheckpoint.head, 'HEAD'),
    qualification.toolingCheckpoint.head,
  )
  const runtimeReuseQualification = {
    file: qualificationFile,
    sha256: digest('sha256', readFileSync(qualificationFile), 'hex'),
    checkpointHead: qualification.toolingCheckpoint.head,
  }
  const files: Record<string, string> = {}
  const sourceBindings: SourceBinding[] = []
  const sourceMapFile = join(input, 'uninstrumented/entry.mjs.map')
  const sourceMap = readJson<{ sources: readonly string[]; sourcesContent: readonly string[] }>(
    sourceMapFile,
  )
  assert.equal(sourceMap.sources.length, sourceMap.sourcesContent.length)
  for (let index = 0; index < sourceMap.sources.length; index++) {
    const source = resolve(dirname(sourceMapFile), sourceMap.sources[index]!)
    const binding = bindX6Source(
      source,
      sourceMap.sourcesContent[index]!,
      readFileSync(source, 'utf8'),
    )
    sourceBindings.push(binding)
    files[source] = binding.currentSha256
  }
  const verificationFile = join(input, 'counter-verification.json')
  const rawCounters = readJson<{ rows: readonly CountRow[] }>(
    join(input, 'instrumented/counters.json'),
  )
  assert.deepEqual(verifyPublicCounters(rawCounters.rows), readJson<object>(verificationFile))
  assert.equal(
    readJson<{ passed: boolean }>(verificationFile).passed,
    true,
    'Full public matrix required',
  )
  assert.equal(
    readJson<{ status: number }>(join(input, 'uninstrumented/smoke-child.json')).status,
    0,
  )
  const host = readJson<Host>(resolve(argument))
  assertX6WindowDirectory(host.windowDirectories.initial, host.windowDirectories)
  assert(
    !existsSync(host.windowDirectories.initial) && !existsSync(host.windowDirectories.replacement),
  )
  files[resolve(argument)] = digest('sha256', readFileSync(resolve(argument)), 'hex')
  assert.equal(
    realpathSync(host.runnerDirectory),
    host.runnerDirectory,
    'Use the actual installed release directory',
  )
  mkdirSync(output)
  addTree(files, input)
  addTree(files, runtimeReuse.rebuiltArchive)
  files[runtimeReuse.evidenceFile] = runtimeReuse.evidenceSha256
  files[qualificationFile] = runtimeReuseQualification.sha256
  assert.equal(sourceBindings.length, 80)
  assert.equal(
    sourceBindings.filter((binding) => binding.classification === 'BYTE-EQUAL').length,
    79,
  )
  for (const [file, expected] of Object.entries(manifest.artifacts))
    assert.equal(files[join(input, file)], expected)
  for (const [file, expected] of Object.entries(manifest.sourceHashes)) {
    const path = join(root, 'ghostty-webgpu', file)
    files[path] = digest('sha256', readFileSync(path), 'hex')
    assert.equal(files[path], expected)
  }
  const platform = readJson<{ hashes: Record<string, string> }>(
    join(input, 'uninstrumented/platform-inputs.json'),
  )
  for (const [file, expected] of Object.entries(platform.hashes)) {
    assert.equal(digest('sha256', readFileSync(file), 'hex'), expected)
    files[file] = expected
    if (file.endsWith('/package.json')) addTree(files, dirname(file))
  }
  for (const file of [
    launcher,
    join(root, 'bun.lock'),
    join(root, 'apps/web/package.json'),
    join(root, 'scripts/ghostty-x6-public-drain.ts'),
    join(root, 'scripts/ghostty-x6-public-overlap.ts'),
    join(root, 'scripts/ghostty-x6-public-statistics.ts'),
    join(root, 'scripts/ghostty-x6-public-counters.ts'),
    join(root, 'scripts/ghostty-x6-public-slices.ts'),
    join(root, 'scripts/ghostty-x6-public-journal.ts'),
    join(root, 'scripts/ghostty-x6-public-journal.test.ts'),
    join(root, 'scripts/ghostty-x6-public-overlap.test.ts'),
    join(root, 'scripts/ghostty-x6-public-claim.ts'),
    join(root, 'scripts/ghostty-x6-public-reuse.ts'),
    host.quietTurnFile,
    ...['run.js', 'status.js', 'commit'].map((name) => join(host.runnerDirectory, name)),
  ]) {
    files[file] = digest('sha256', readFileSync(file), 'hex')
    copyFileSync(file, join(output, `${Object.keys(files).length}-${file.split('/').at(-1)}`))
  }
  const runner = readFileSync(join(host.runnerDirectory, 'run.js'), 'utf8')
  const boundary = runner.indexOf('// scripts/state-home.ts\n')
  assert(boundary > 0, 'Known read-only installed configuration prefix required')
  const prefix = runner.slice(0, boundary)
  assert(!prefix.includes('process.exit'), 'Configuration reader must not enter runner CLI')
  const settingsProbeFile = join(output, 'settings-probe.mjs')
  writeFileSync(settingsProbeFile, prefix + '\nexport { readHomeSetting, SETTINGS_REGISTRY };\n', {
    flag: 'wx',
  })
  files[settingsProbeFile] = digest('sha256', readFileSync(settingsProbeFile), 'hex')
  const nodeResult = spawnSync('node', ['-p', 'process.execPath'], { encoding: 'utf8' })
  assert.equal(nodeResult.status, 0)
  const node = nodeResult.stdout.trim()
  const nodeVersion = spawnSync(node, ['--version'], { encoding: 'utf8' })
  assert.equal(nodeVersion.status, 0)
  const unit: Unit = {
    sourceHead: git('rev-parse', 'HEAD'),
    actualBase: manifest.actualBase,
    root,
    sourceApproval: manifest.sourceApproval,
    qualifiedCi: manifest.qualifiedCi,
    bundle: join(input, 'uninstrumented/entry.mjs'),
    bundleSha256: manifest.artifacts['uninstrumented/entry.mjs']!,
    font: join(input, 'fixture-font.ttf'),
    counterVerificationFile: verificationFile,
    counterVerificationSha256: digest('sha256', readFileSync(verificationFile), 'hex'),
    protocol: x6Protocol,
    files,
    sourceBindings,
    runtimeReuse,
    runtimeReuseQualification,
    node: {
      path: node,
      version: nodeVersion.stdout.trim(),
      sha256: digest('sha256', readFileSync(node), 'hex'),
    },
    bun: {
      path: process.execPath,
      version: Bun.version,
      sha256: digest('sha256', readFileSync(process.execPath), 'hex'),
    },
    host,
    settingsProbeFile,
    configuration: await configuration({ host, settingsProbeFile }),
    platform,
  }
  save(output, 'draft.json', unit)
  console.log(
    JSON.stringify({
      draft: join(output, 'draft.json'),
      registrationCreated: false,
      performanceObservations: 0,
    }),
  )
}

async function verifyUnit(unit: Unit): Promise<void> {
  assert.equal(unit.root, root)
  assertX6WindowDirectory(unit.host.windowDirectories.initial, unit.host.windowDirectories)
  assert.equal(realpathSync(unit.host.runnerFile), join(unit.host.runnerDirectory, 'run.js'))
  assert(readFileSync(unit.host.quietTurnFile, 'utf8').includes(unit.host.runnerFile))
  assert.equal(unit.sourceHead, git('rev-parse', 'HEAD'))
  assert.equal(git('status', '--porcelain'), '')
  assert.deepEqual(unit.protocol, x6Protocol)
  assert.deepEqual(
    verifyX6RuntimeReuse(dirname(dirname(unit.bundle)), unit.runtimeReuse.evidenceFile),
    unit.runtimeReuse,
  )
  for (const [file, expected] of Object.entries(unit.files))
    assert.equal(digest('sha256', readFileSync(file), 'hex'), expected, file)
  assert.equal(digest('sha256', readFileSync(unit.node.path), 'hex'), unit.node.sha256)
  assert.equal(digest('sha256', readFileSync(unit.bun.path), 'hex'), unit.bun.sha256)
  assert.equal(process.execPath, unit.bun.path)
  assert.equal(Bun.version, unit.bun.version)
  const version = spawnSync(unit.node.path, ['--version'], { encoding: 'utf8' })
  assert.equal(version.status, 0)
  assert.equal(version.stdout.trim(), unit.node.version)
  assert.deepEqual(await configuration(unit), unit.configuration)
}

function authorize(unit: Unit, file: string): Approval {
  const approval = readJson<Approval>(file)
  assert.equal(approval.sourceProduct, unit.actualBase)
  assert.equal(approval.bundleSha256, unit.bundleSha256)
  assert.equal(approval.bundleKind, 'uninstrumented')
  assert.match(approval.reviewReference, /^https:\/\/github\.com\/ShaulLavo\/fregat\//)
  assert.equal(
    digest('sha256', readFileSync(approval.registrationFile), 'hex'),
    approval.registrationSha256,
  )
  assert.deepEqual(readJson<Unit>(approval.registrationFile), unit)
  return approval
}

function runChild(
  executable: string,
  argv: readonly string[],
  directory: string,
): Promise<number | null> {
  const child = spawn(executable, argv, { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] })
  const stop = () => {
    child.kill('SIGTERM')
  }
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const)
    process.prependOnceListener(signal, stop)
  child.stdout.on('data', (bytes: Buffer) => appendFileSync(join(directory, 'stdout.log'), bytes))
  child.stderr.on('data', (bytes: Buffer) => appendFileSync(join(directory, 'stderr.log'), bytes))
  return new Promise((resolveChild) => {
    child.once('error', (cause) => save(directory, 'spawn-error.json', { message: String(cause) }))
    child.once('close', (status, signal) => {
      for (const key of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) process.removeListener(key, stop)
      save(directory, 'child.json', { executable, argv, status, signal, pid: child.pid })
      resolveChild(status)
    })
  })
}

async function drive(unit: Unit, mode: 'startup' | 'block'): Promise<void> {
  await verifyUnit(unit)
  if (mode === 'block') {
    assert(argument)
    const approval = authorize(unit, resolve(argument))
    assertX6WindowDirectory(output, unit.host.windowDirectories, approval.replacement)
    verifyX6WindowClaim(approval.registrationFile, output, approval.replacement)
  }
  const runsDirectory = join(unit.host.stateDirectory, 'runs')
  const runs = readdirSync(runsDirectory)
    .filter((file) => /^[0-9a-f]{12}\.json$/.test(file))
    .map((file) => readJson<HeavyRun>(join(runsDirectory, file)))
  const expectedLabel = `x6-${mode}-${digest('sha256', output, 'hex').slice(0, 12)}`
  const admitted = runs.filter(
    (run) => run.label === expectedLabel && run.quiet && run.cwd === root,
  )
  assert.equal(admitted.length, 1, 'Actual quiet admission required before creating own drain')
  const run = admitted[0]!
  save(output, 'actual-run.json', run)
  save(output, 'runs-at-start.json', runs)
  const journal = join(unit.host.stateDirectory, 'measurements', `${run.id}.json`)
  copyFileSync(journal, join(output, 'journal-before-hold.json'))
  const holder = readFileSync(join(unit.host.stateDirectory, 'quiet.holder'), 'utf8')
  assert(holder.includes(`id=${run.id}`))
  writeFileSync(join(output, 'quiet-holder.txt'), holder, { flag: 'wx' })
  let receipt: DrainReceipt | undefined
  let cleanup: string | undefined
  function release(): void {
    if (receipt && !cleanup) cleanup = releaseX6Drain(receipt)
  }
  process.once('exit', release)
  for (const [signal, code] of [
    ['SIGINT', 130],
    ['SIGTERM', 143],
    ['SIGHUP', 129],
  ] as const)
    process.once(signal, () => {
      release()
      process.exit(code)
    })
  try {
    receipt = acquireX6Drain(join(unit.host.stateDirectory, 'drain.request'))
    save(output, 'own-drain-receipt.json', receipt)
    if (mode === 'block')
      save(output, 'started.json', {
        startedAt: new Date().toISOString(),
        unitSha256: digest('sha256', readFileSync(input), 'hex'),
        protocol: x6Protocol,
        driverPid: process.pid,
      })
    const count = mode === 'startup' ? 1 : x6Protocol.blocks
    for (let index = 0; index < count; index++) {
      const directory = join(output, `block-${String(index).padStart(2, '0')}`)
      mkdirSync(directory)
      for (const file of ['ghostty-vt.wasm', 'bridge.wasm'])
        copyFileSync(join(dirname(unit.bundle), file), join(directory, file))
      const argv = [unit.bundle, directory, mode, root, unit.font, unit.actualBase]
      if (mode === 'block') argv.push(resolve(argument!))
      const status = await runChild(unit.node.path, argv, directory)
      appendFileSync(join(output, 'raw.jsonl'), JSON.stringify({ index, status, directory }) + '\n')
      // Preserve every fixed process attempt; a failed vector never substitutes a later process.
      if (status !== 0) continue
      try {
        assert.deepEqual(readJson<object>(join(directory, 'platform-inputs.json')), unit.platform)
        save(directory, 'platform-verification.json', { passed: true })
      } catch (cause) {
        save(directory, 'platform-verification.json', { passed: false, cause: String(cause) })
      }
    }
  } finally {
    release()
    copyFileSync(journal, join(output, 'journal-after-hold.json'))
    save(output, 'driver-finished.json', {
      endedAt: new Date().toISOString(),
      mode,
      driverPid: process.pid,
      cleanup,
      registrationCreated: false,
      timingWindowStarted: mode === 'block',
    })
  }
  assert.equal(cleanup, 'released')
}

function verifyCompletedJournal(directory: string, jobs: readonly RunnerJob[]): void {
  verifyX6Journal(
    jobs,
    ['journal-before-hold.json', 'journal-after-hold.json'].map((file) =>
      readJson<Readonly<Record<string, RunnerJob>>>(join(directory, file)),
    ),
  )
}

async function launch(mode: 'startup' | 'block'): Promise<void> {
  const unit = readJson<Unit>(input)
  await verifyUnit(unit)
  if (mode === 'block') {
    assert(argument)
    const approval = authorize(unit, resolve(argument))
    assertX6WindowDirectory(output, unit.host.windowDirectories, approval.replacement)
    claimX6Window(approval.registrationFile, output, approval.replacement)
  }
  mkdirSync(output)
  copyFileSync(input, join(output, 'unit.json'))
  const argv = [
    unit.host.quietTurnFile,
    `x6-${mode}-${digest('sha256', output, 'hex').slice(0, 12)}`,
    '--class',
    'bench',
    '--',
    unit.bun.path,
    launcher,
    mode === 'startup' ? 'drive-startup' : 'drive-block',
    input,
    output,
  ]
  if (mode === 'block') argv.push(resolve(argument!))
  const status = await runChild('bash', argv, output)
  const receiptFile = join(output, 'own-drain-receipt.json')
  if (existsSync(receiptFile)) {
    const receipt = readJson<DrainReceipt>(receiptFile)
    let alive = true
    try {
      process.kill(receipt.pid, 0)
    } catch (cause) {
      assert.equal((cause as NodeJS.ErrnoException).code, 'ESRCH')
      alive = false
    }
    save(output, 'supervisor-cleanup.json', {
      alive,
      result: alive ? 'preserved-live-driver' : releaseX6Drain(receipt),
    })
  }
  assert.equal(status, 0, 'Preserved failed quiet-turn/driver inputs; no automatic retry')
  const run = readJson<HeavyRun>(join(output, 'actual-run.json'))
  const logSetting = unit.configuration['developer.heavyJobLogDirectory'] as { effective: string }
  const logDirectory = logSetting.effective
  const completed = readdirSync(logDirectory)
    .filter((file) => file.endsWith('.jsonl'))
    .flatMap((file) => readFileSync(join(logDirectory, file), 'utf8').split('\n').filter(Boolean))
    .map((line) => JSON.parse(line) as CompletedRun)
    .filter((record) => record.requestId === run.id)
  assert.equal(completed.length, 1, 'Actual completed runner record required')
  save(output, 'actual-heavy-job-record.json', completed[0])
  assert.equal(completed[0]!.exitCode, 0)
  assert.equal(completed[0]!.quietHoldExpired, false)
  // The runner removes its live journal on completion; the completed record owns the final overlap list.
  try {
    verifyCompletedJournal(output, completed[0]!.jobsDuringRun)
    save(output, 'journal-verification.json', { passed: true })
  } catch (cause) {
    save(output, 'journal-verification.json', { passed: false, cause: String(cause) })
    if (mode === 'startup') throw cause
  }
  if (mode === 'startup') {
    assert.equal(
      readJson<{ passed: boolean }>(join(output, 'block-00/platform-verification.json')).passed,
      true,
    )
    assert.equal(readJson<{ status: number }>(join(output, 'block-00/child.json')).status, 0)
    const result = readJson<{
      performanceObservations: number
      rows: readonly { operation: string }[]
    }>(join(output, 'block-00/startup.json'))
    assert.equal(result.performanceObservations, 0)
    assert.equal(result.rows.length, 1)
    assert.equal(result.rows[0]!.operation, 'startup-public-native-readback')
    save(output, 'startup-verification.json', {
      passed: true,
      performanceObservations: 0,
      unitSha256: digest('sha256', readFileSync(input), 'hex'),
      launcherSha256: digest('sha256', readFileSync(launcher), 'hex'),
      actualBase: unit.actualBase,
      actualAdmittedJobId: run.id,
      scope: 'Same frozen launcher, public/native/fonts and own-drain lifecycle only',
    })
    return
  }
  const directory = join(output, 'analysis')
  mkdirSync(directory)
  const analysisStatus = await runChild(
    unit.bun.path,
    [
      unit.host.runnerFile,
      '--class',
      'light',
      `x6-analysis-${digest('sha256', output, 'hex').slice(0, 12)}`,
      '--',
      unit.bun.path,
      launcher,
      'analyze',
      input,
      output,
    ],
    directory,
  )
  if (analysisStatus !== 0) process.exitCode = 1
}

async function analyzeWindow(): Promise<void> {
  const blocks: IntervalBlock[] = []
  const failures: object[] = []
  for (let index = 0; index < x6Protocol.blocks; index++) {
    const directory = join(output, `block-${String(index).padStart(2, '0')}`)
    const child = readJson<{ status: number | null }>(join(directory, 'child.json'))
    if (child.status !== 0) {
      failures.push({ index, ...child })
      continue
    }
    try {
      assert.equal(
        readJson<{ passed: boolean }>(join(directory, 'platform-verification.json')).passed,
        true,
      )
      const block = readJson<IntervalBlock>(join(directory, 'block.json'))
      verifyX6Slices(block)
      blocks.push(block)
    } catch (cause) {
      failures.push({ index, cause: String(cause) })
    }
  }
  save(output, 'vector-verification.json', { failures, completedVectors: blocks.length })
  assert.equal(
    failures.length,
    0,
    'All original 40 process vectors required; no replay or filtering',
  )
  const record = readJson<CompletedRun>(join(output, 'actual-heavy-job-record.json'))
  const descriptive = analyzeX6(blocks)
  save(output, 'descriptive-result.json', descriptive)
  verifyCompletedJournal(output, record.jobsDuringRun)
  assert.equal(record.exitCode, 0)
  assert.equal(record.quietHoldExpired, false)
  const finished = readJson<{ endedAt: string }>(join(output, 'driver-finished.json'))
  const overlap = auditX6Overlap(blocks, record.jobsDuringRun, Date.parse(finished.endedAt))
  save(output, 'overlap.json', overlap)
  process.exitCode = overlap.valid && descriptive.passed ? 0 : 1
  save(output, 'result.json', {
    passed: overlap.valid && descriptive.passed,
    overlapValid: overlap.valid,
    performancePassed: descriptive.passed,
    replacement: overlap.valid
      ? 'NOT AUTHORIZED'
      : 'Only one separately authorized new-identity whole-40 window; no automatic launch',
  })
}

async function seal(): Promise<void> {
  assert(argument, 'Same-launcher startup evidence required')
  const unit = readJson<Unit>(input)
  await verifyUnit(unit)
  const smoke = readJson<{ passed: boolean; unitSha256: string; launcherSha256: string }>(
    join(resolve(argument), 'startup-verification.json'),
  )
  assert.equal(smoke.passed, true)
  assert.equal(smoke.unitSha256, digest('sha256', readFileSync(input), 'hex'))
  assert.equal(smoke.launcherSha256, digest('sha256', readFileSync(launcher), 'hex'))
  writeFileSync(output, readFileSync(input), { flag: 'wx' })
  console.log(
    JSON.stringify({
      registrationFile: output,
      sha256: digest('sha256', readFileSync(output), 'hex'),
      startupEvidence: resolve(argument),
      timingWindow: 'HELD — independent registration review and exact approval receipt required',
    }),
  )
}

if (command === 'prepare') await prepare()
else if (command === 'startup') await launch('startup')
else if (command === 'seal') await seal()
else if (command === 'run') await launch('block')
else if (command === 'analyze') await analyzeWindow()
else if (command === 'drive-startup') await drive(readJson<Unit>(input), 'startup')
else if (command === 'drive-block') await drive(readJson<Unit>(input), 'block')
else assert.fail('Use prepare, startup, seal or independently authorized run')
