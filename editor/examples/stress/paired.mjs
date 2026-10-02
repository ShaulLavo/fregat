import { randomUUID, createHash } from 'node:crypto'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { resolve, dirname } from 'node:path'
import { parseArgs } from 'node:util'
import { performance } from 'node:perf_hooks'
import { chromium } from '@playwright/test'
import { fixtureFacts, generateFixture, defaultSeed } from './src/fixtures.ts'
import { readFrozenManifest } from './fixtures.mjs'
import { loadPackageSet } from './package-set.mjs'
import {
  inputConsumerIds,
  inputConsumerConfiguration,
  analysisLimitCodeUnits,
} from './input-configurations.mjs'
import { inputScenarios, inputViewModes } from './input-results.mjs'
import { operationsPerSample, runPairedInputSuite } from './input-scenarios.mjs'
import {
  comparePairedInput,
  sensitivityPassed,
  inputMatrixConfigurations,
} from './input-paired.mjs'
import {
  buildInputRuntime,
  inputEnvironment,
  inputInstrument,
  inputMemory,
  inputPage,
} from './input-runtime.mjs'
import { writeInputArtifact } from './input-artifacts.mjs'
import { frameDetectionFloorKey } from './input-paired.mjs'
import { frameFloorRejected, verifyInputSensitivity } from './input-sensitivity.mjs'
import { fail } from './errors.mjs'

const { values } = parseArgs({
  options: {
    baseline: { type: 'string' },
    candidate: { type: 'string' },
    full: { type: 'boolean', default: false },
    loaded: { type: 'boolean', default: false },
    stress: { type: 'boolean', default: false },
    configurations: { type: 'string' },
    only: { type: 'string' },
    'fixture-directory': { type: 'string' },
    repetitions: { type: 'string', default: '4' },
    seed: { type: 'string', default: '60061' },
    'slowdown-ms': { type: 'string', default: '0' },
    'frame-slowdown-ms': { type: 'string', default: '0' },
    output: { type: 'string', default: '/work/tmp/plan-282/paired.json.gz' },
    'sensitivity-directory': { type: 'string', default: '/work/tmp/plan-282/sensitivity' },
    'pending-minimap-source': { type: 'boolean', default: false },
    'fixed-repetitions': { type: 'boolean', default: false },
  },
})
if (!values.baseline || !values.candidate)
  fail('Usage: bench:input:paired --baseline <packages> --candidate <packages> [--full]')
const repetitions = Number(values.repetitions)
const seed = Number(values.seed)
const slowdownMs = Number(values['slowdown-ms'])
const frameSlowdownMs = Number(values['frame-slowdown-ms'])
if (
  !Number.isSafeInteger(repetitions) ||
  repetitions < 4 ||
  repetitions % 2 !== 0 ||
  !Number.isSafeInteger(seed) ||
  seed < 0 ||
  !Number.isFinite(slowdownMs) ||
  slowdownMs < 0 ||
  !Number.isFinite(frameSlowdownMs) ||
  frameSlowdownMs < 0
)
  fail('Invalid repetitions, seed or delay')
if (slowdownMs && frameSlowdownMs) fail('Use one delayed input stage per comparison')
const started = performance.now()
const baseline = await loadPackageSet(values.baseline)
const candidate = await loadPackageSet(values.candidate)
if (baseline.externalHash !== candidate.externalHash)
  fail('Paired packages require matching external bytes')
if (values.only && (values.full || values.configurations)) fail('--only requires a focused matrix')
const declared = (values.only ?? values.configurations)?.split(',')
if (declared?.some((id) => !inputConsumerIds.includes(id))) fail('Unknown input configuration')
const loadProfile = values.loaded ? 'loaded' : 'quiet'
const configurations = inputMatrixConfigurations({
  only: values.only,
  full: values.full,
  declared,
  loadProfile,
})
await mkdir('/work/tmp/plan-282', { recursive: true })
const temporary = await mkdtemp('/work/tmp/plan-282/runtime-')
let browser
let interrupted = false
const interrupt = () => {
  interrupted = true
  void browser?.close().catch(() => {})
}
process.on('SIGINT', interrupt)
process.on('SIGTERM', interrupt)
try {
  const fixtureDirectory = values['fixture-directory']
    ? resolve(values['fixture-directory'])
    : resolve(temporary, 'fixtures')
  if (!values['fixture-directory']) await freezeFixtures(fixtureDirectory, values.stress)
  const manifest = await readFrozenManifest(fixtureDirectory)
  manifest.fixtures = manifest.fixtures.filter((fixture) =>
    ['ordinary', 'short-lines', 'long-line'].includes(fixture.id),
  )
  if (new Set(manifest.fixtures.map((fixture) => fixture.id)).size !== 3)
    fail('Paired input requires ordinary, short-lines and long-line fixtures')
  if (
    !values.stress &&
    manifest.fixtures.some((fixture) => fixture.utf16Length > analysisLimitCodeUnits)
  )
    fail('Fixtures exceed Platform analysis tier; use --stress for larger fixtures')
  browser = await chromium.launch({ headless: true, env: { ...process.env, TMPDIR: temporary } })
  const instrument = await inputInstrument({
    runner: process.version,
    browser: { engine: 'chromium', version: browser.version(), headless: true },
  })
  const runtimes = {}
  for (const [side, set] of Object.entries({ baseline, candidate }))
    runtimes[side] = await buildInputRuntime(
      set,
      resolve(temporary, side),
      fixtureDirectory,
      manifest,
      instrument,
    )
  if (interrupted) fail('Paired input collection cancelled')
  const cachePath = resolve(
    values['sensitivity-directory'],
    `${instrument.measurementHash}.json.gz`,
  )
  await mkdir(dirname(resolve(values.output)), { recursive: true })
  let sensitivity = await readSensitivity(cachePath, instrument.measurementHash)
  if (!sensitivity) {
    const controls = {}
    for (const stage of ['input', 'frame']) {
      const check = await collect(
        { browser, manifest, instrument },
        'native',
        stage === 'input' ? 20 : 0,
        {
          baseline: runtimes.candidate,
          candidate: runtimes.candidate,
        },
        stage === 'frame' ? 20 : 0,
      )
      await writeInputArtifact(
        resolve(dirname(values.output), `sensitivity-${stage}.json.gz`),
        check,
      )
      if (stage === 'input' && !sensitivityPassed(check.comparison, stage))
        fail(`Injected 20 ms ${stage}-stage delay did not reject every blocking key in that stage`)
      controls[stage] = check
    }
    const frameDetectionFloor = await collectFrameDetectionFloor(
      { browser, manifest, instrument },
      runtimes.candidate,
    )
    sensitivity = verifyInputSensitivity(
      {
        schemaVersion: 4,
        instrumentHash: instrument.hash,
        measurementHash: instrument.measurementHash,
        validationHash: instrument.validationHash,
        passed: true,
        controls,
        frameDetectionFloor,
      },
      instrument.measurementHash,
    )
    await mkdir(dirname(cachePath), { recursive: true })
    await writeInputArtifact(cachePath, sensitivity)
  }
  const results = []
  for (const configuration of configurations) {
    const result = await collect(
      { browser, manifest, instrument },
      configuration,
      slowdownMs,
      runtimes,
      frameSlowdownMs,
    )
    results.push(result)
    await writeInputArtifact(`${resolve(values.output)}.${configuration}.json.gz`, result)
    console.log(
      JSON.stringify({
        event: 'input.paired.configuration',
        configuration,
        passed: result.comparison.passed,
        wallSeconds: result.wallSeconds,
      }),
    )
  }
  if (interrupted) fail('Paired input collection cancelled before publishing results')
  const report = {
    schemaVersion: 1,
    kind: 'paired-input-matrix',
    instrumentHash: instrument.hash,
    measurementHash: instrument.measurementHash,
    validationHash: instrument.validationHash,
    identitySources: {
      measurement: instrument.measurementFiles,
      validation: instrument.validationFiles,
    },
    createdAt: new Date().toISOString(),
    configurations,
    repetitions,
    seed,
    stress: values.stress,
    loadProfile,
    sensitivity: {
      instrumentHash: sensitivity.instrumentHash,
      measurementHash: sensitivity.measurementHash,
      validationHash: sensitivity.validationHash,
      path: cachePath,
      passed: sensitivity.passed,
      stages: ['input', 'frame'],
      frameDetectionFloor: {
        key: sensitivity.frameDetectionFloor.key,
        delayMs: sensitivity.frameDetectionFloor.delayMs,
      },
    },
    wallSeconds: (performance.now() - started) / 1000,
    acceptanceExclusions: values['pending-minimap-source']
      ? ['minimap configuration acceptance', 'short-lines undo final minimap source correctness']
      : [],
    passed: results.every(
      (result) =>
        (values['pending-minimap-source'] && result.configuration === 'minimap') ||
        result.comparison.passed,
    ),
    results,
  }
  await writeInputArtifact(resolve(values.output), report)
  console.log(
    JSON.stringify({
      event: 'input.paired.complete',
      output: resolve(values.output),
      passed: report.passed,
      wallSeconds: report.wallSeconds,
      configurations,
    }),
  )
  if (!report.passed) process.exitCode = 1
} finally {
  process.removeListener('SIGINT', interrupt)
  process.removeListener('SIGTERM', interrupt)
  await browser?.close()
  await rm(temporary, { recursive: true, force: true })
}

async function collect(
  { browser, manifest, instrument },
  consumers,
  delay,
  runtimes,
  frameDelay = 0,
) {
  const start = performance.now()
  const pendingMinimapSource =
    values['pending-minimap-source'] && inputConsumerConfiguration(consumers, 'ordinary', 1).minimap
  const adaptivePairs = !values['fixed-repetitions'] && repetitions === 4
  const results = {}
  for (const side of ['baseline', 'candidate']) {
    results[side] = {
      schemaVersion: 1,
      suite: 'input-latency',
      id: randomUUID(),
      createdAt: new Date().toISOString(),
      manifest,
      config: {
        repetitions,
        loadProfile,
        adaptivePairs: adaptivePairs ? 'counterbalanced-tight-within-budget' : false,
        ...(adaptivePairs ? { groupRepetitions: {} } : {}),
        warmups: 1,
        warmupFixture: 'measured',
        scenarios: inputScenarios,
        views: inputViewModes,
        operationsPerSample,
        diagnostics: false,
        readiness: 'receipt-poll',
        pendingMinimapSource,
        acceptanceExclusions: pendingMinimapSource
          ? ['short-lines undo final minimap source correctness']
          : [],
        slowdownMs: side === 'candidate' ? delay : 0,
        frameSlowdownMs: side === 'candidate' ? frameDelay : 0,
        consumers,
        fixtures: 'frozen-hashed-files',
        compositionCommitTrust: 'cdp-untrusted-compositionend',
        isolation: 'closed-browser-context-per-configuration',
        failureDirectory: dirname(resolve(values.output)),
      },
      environment: inputEnvironment(browser, runtimes[side], instrument),
      samples: [],
    }
  }
  const schedule = await runPairedInputSuite(
    browser,
    results,
    {
      newPage: (browser, side) => inputPage(browser, runtimes[side], consumers),
      readMemory: inputMemory,
    },
    seed,
  )
  const comparison = comparePairedInput(results.baseline, results.candidate, schedule, seed)
  return {
    configuration: consumers,
    baseline: results.baseline,
    candidate: results.candidate,
    schedule,
    comparison,
    wallSeconds: (performance.now() - start) / 1000,
  }
}

async function collectFrameDetectionFloor(context, runtime) {
  const attempts = []
  for (const delayMs of [25, 30]) {
    const check = await collect(
      context,
      'native',
      0,
      { baseline: runtime, candidate: runtime },
      delayMs,
    )
    attempts.push(check)
    await writeInputArtifact(
      resolve(dirname(values.output), `sensitivity-frame-${delayMs}ms.json.gz`),
      check,
    )
    if (frameFloorRejected(check.comparison))
      return { key: frameDetectionFloorKey, delayMs, attempts }
  }
  fail('Native repeat frame detection floor exceeds 30 ms')
}

async function readSensitivity(path, measurementHash) {
  const { readInputArtifact } = await import('./input-artifacts.mjs')
  const stored = await readInputArtifact(path).catch((error) => {
    if (error.code === 'ENOENT') return null
    throw error
  })
  if (!stored) return null
  return verifyInputSensitivity(stored, measurementHash)
}

async function freezeFixtures(directory, stress) {
  await mkdir(directory)
  const fixtures = []
  for (const id of ['ordinary', 'short-lines', 'long-line']) {
    const text =
      id === 'short-lines' && !stress
        ? Array(500_000).fill('//').join('\n')
        : generateFixture(id, defaultSeed)
    const fixture = {
      id,
      ...fixtureFacts(text),
      sha256: createHash('sha256').update(text).digest('hex'),
    }
    fixtures.push(fixture)
    await writeFile(resolve(directory, `${id}.txt`), text)
  }
  await writeFile(
    resolve(directory, 'manifest.json'),
    JSON.stringify({ schemaVersion: 1, generatorVersion: 1, seed: defaultSeed, fixtures }),
  )
}
