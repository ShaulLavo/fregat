import { existsSync, readFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { expect, onTestFinished, test } from 'vitest'
import { ciVerdict, type RunIdentity } from './ci-verdict'
import { readWorkflow } from './workflow-fixtures'

const root = path.resolve(import.meta.dirname, '..')
const read = (file: string): unknown => Bun.YAML.parse(readFileSync(path.join(root, file), 'utf8'))
const workflow = () => read('.github/workflows/ci.yml')

function fixture() {
  const outputs: Record<string, string> = {
    code: 'true',
    shared: 'true',
    tooling: 'true',
    tree: 'true',
    packages: '["web"]',
    exhaustive: 'true',
    web: 'true',
    server: 'true',
    tui: 'true',
    site: 'true',
    docs: 'false',
    web_shards: '["1/4","2/4","3/4","4/4"]',
    mobile_shards: '["chromium-0","chromium-1","webkit-0","webkit-1"]',
  }
  const identity: RunIdentity = {
    runId: 42,
    attempt: 1,
    headSha: 'a'.repeat(40),
    event: 'pull_request',
    repository: 'fixture/repo',
    workflowPath: '.github/workflows/ci.yml',
  }
  const metadata = {
    id: identity.runId,
    run_attempt: identity.attempt,
    head_sha: identity.headSha,
    event: identity.event,
    path: identity.workflowPath,
    repository: { full_name: identity.repository },
  }
  const changes = { result: 'success', outputs }
  const needs: Record<string, { result: string; outputs?: Record<string, string> }> = {
    baseline: { result: 'success' },
    changes,
    'workspace-builds': { result: 'success' },
    docs: { result: 'skipped' },
    lint: { result: 'success' },
    typecheck: { result: 'success' },
    'test-promotion-evidence': { result: 'success' },
    'test-web': { result: 'success' },
    'test-server': { result: 'success' },
    'test-tui': { result: 'success' },
    browser: { result: 'success' },
    site: { result: 'success' },
    'mobile-layout': { result: 'success' },
  }
  const names = [
    'Successful main baseline',
    'Changes',
    'Workspace builds',
    'Docs format',
    'Format, lint, census',
    'Typecheck, generated, packages',
    'Script tests (promotion evidence)',
    'Test (web 1/4)',
    'Test (web 2/4)',
    'Test (web 3/4)',
    'Test (web 4/4)',
    'Test (server 1/2)',
    'Test (server 2/2)',
    'Test (tui)',
    'Browser tests',
    'Site build',
    'Mobile layout (chromium-0)',
    'Mobile layout (chromium-1)',
    'Mobile layout (webkit-0)',
    'Mobile layout (webkit-1)',
  ]
  const jobs = names.map((name) => ({
    name,
    status: 'completed',
    conclusion: name === 'Docs format' ? 'skipped' : 'success',
    run_id: identity.runId,
    head_sha: identity.headSha,
    run_attempt: identity.attempt,
    runner_id: name === 'Docs format' ? 0 : 1,
    started_at: '2026-01-01T00:00:00Z',
    completed_at: '2026-01-01T00:00:01Z',
  }))
  const evaluate = (selected = jobs, event?: RunIdentity['event']) =>
    ciVerdict({
      workflow: workflow(),
      needs,
      pages: [{ jobs: selected }],
      run: event ? { ...metadata, event } : metadata,
      identity: event ? { ...identity, event } : identity,
      readWorkflow: read,
    })
  const run = () => evaluate()
  return { changes, needs, jobs, run, evaluate, identity, metadata }
}

test('actual required graph accepts completed successful jobs and its docs skip', () => {
  expect(fixture().run()).toEqual({ passed: true, issues: [] })
})

test('server-only validation requires both server shards and workspace builds', () => {
  const value = fixture()
  for (const key of ['shared', 'tooling', 'tree', 'web', 'tui', 'site', 'exhaustive'])
    value.changes.outputs[key] = 'false'
  value.changes.outputs.docs = 'true'
  value.changes.outputs.packages = '["server"]'
  for (const id of Object.keys(value.needs))
    value.needs[id] = {
      result: ['baseline', 'changes', 'workspace-builds', 'docs', 'test-server'].includes(id)
        ? 'success'
        : 'skipped',
    }
  value.needs.changes = value.changes
  const names = [
    'Successful main baseline',
    'Changes',
    'Workspace builds',
    'Docs format',
    'Test (server 1/2)',
    'Test (server 2/2)',
  ]
  const jobs = value.jobs
    .filter((job) => names.includes(job.name))
    .map((job) => ({ ...job, conclusion: 'success', runner_id: 1 }))
  expect(value.evaluate(jobs)).toEqual({ passed: true, issues: [] })
  for (const name of ['Workspace builds', 'Test (server 1/2)', 'Test (server 2/2)'])
    expect(value.evaluate(jobs.filter((job) => job.name !== name)).passed).toBe(false)
})

test('scheduled full validation uses the same strict verdict', () => {
  const value = fixture()
  expect(value.evaluate(value.jobs, 'schedule')).toEqual({ passed: true, issues: [] })
})

test('ordinary site changes require both smoke engines and no exhaustive mobile shards', () => {
  const value = fixture()
  value.changes.outputs.exhaustive = 'false'
  value.changes.outputs.mobile_shards = '["chromium-0","webkit-0"]'
  const jobs = value.jobs.filter(
    (job) => !['Mobile layout (chromium-1)', 'Mobile layout (webkit-1)'].includes(job.name),
  )
  expect(value.evaluate(jobs)).toEqual({ passed: true, issues: [] })
  expect(value.evaluate(jobs.filter((job) => job.name !== 'Mobile layout (webkit-0)')).passed).toBe(
    false,
  )
})

test('actual cancelled packet rejects synthetic successful parent needs', () => {
  const value = fixture()
  const cancelled = new Set([
    'Format, lint, census',
    'Test (server 1/2)',
    'Test (server 2/2)',
    'Test (web 1/4)',
    'Test (web 2/4)',
    'Test (web 3/4)',
    'Test (web 4/4)',
    'Browser tests',
  ])
  for (const job of value.jobs) if (cancelled.has(job.name)) job.conclusion = 'cancelled'
  const verdict = value.run()
  expect(verdict.passed).toBe(false)
  for (const name of cancelled)
    expect(verdict.issues.some((issue) => issue.includes(name))).toBe(true)
})

test.each(['failure', 'cancelled', 'abandoned', ''])(
  'required need result %j rejects',
  (result) => {
    const value = fixture()
    value.needs.browser = { result }
    expect(value.run().passed).toBe(false)
  },
)

test('missing required needs rejects before trusting successful API jobs', () => {
  const value = fixture()
  delete value.needs.browser
  expect(value.run()).toEqual({ passed: false, issues: ['Required need browser is missing'] })
})

test.each([
  'Test (web 3/4)',
  'Typecheck, generated, packages',
  'Test (server 1/2)',
  'Test (server 2/2)',
  'Browser tests',
  'Mobile layout (chromium-0)',
  'Mobile layout (chromium-1)',
  'Mobile layout (webkit-0)',
  'Mobile layout (webkit-1)',
])('missing required execution %s rejects a successful parent', (name) => {
  const value = fixture()
  const jobs = value.jobs.filter((job) => job.name !== name)
  const verdict = value.evaluate(jobs)
  expect(verdict.passed).toBe(false)
  expect(verdict.issues).toContain(`Required job ${name} lacks one successful execution`)
})

test('disabled consumer browser checks may skip while server coverage succeeds', () => {
  const value = fixture()
  for (const key of ['web', 'tree', 'tooling']) value.changes.outputs[key] = 'false'
  for (const id of ['browser', 'test-web', 'test-promotion-evidence', 'lint'])
    value.needs[id] = { result: 'skipped' }
  for (const job of value.jobs) {
    if (
      job.name === 'Browser tests' ||
      job.name.startsWith('Test (web ') ||
      job.name === 'Script tests (promotion evidence)' ||
      job.name === 'Format, lint, census'
    )
      job.conclusion = 'skipped'
  }
  expect(value.run()).toEqual({ passed: true, issues: [] })
})

test('plan-only selection runs formatting and permits skipped or absent disabled jobs', () => {
  const value = fixture()
  for (const key of Object.keys(value.changes.outputs)) {
    if (key !== 'web_shards' && key !== 'packages')
      value.changes.outputs[key] = key === 'docs' ? 'true' : 'false'
  }
  for (const id of Object.keys(value.needs)) {
    value.needs[id] = {
      result: ['baseline', 'changes', 'docs'].includes(id) ? 'success' : 'skipped',
    }
  }
  value.needs.changes = value.changes
  const jobs = value.jobs
    .filter((job) => ['Successful main baseline', 'Changes', 'Docs format'].includes(job.name))
    .map((job) => ({ ...job, conclusion: 'success', runner_id: 1 }))
  expect(value.evaluate(jobs)).toEqual({ passed: true, issues: [] })
  value.needs['mobile-layout'] = { result: 'success' }
  expect(value.evaluate(jobs).passed).toBe(false)
})

test('missing declared web shard selection rejects', () => {
  const value = fixture()
  delete value.changes.outputs.web_shards
  expect(value.run()).toEqual({ passed: false, issues: ['Matrix output is missing'] })
})

test('non-site code selection permits a skipped mobile layout job', () => {
  const value = fixture()
  value.changes.outputs.site = 'false'
  value.changes.outputs.docs = 'false'
  value.needs.site = { result: 'skipped' }
  value.needs['mobile-layout'] = { result: 'skipped' }
  const jobs = value.jobs.filter(
    (job) =>
      ![
        'Mobile layout (chromium-0)',
        'Mobile layout (chromium-1)',
        'Mobile layout (webkit-0)',
        'Mobile layout (webkit-1)',
        'Site build',
      ].includes(job.name),
  )
  expect(value.evaluate(jobs)).toEqual({ passed: true, issues: [] })
})

test('enabled work reported skipped rejects', () => {
  const value = fixture()
  value.needs.browser = { result: 'skipped' }
  expect(value.run().passed).toBe(false)
})

test('matrix expectations come from declared output values', () => {
  const value = fixture()
  value.changes.outputs.web_shards = '["1/2","2/2"]'
  const jobs = value.jobs.filter((job) => !job.name.startsWith('Test (web '))
  const sample = value.jobs[0]
  expect(sample).toBeDefined()
  if (!sample) return
  jobs.push({ ...sample, name: 'Test (web 1/2)' }, { ...sample, name: 'Test (web 2/2)' })
  expect(value.evaluate(jobs, 'workflow_dispatch')).toEqual({
    passed: true,
    issues: [],
  })
})

test.each(['neutral', 'timed_out', 'action_required', 'stale', 'startup_failure', 'abandoned'])(
  'API conclusion %s rejects',
  (conclusion) => {
    const value = fixture()
    const browser = value.jobs.find((job) => job.name === 'Browser tests')
    if (browser) browser.conclusion = conclusion
    expect(value.run().passed).toBe(false)
  },
)

test('nonterminal required API job rejects and current aggregate is excluded', () => {
  const value = fixture()
  const sample = value.jobs[0]
  if (!sample) return
  value.jobs.push({ ...sample, name: 'CI', status: 'in_progress', conclusion: '' })
  expect(value.run().passed).toBe(true)
  const browser = value.jobs.find((job) => job.name === 'Browser tests')
  if (browser) browser.status = 'in_progress'
  expect(value.run().passed).toBe(false)
})

test('CLI reads needs metadata without evaluating output text', () => {
  const value = fixture()
  const directory = mkdtempSync(path.join(tmpdir(), 'fregat-ci-verdict-'))
  try {
    const workflows = path.join(directory, '.github/workflows')
    mkdirSync(workflows, { recursive: true })
    for (const file of ['ci.yml'])
      writeFileSync(
        path.join(workflows, file),
        readFileSync(path.join(root, '.github/workflows', file)),
      )
    const records = path.join(directory, 'jobs.json')
    writeFileSync(records, JSON.stringify([{ jobs: value.jobs }]))
    const runFile = path.join(directory, 'run.json')
    writeFileSync(runFile, JSON.stringify(value.metadata))
    value.changes.outputs.docs_files = "'\nCI_NEEDS\n$(exit 99)"
    const result = Bun.spawnSync(
      [
        'bun',
        path.join(import.meta.dirname, 'ci-verdict.ts'),
        path.join(workflows, 'ci.yml'),
        records,
        runFile,
      ],
      {
        cwd: directory,
        env: {
          ...process.env,
          CI_NEEDS_JSON: JSON.stringify(value.needs),
          GITHUB_EVENT_NAME: 'pull_request',
          GITHUB_SHA: 'b'.repeat(40),
          CI_SOURCE_SHA: value.identity.headSha,
          RUN_ID: String(value.identity.runId),
          RUN_ATTEMPT: String(value.identity.attempt),
          GH_REPO: value.identity.repository,
        },
      },
    )
    expect(result.exitCode, result.stderr.toString()).toBe(0)
    expect(result.stderr.toString()).not.toContain(value.changes.outputs.docs_files)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test('aggregate-only retry accepts retained earlier-attempt success and skips', () => {
  const value = fixture()
  value.identity.attempt = 2
  value.metadata.run_attempt = 2
  expect(value.jobs.every((job) => job.run_attempt === 1)).toBe(true)
  expect(value.run()).toEqual({ passed: true, issues: [] })
})

test('API relabelled retention keeps success and permits skip timestamp anomalies', () => {
  const value = fixture()
  value.identity.attempt = 2
  value.metadata.run_attempt = 2
  for (const job of value.jobs) job.run_attempt = 2
  const docs = value.jobs.find((job) => job.name === 'Docs format')
  if (docs) docs.started_at = '2030-01-01T00:00:00Z'
  expect(value.run()).toEqual({ passed: true, issues: [] })
})

test('latest cancellation rejects even after an earlier successful execution', () => {
  const value = fixture()
  value.identity.attempt = 2
  value.metadata.run_attempt = 2
  const browser = value.jobs.find((job) => job.name === 'Browser tests')
  if (browser) {
    browser.run_attempt = 2
    browser.conclusion = 'cancelled'
  }
  expect(value.run().passed).toBe(false)
})

test.each(['head', 'run', 'attempt', 'event', 'workflow', 'repository'])(
  'stale workflow identity %s rejects',
  (field) => {
    const value = fixture()
    if (field === 'head') value.metadata.head_sha = 'b'.repeat(40)
    if (field === 'run') value.metadata.id += 1
    if (field === 'attempt') value.metadata.run_attempt += 1
    if (field === 'event') value.metadata.event = 'push'
    if (field === 'workflow') value.metadata.path = '.github/workflows/other.yml'
    if (field === 'repository') value.metadata.repository.full_name = 'fixture/other'
    expect(value.run().passed).toBe(false)
  },
)

test.each(['head', 'run', 'future-attempt'])('foreign job identity %s rejects', (field) => {
  const value = fixture()
  const browser = value.jobs.find((job) => job.name === 'Browser tests')
  if (!browser) return
  if (field === 'head') browser.head_sha = 'b'.repeat(40)
  if (field === 'run') browser.run_id += 1
  if (field === 'future-attempt') browser.run_attempt += 1
  expect(value.run().passed).toBe(false)
})

test('unstarted successful job rejects', () => {
  const value = fixture()
  const browser = value.jobs.find((job) => job.name === 'Browser tests')
  if (browser) browser.runner_id = 0
  expect(value.run().passed).toBe(false)
})

test.each(['cancelled', 'success'])(
  'cancelled Changes cannot authorize downstream skips with %s needs',
  (result) => {
    const value = fixture()
    for (const key of Object.keys(value.changes.outputs))
      if (key !== 'web_shards') value.changes.outputs[key] = 'false'
    for (const id of Object.keys(value.needs)) value.needs[id] = { result: 'skipped' }
    value.changes.result = result
    value.needs.changes = value.changes
    const changes = value.jobs.find((job) => job.name === 'Changes')
    if (!changes) return
    changes.conclusion = 'cancelled'
    expect(value.evaluate([changes]).passed).toBe(false)
  },
)

const shellAvailable = Bun.which('bash') !== null
if (!shellAvailable) console.info('Skipping trusted verifier CLI fixture: Bash is required.')

test.skipIf(!shellAvailable)(
  'trusted verifier reads candidate graph data without executing candidate code',
  () => {
    let directory: string | undefined
    onTestFinished(() => {
      if (directory) rmSync(directory, { recursive: true, force: true })
    })
    directory = mkdtempSync(path.join(tmpdir(), 'ci-trusted-verifier-'))
    const value = fixture()
    const candidate = path.join(directory, 'candidate')
    const trusted = path.join(directory, 'trusted')
    mkdirSync(path.join(candidate, '.github/workflows'), { recursive: true })
    mkdirSync(path.join(candidate, 'scripts'), { recursive: true })
    mkdirSync(path.join(trusted, 'scripts'), { recursive: true })
    for (const file of ['ci.yml'])
      writeFileSync(
        path.join(candidate, '.github/workflows', file),
        readFileSync(path.join(root, '.github/workflows', file)),
      )
    writeFileSync(
      path.join(trusted, 'scripts/ci-verdict.ts'),
      readFileSync(path.join(root, 'scripts/ci-verdict.ts')),
    )
    writeFileSync(
      path.join(candidate, 'scripts/ci-verdict.ts'),
      `await Bun.write(${JSON.stringify(path.join(directory, 'candidate-executed'))}, 'executed'); process.exit(99)`,
    )
    writeFileSync(path.join(candidate, 'bunfig.toml'), 'preload = ["./scripts/ci-verdict.ts"]\n')
    const jobs = path.join(directory, 'ci-jobs.json')
    writeFileSync(jobs, JSON.stringify([{ jobs: value.jobs }]))
    writeFileSync(path.join(directory, 'ci-run.json'), JSON.stringify(value.metadata))
    const step = readWorkflow('ci.yml').jobs.verdict!.steps.find(
      (entry) => entry.name === 'Verdict',
    )!
    const run = () =>
      Bun.spawnSync(['bash', '-euo', 'pipefail', '-c', step.run!], {
        cwd: directory,
        env: {
          PATH: process.env.PATH,
          RUNNER_TEMP: directory,
          CI_NEEDS_JSON: JSON.stringify(value.needs),
          CI_SOURCE_SHA: value.identity.headSha,
          GH_REPO: value.identity.repository,
          RUN_ID: String(value.identity.runId),
          RUN_ATTEMPT: String(value.identity.attempt),
          GITHUB_EVENT_NAME: value.identity.event,
        },
      })
    const result = run()
    expect(result.exitCode, result.stderr.toString()).toBe(0)
    expect(existsSync(path.join(directory, 'candidate-executed'))).toBe(false)
    for (const conclusion of ['failure', 'cancelled', 'skipped', 'missing']) {
      const changed = value.jobs.flatMap((job) => {
        if (job.name !== 'Script tests (promotion evidence)') return [job]
        return conclusion === 'missing' ? [] : [{ ...job, conclusion }]
      })
      writeFileSync(jobs, JSON.stringify([{ jobs: changed }]))
      const blocked = run()
      expect(blocked.exitCode, conclusion + blocked.stderr.toString()).toBe(1)
    }
    writeFileSync(jobs, JSON.stringify([{ jobs: value.jobs.slice(1) }]))
    const incomplete = run()
    expect(incomplete.exitCode).toBe(1)
    expect(incomplete.stderr.toString()).toContain('lacks one successful execution')
  },
)

test.each(['failure', 'cancelled', 'skipped', 'missing'])(
  'promotion evidence job %s blocks the aggregate',
  (conclusion) => {
    const value = fixture()
    if (conclusion === 'missing') {
      expect(
        value.evaluate(value.jobs.filter((job) => job.name !== 'Script tests (promotion evidence)'))
          .passed,
      ).toBe(false)
      return
    }
    const job = value.jobs.find((entry) => entry.name === 'Script tests (promotion evidence)')
    if (!job) return
    job.conclusion = conclusion
    expect(value.run().passed).toBe(false)
  },
)

test('promotion evidence job skips only when tooling is unaffected', () => {
  const value = fixture()
  for (const key of Object.keys(value.changes.outputs)) {
    if (value.changes.outputs[key] === 'true') value.changes.outputs[key] = 'false'
  }
  for (const id of Object.keys(value.needs)) {
    value.needs[id] = { result: ['baseline', 'changes'].includes(id) ? 'success' : 'skipped' }
  }
  value.needs.changes = value.changes
  for (const job of value.jobs) {
    if (!['Successful main baseline', 'Changes'].includes(job.name)) job.conclusion = 'skipped'
  }
  expect(value.run()).toEqual({ passed: true, issues: [] })
  value.changes.outputs.tooling = 'true'
  expect(value.run().passed).toBe(false)
})
test.each(['failure', 'cancelled', 'skipped'])('producer %s keeps aggregate CI red', (result) => {
  const value = fixture()
  value.needs['workspace-builds'] = { result }
  expect(value.run().passed).toBe(false)
})

test('missing producer execution rejects a successful parent and producer-only retry retains other coverage', () => {
  const value = fixture()
  expect(value.evaluate(value.jobs.filter((job) => job.name !== 'Workspace builds')).passed).toBe(
    false,
  )
  const producer = value.jobs.find((job) => job.name === 'Workspace builds')
  expect(producer).toBeDefined()
  value.identity.attempt = 2
  value.metadata.run_attempt = 2
  if (producer) producer.run_attempt = 2
  expect(value.run()).toEqual({ passed: true, issues: [] })
})

test.each(['failure', 'cancelled', 'skipped', 'missing'])(
  'exclusive browser script owner %s blocks the aggregate',
  (conclusion) => {
    const value = fixture()
    expect(value.run()).toEqual({ passed: true, issues: [] })
    const jobs = value.jobs
      .filter((job) => conclusion !== 'missing' || job.name !== 'Browser tests')
      .map((job) => (job.name === 'Browser tests' ? { ...job, conclusion } : job))
    expect(value.evaluate(jobs).passed).toBe(false)
  },
)
