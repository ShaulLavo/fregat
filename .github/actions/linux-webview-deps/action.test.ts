import { expect, test } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function installationRun() {
  const action: unknown = Bun.YAML.parse(
    readFileSync(path.join(import.meta.dirname, 'action.yml'), 'utf8'),
  )
  expect(isRecord(action)).toBe(true)
  if (!isRecord(action) || !isRecord(action.runs) || !Array.isArray(action.runs.steps)) return ''
  const steps: unknown[] = action.runs.steps
  const install = steps.find(
    (step) => isRecord(step) && step.name === 'Install Linux webview build dependencies',
  )
  return isRecord(install) && typeof install.run === 'string' ? install.run : ''
}

const azure = 'http://azure.archive.ubuntu.com/ubuntu/\tpriority:1\n'
const https =
  'https://archive.ubuntu.com/ubuntu/\tpriority:2\nhttps://security.ubuntu.com/ubuntu/\tpriority:3\n'
const supported =
  process.platform === 'linux' && Bun.which('bash') !== null && Bun.which('sed') !== null
if (!supported)
  console.info('Skipping Ubuntu dependency source controls. Linux, Bash, and sed are required.')

function runInstallation({
  mirrors = azure + https,
  updateStatus = 0,
  installStatus = 0,
  privilegeStatus = 0,
  signal = false,
  mirrorFile = true,
  twice = false,
}: {
  mirrors?: string
  updateStatus?: number
  installStatus?: number
  privilegeStatus?: number
  signal?: boolean
  mirrorFile?: boolean
  twice?: boolean
} = {}) {
  const root = mkdtempSync(path.join(tmpdir(), 'linux-webview-apt-'))
  try {
    if (mirrorFile) writeFileSync(path.join(root, 'mirrors'), mirrors)
    writeFileSync(
      path.join(root, 'sudo'),
      `#!/usr/bin/env bash
set -euo pipefail
if [[ ${privilegeStatus} != 0 ]]; then exit ${privilegeStatus}; fi
args=()
for value in "$@"; do
  if [[ "$value" == /etc/apt/apt-mirrors.txt ]]; then value="$APT_FIXTURE_ROOT/mirrors"; fi
  args+=("$value")
done
exec "\${args[@]}"
`,
      { mode: 0o755 },
    )
    writeFileSync(
      path.join(root, 'apt-get'),
      `#!/usr/bin/env bash
set -euo pipefail
printf '%s\\n' "$*" >> "$APT_FIXTURE_ROOT/calls"
if [[ "$1" == update ]]; then
  if command sed -n '\\|^http://azure\\.archive\\.ubuntu\\.com/ubuntu/|p' "$APT_FIXTURE_ROOT/mirrors" | read -r; then
    printf 'Ign:2 http://azure.archive.ubuntu.com/ubuntu noble InRelease\\n'
    printf 'Get:3 https://archive.ubuntu.com/ubuntu noble-updates InRelease [126 kB]\\n'
    printf 'Ign:10 http://azure.archive.ubuntu.com/ubuntu noble-updates/main amd64 Packages\\n'
    exit 75
  fi
  if ${signal}; then kill -TERM "$$"; fi
  printf 'APT refresh fixture status ${updateStatus}\\n'
  exit ${updateStatus}
fi
printf 'APT installation fixture status ${installStatus}\\n'
exit ${installStatus}
`,
      { mode: 0o755 },
    )
    const script = installationRun()
    expect(script).not.toBe('')
    const run = () =>
      Bun.spawnSync(['bash', '--noprofile', '--norc', '-e', '-o', 'pipefail', '-c', script], {
        env: {
          ...process.env,
          PATH: root + path.delimiter + process.env.PATH,
          APT_FIXTURE_ROOT: root,
        },
        timeout: 5_000,
      })
    const first = run()
    const second = twice ? run() : undefined
    return {
      status: first.exitCode,
      secondStatus: second?.exitCode,
      output: first.stdout.toString() + first.stderr.toString(),
      mirrors: mirrorFile ? readFileSync(path.join(root, 'mirrors'), 'utf8') : null,
      calls: readFileSync(path.join(root, 'calls'), { encoding: 'utf8', flag: 'a+' })
        .trim()
        .split('\n')
        .filter(Boolean),
    }
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

test.skipIf(!supported)(
  'known-good HTTPS package sources refresh and install the original dependencies',
  () => {
    const result = runInstallation({ mirrors: https })
    expect(result.status, result.output).toBe(0)
    expect(result.calls).toEqual([
      'update',
      'install -y build-essential pkg-config libwebkit2gtk-4.1-dev',
    ])
    expect(result.mirrors).toBe(https)
  },
)

test.skipIf(!supported)(
  'uses the established HTTPS mirror policy before APT refreshes package lists',
  () => {
    const result = runInstallation()
    expect(result.status, result.output).toBe(0)
    expect(result.calls).toEqual([
      'update',
      'install -y build-essential pkg-config libwebkit2gtk-4.1-dev',
    ])
    expect(result.mirrors).toBe(https)
  },
)

test.skipIf(!supported)(
  'preserves unrelated mirror entries and converges on repeated setup',
  () => {
    const extra = '# runner mirror list\nhttps://mirror.example.invalid/ubuntu/\tpriority:4\n'
    const result = runInstallation({ mirrors: extra + azure + https, twice: true })
    expect(result.status, result.output).toBe(0)
    expect(result.secondStatus).toBe(0)
    expect(result.mirrors).toBe(extra + https)
    expect(result.calls).toEqual([
      'update',
      'install -y build-essential pkg-config libwebkit2gtk-4.1-dev',
      'update',
      'install -y build-essential pkg-config libwebkit2gtk-4.1-dev',
    ])
  },
)

test.skipIf(!supported)('propagates update failure and never starts package installation', () => {
  const result = runInstallation({ updateStatus: 100 })
  expect(result.status, result.output).toBe(100)
  expect(result.calls).toEqual(['update'])
})

test.skipIf(!supported)('propagates package installation failure without retrying', () => {
  const result = runInstallation({ installStatus: 100 })
  expect(result.status, result.output).toBe(100)
  expect(result.calls).toEqual([
    'update',
    'install -y build-essential pkg-config libwebkit2gtk-4.1-dev',
  ])
})

test.skipIf(!supported)('propagates source configuration failure before running APT', () => {
  const result = runInstallation({ privilegeStatus: 31 })
  expect(result.status, result.output).toBe(31)
  expect(result.calls).toEqual([])
})

test.skipIf(!supported)('propagates a missing runner mirror list before running APT', () => {
  const result = runInstallation({ mirrorFile: false })
  expect(result.status, result.output).toBe(2)
  expect(result.calls).toEqual([])
})

test.skipIf(!supported)('propagates a canceled update before running installation', () => {
  const result = runInstallation({ signal: true })
  expect(result.status, result.output).toBe(143)
  expect(result.calls).toEqual(['update'])
})

test('CI invokes the verified action before the original native build', () => {
  const workflow: unknown = Bun.YAML.parse(
    readFileSync(path.join(import.meta.dirname, '../../workflows/ci.yml'), 'utf8'),
  )
  expect(isRecord(workflow)).toBe(true)
  if (!isRecord(workflow) || !isRecord(workflow.jobs) || !isRecord(workflow.jobs.typecheck)) return
  const job = workflow.jobs.typecheck
  expect(job['timeout-minutes']).toBe(20)
  expect(Array.isArray(job.steps)).toBe(true)
  if (!Array.isArray(job.steps)) return
  const steps: unknown[] = job.steps
  const index = steps.findIndex(
    (step) => isRecord(step) && step.name === 'Install Linux webview build dependencies',
  )
  const install = steps[index]
  const build = steps[index + 1]
  expect(isRecord(install) && install.uses).toBe('./.github/actions/linux-webview-deps')
  expect(isRecord(build) && build.run).toBe('bun run --cwd apps/desktop build:native')
  const action: unknown = Bun.YAML.parse(
    readFileSync(path.join(import.meta.dirname, 'action.yml'), 'utf8'),
  )
  expect(isRecord(action) && isRecord(action.runs) && Array.isArray(action.runs.steps)).toBe(true)
  if (!isRecord(action) || !isRecord(action.runs) || !Array.isArray(action.runs.steps)) return
  const verify: unknown = action.runs.steps[0]
  expect(isRecord(verify) && verify.run).toBe(
    'bun --bun vitest run "$GITHUB_ACTION_PATH/action.test.ts" --environment node',
  )
})
