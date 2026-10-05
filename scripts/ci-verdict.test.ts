import { readFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { expect, test } from 'vitest'
import { ciVerdict } from './ci-verdict'

const root = path.resolve(import.meta.dirname, '..')
const read = (file: string): unknown => Bun.YAML.parse(readFileSync(path.join(root, file), 'utf8'))
const workflow = () => read('.github/workflows/ci.yml')

function fixture() {
  const outputs: Record<string, string> = {
    code: 'true',
    web: 'true',
    server: 'true',
    tui: 'true',
    site: 'true',
    editor: 'true',
    ghostty: 'true',
    hotkeys: 'true',
    docs: 'false',
    web_shards: '["1/4","2/4","3/4","4/4"]',
  }
  const changes = { result: 'success', outputs }
  const needs: Record<string, { result: string; outputs?: Record<string, string> }> = {
    changes,
    docs: { result: 'skipped' },
    lint: { result: 'success' },
    typecheck: { result: 'success' },
    'test-web': { result: 'success' },
    'test-server': { result: 'success' },
    'test-tui': { result: 'success' },
    browser: { result: 'success' },
    site: { result: 'success' },
    libraries: { result: 'success' },
  }
  const names = [
    'Changes',
    'Docs format',
    'Format, lint, census',
    'Typecheck, generated, packages',
    'Test (web 1/4)',
    'Test (web 2/4)',
    'Test (web 3/4)',
    'Test (web 4/4)',
    'Test (server 1/2)',
    'Test (server 2/2)',
    'Test (tui)',
    'Browser tests',
    'Site build',
    'Libraries / Editor tests',
    'Libraries / Ghostty tests',
    'Libraries / Standalone packages',
  ]
  const jobs = names.map((name) => ({
    name,
    status: 'completed',
    conclusion: name === 'Docs format' ? 'skipped' : 'success',
  }))
  const run = () => ciVerdict(workflow(), needs, [{ jobs }], 'pull_request', read)
  return { changes, needs, jobs, run }
}

test('actual required graph accepts completed successful jobs and its docs skip', () => {
  expect(fixture().run()).toEqual({ passed: true, issues: [] })
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
    'Libraries / Editor tests',
    'Libraries / Ghostty tests',
    'Libraries / Standalone packages',
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

test.each(['Test (web 3/4)', 'Libraries / Ghostty tests', 'Browser tests'])(
  'missing required execution %s rejects a successful parent',
  (name) => {
    const value = fixture()
    const jobs = value.jobs.filter((job) => job.name !== name)
    const verdict = ciVerdict(workflow(), value.needs, [{ jobs }], 'pull_request', read)
    expect(verdict.passed).toBe(false)
    expect(verdict.issues).toContain(`Required job ${name} lacks one successful execution`)
  },
)

test('disabled reusable children may skip while selected family succeeds', () => {
  const value = fixture()
  value.changes.outputs.ghostty = 'false'
  value.changes.outputs.hotkeys = 'false'
  const ghostty = value.jobs.find((job) => job.name === 'Libraries / Ghostty tests')
  expect(ghostty).toBeDefined()
  if (ghostty) ghostty.conclusion = 'skipped'
  expect(value.run()).toEqual({ passed: true, issues: [] })
})

test('source-authorized docs-only selection permits skipped or absent disabled jobs', () => {
  const value = fixture()
  for (const key of Object.keys(value.changes.outputs)) {
    if (key !== 'web_shards') value.changes.outputs[key] = key === 'docs' ? 'true' : 'false'
  }
  for (const id of Object.keys(value.needs)) {
    value.needs[id] = { result: id === 'changes' || id === 'docs' ? 'success' : 'skipped' }
  }
  value.needs.changes = value.changes
  const jobs = [
    { name: 'Changes', status: 'completed', conclusion: 'success' },
    { name: 'Docs format', status: 'completed', conclusion: 'success' },
  ]
  expect(ciVerdict(workflow(), value.needs, [{ jobs }], 'pull_request', read)).toEqual({
    passed: true,
    issues: [],
  })
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
  jobs.push(
    { name: 'Test (web 1/2)', status: 'completed', conclusion: 'success' },
    { name: 'Test (web 2/2)', status: 'completed', conclusion: 'success' },
  )
  expect(ciVerdict(workflow(), value.needs, [{ jobs }], 'workflow_dispatch', read)).toEqual({
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
  value.jobs.push({ name: 'CI', status: 'in_progress', conclusion: '' })
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
    for (const file of ['ci.yml', 'workspace-libraries.yml'])
      writeFileSync(
        path.join(workflows, file),
        readFileSync(path.join(root, '.github/workflows', file)),
      )
    const records = path.join(directory, 'jobs.json')
    writeFileSync(records, JSON.stringify([{ jobs: value.jobs }]))
    value.changes.outputs.docs_files = "'\nCI_NEEDS\n$(exit 99)"
    const result = Bun.spawnSync(
      [
        'bun',
        path.join(import.meta.dirname, 'ci-verdict.ts'),
        path.join(workflows, 'ci.yml'),
        records,
      ],
      {
        cwd: directory,
        env: {
          ...process.env,
          CI_NEEDS_JSON: JSON.stringify(value.needs),
          GITHUB_EVENT_NAME: 'pull_request',
        },
      },
    )
    expect(result.exitCode, result.stderr.toString()).toBe(0)
    expect(result.stderr.toString()).not.toContain(value.changes.outputs.docs_files)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})
