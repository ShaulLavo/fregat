import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, expect, test } from 'vitest'

const roots: string[] = []
const passingReport = JSON.stringify({
  testResults: [{ name: 'controlled', status: 'passed', assertionResults: [] }],
})
const supported =
  spawnSync('bash', ['--version']).status === 0 &&
  spawnSync('taskset', ['-pc', String(process.pid)]).status === 0

function fixture() {
  const root = mkdtempSync(path.join(tmpdir(), 'wallpaper-runner-'))
  roots.push(root)
  const bin = path.join(root, 'bin')
  mkdirSync(bin)
  const bun = process.execPath.replaceAll("'", "'\\''")
  writeFileSync(
    path.join(bin, 'bun'),
    `#!/usr/bin/env bash
if [[ "$1" != --bun ]]; then exec '${bun}' "$@"; fi
for argument in "$@"; do
  case "$argument" in --outputFile.json=*) report="\${argument#*=}" ;; esac
done
printf 'controlled runner\n'
if [[ "$RUNNER_REPORT" == yes ]]; then printf '%s' '${passingReport}' > "$report"; fi
if [[ "$report" == */2.json ]]; then exit 0; fi
exit "$RUNNER_EXIT"
`,
    { mode: 0o755 },
  )
  return { root, bin, evidence: path.join(root, 'evidence') }
}

function run(
  files: ReturnType<typeof fixture>,
  options: { exit: number; report?: boolean; runs?: number },
) {
  return spawnSync(
    'bash',
    [
      path.join(import.meta.dirname, 'flake-wallpaper.sh'),
      files.evidence,
      String(options.runs ?? 1),
    ],
    {
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: `${files.bin}${path.delimiter}${process.env.PATH}`,
        RUNNER_EXIT: String(options.exit),
        RUNNER_REPORT: options.report ? 'yes' : 'no',
      },
    },
  )
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

test('preserves reports and logs in an existing evidence destination', ({ skip }) => {
  if (!supported) skip('Bounded CPU-load reproduction requires bash and taskset.')
  const files = fixture()
  mkdirSync(files.evidence)
  writeFileSync(path.join(files.evidence, '1.json'), passingReport)
  writeFileSync(path.join(files.evidence, '1.log'), 'earlier evidence\n')
  expect(run(files, { exit: 3 }).status).not.toBe(0)
  expect(readFileSync(path.join(files.evidence, '1.json'), 'utf8')).toBe(passingReport)
  expect(readFileSync(path.join(files.evidence, '1.log'), 'utf8')).toBe('earlier evidence\n')
})

test.for([false, true])('propagates a runner exit with report=%s', (report, { skip }) => {
  if (!supported) skip('Bounded CPU-load reproduction requires bash and taskset.')
  expect(run(fixture(), { exit: 3, report }).status).toBe(3)
})

test('retains an earlier runner failure when a later repetition succeeds', ({ skip }) => {
  if (!supported) skip('Bounded CPU-load reproduction requires bash and taskset.')
  expect(run(fixture(), { exit: 3, report: true, runs: 2 }).status).toBe(3)
})

test('accepts a fresh passing report from a successful runner', ({ skip }) => {
  if (!supported) skip('Bounded CPU-load reproduction requires bash and taskset.')
  expect(run(fixture(), { exit: 0, report: true }).status).toBe(0)
})
