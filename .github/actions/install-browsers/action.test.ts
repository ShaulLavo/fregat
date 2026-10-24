import { expect, test } from 'vitest'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

function actionStep(name: string) {
  const action: unknown = Bun.YAML.parse(
    readFileSync(path.join(import.meta.dirname, 'action.yml'), 'utf8'),
  )
  if (!action || typeof action !== 'object' || !('runs' in action)) return undefined
  const runs = action.runs
  if (!runs || typeof runs !== 'object' || !('steps' in runs) || !Array.isArray(runs.steps))
    return undefined
  const steps: unknown[] = runs.steps
  return steps.find(
    (step) => step && typeof step === 'object' && 'name' in step && step.name === name,
  )
}

function actionScript(name: string) {
  const step = actionStep(name)
  if (!step || typeof step !== 'object' || !('run' in step) || typeof step.run !== 'string')
    return expect.fail(`Missing action script: ${name}`)
  return step.run
}

const setup = actionScript('Configure Ubuntu package downloads')
const supported = process.platform === 'linux' && Bun.which('bash') !== null
if (!supported)
  console.info('Skipping Ubuntu package source setup tests. Linux and Bash are required.')

for (const cached of [false, true]) {
  test.skipIf(!supported)(
    `Ubuntu source selection with ${cached ? 'warm' : 'cold'} archives`,
    () => {
      const root = mkdtempSync(path.join(tmpdir(), 'browser-apt-'))
      const apt = path.join(root, 'apt')
      const archives = path.join(root, 'archives')
      const output = path.join(root, 'output')
      mkdirSync(path.join(apt, 'apt.conf.d'), { recursive: true })
      mkdirSync(archives)
      writeFileSync(
        path.join(apt, 'apt-mirrors.txt'),
        'http://azure.archive.ubuntu.com/ubuntu/\tpriority:1\n' +
          'https://archive.ubuntu.com/ubuntu/\tpriority:2\n' +
          'https://security.ubuntu.com/ubuntu/\tpriority:3\n',
      )
      if (cached) writeFileSync(path.join(archives, 'dependency.deb'), 'cached dependency')
      const playwright = path.join(root, 'playwright')
      writeFileSync(playwright, '#!/usr/bin/env bash\nprintf "Version 1.63.0\\n"\n', {
        mode: 0o755,
      })
      // Only privilege and ownership operations are replaced; the action's source commands run in Bash.
      const privilege = `sudo() {
      if [ "$1" = '-u' ]; then shift 2; fi
      if [ "$1" = 'install' ]; then
        shift
        local args=()
        while [ "$#" -gt 0 ]; do
          case "$1" in
            -o|-g) shift 2 ;;
            *) args+=("$1"); shift ;;
          esac
        done
        command install "\${args[@]}"
        return
      fi
      "$@"
    }
`
      try {
        const script = setup.replaceAll('/etc/apt', apt).replaceAll('/tmp/playwright-apt', archives)
        const result = Bun.spawnSync(['bash', '-c', privilege + script], {
          env: {
            ...process.env,
            PLAYWRIGHT: playwright,
            BROWSERS: 'chromium',
            ImageOS: 'ubuntu24',
            ImageVersion: 'fixture',
            RUNNER_ARCH: 'X64',
            GITHUB_OUTPUT: output,
          },
          timeout: 5_000,
        })
        expect(result.exitCode, result.stderr.toString()).toBe(0)
        expect(readFileSync(path.join(apt, 'apt-mirrors.txt'), 'utf8')).toBe(
          'https://archive.ubuntu.com/ubuntu/\tpriority:2\n' +
            'https://security.ubuntu.com/ubuntu/\tpriority:3\n',
        )
        expect(readFileSync(output, 'utf8')).toMatch(
          /^key=browser-apt-v3-ubuntu24-fixture-X64-1\.63\.0-/,
        )
        expect(readFileSync(path.join(apt, 'apt.conf.d/99-playwright-cache'), 'utf8')).toContain(
          `Dir::Cache::archives "${archives}";`,
        )
        if (cached) {
          expect(readFileSync(path.join(archives, 'dependency.deb'), 'utf8')).toBe(
            'cached dependency',
          )
        }
      } finally {
        rmSync(root, { recursive: true, force: true })
      }
    },
  )
}

function payloadFixture() {
  const root = mkdtempSync(path.join(tmpdir(), 'browser-payload-'))
  const cache = path.join(root, 'browser payloads')
  const output = path.join(root, 'output')
  const playwright = path.join(root, 'playwright')
  writeFileSync(
    playwright,
    `#!/usr/bin/env bun
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
const args = process.argv.slice(2)
const dry = args[1] === '--dry-run'
const names = args.slice(2)
if (!dry && args[1] !== '--with-deps') process.exit(2)
if (names.some(name => !['chromium', 'chromium-headless-shell', 'firefox', 'webkit'].includes(name))) process.exit(3)
const selected = new Set(names.length ? names : ['chromium', 'firefox', 'webkit'])
const plan = names.length ? 'requested' : 'full'
const malformed = process.env.MALFORMED_PLAN === plan ? process.env.MALFORMED_FIELD : undefined
const payloads = [
  ['chromium', process.env.CHROMIUM_REVISION ?? '1243', selected.has('chromium')],
  ['chromium_headless_shell', process.env.CHROMIUM_REVISION ?? '1243', selected.has('chromium') || selected.has('chromium-headless-shell')],
  ['ffmpeg', '1011', true],
  ['firefox', '1543', selected.has('firefox')],
  ['webkit', '2359', selected.has('webkit')],
]
for (const [name, revision, requested] of payloads) {
  if (!requested) continue
  const directory = path.join(process.env.PLAYWRIGHT_BROWSERS_PATH, name + '-' + revision)
  if (dry) {
    console.log(name + ' (playwright ' + name + ' v' + revision + ')')
    if (malformed !== 'missing-location') console.log('  Install location:    ' + (malformed === 'empty-location' ? '' : directory))
    if (malformed !== 'missing-url') console.log('  Download url:        ' + (malformed === 'empty-url' ? '' : 'https://fixture.invalid/' + process.env.FIXTURE_PLATFORM + '/' + name + '-' + revision + '.zip'))
    continue
  }
  const marker = path.join(directory, 'INSTALLATION_COMPLETE')
  if (existsSync(marker)) continue
  mkdirSync(directory, { recursive: true })
  writeFileSync(marker, 'installed')
  console.log('downloaded ' + name + '-' + revision)
}
`,
    { mode: 0o755 },
  )
  const env = {
    ...process.env,
    PLAYWRIGHT: playwright,
    PLAYWRIGHT_BROWSERS_PATH: cache,
    RUNNER_OS: 'Linux',
    RUNNER_ARCH: 'X64',
    FIXTURE_PLATFORM: 'ubuntu24-x64',
    GITHUB_OUTPUT: output,
  }
  function attempt(
    browsers: string,
    overrides: Record<string, string | undefined> = {},
    prelude = '',
  ) {
    writeFileSync(output, '')
    const result = runPayloadScript(prelude + actionScript('Resolve Playwright payload cache'), {
      ...env,
      ...overrides,
      BROWSERS: browsers,
    })
    return { ...result, cacheOutputs: readFileSync(output, 'utf8') }
  }
  function resolve(browsers: string, overrides: Record<string, string | undefined> = {}) {
    const result = attempt(browsers, overrides)
    expect(result.status, result.output).toBe(0)
    return Object.fromEntries(
      result.cacheOutputs
        .trim()
        .split('\n')
        .map((line) => {
          const separator = line.indexOf('=')
          return [line.slice(0, separator), line.slice(separator + 1)]
        }),
    )
  }
  function install(browsers: string) {
    const result = runPayloadScript(actionScript('Install Playwright browsers and dependencies'), {
      ...env,
      BROWSERS: browsers,
    })
    expect(result.status, result.output).toBe(0)
    return result.output.trim().split('\n').filter(Boolean)
  }
  return { root, cache, env, attempt, resolve, install }
}

function runPayloadScript(script: string, env: Record<string, string | undefined>) {
  const result = Bun.spawnSync(
    ['bash', '--noprofile', '--norc', '-e', '-o', 'pipefail', '-c', script],
    { env, timeout: 5_000 },
  )
  return { status: result.exitCode, output: result.stdout.toString() + result.stderr.toString() }
}

test.skipIf(!supported)(
  'payload cache resolves its directory and shares revisions across overlapping requests',
  () => {
    const fixture = payloadFixture()
    try {
      const chromium = fixture.resolve('chromium')
      const all = fixture.resolve('chromium chromium-headless-shell firefox webkit')
      const reordered = fixture.resolve('webkit firefox chromium-headless-shell chromium')
      expect(chromium.path).toBe(fixture.cache)
      expect(chromium.prefix).toBe(all.prefix)
      expect(chromium.key).not.toBe(all.key)
      expect(all).toEqual(reordered)
      expect(chromium.key.startsWith(chromium.prefix)).toBe(true)
      const relocated = fixture.resolve('chromium', {
        PLAYWRIGHT_BROWSERS_PATH: path.join(fixture.root, 'elsewhere'),
      })
      expect(relocated.key).toBe(chromium.key)
      expect(relocated.path).not.toBe(chromium.path)
    } finally {
      rmSync(fixture.root, { recursive: true, force: true })
    }
  },
)

test
  .skipIf(!supported)
  .each([
    { RUNNER_OS: 'Windows' },
    { RUNNER_ARCH: 'ARM64' },
    { FIXTURE_PLATFORM: 'ubuntu22-x64' },
    { CHROMIUM_REVISION: '1244' },
  ])('payload keys invalidate for the resolved platform and revisions: %j', (overrides) => {
  const fixture = payloadFixture()
  try {
    const initial = fixture.resolve('chromium')
    const changed = fixture.resolve('chromium', overrides)
    expect(changed.key).not.toBe(initial.key)
    expect(changed.prefix).not.toBe(initial.prefix)
  } finally {
    rmSync(fixture.root, { recursive: true, force: true })
  }
})

test.skipIf(!supported)(
  'cold, warm, overlapping and partial payloads retain every requested browser',
  () => {
    const fixture = payloadFixture()
    try {
      expect(fixture.install('chromium')).toEqual([
        'downloaded chromium-1243',
        'downloaded chromium_headless_shell-1243',
        'downloaded ffmpeg-1011',
      ])
      expect(fixture.install('chromium')).toEqual([])
      expect(fixture.install('chromium chromium-headless-shell firefox webkit')).toEqual([
        'downloaded firefox-1543',
        'downloaded webkit-2359',
      ])
      expect(fixture.install('chromium chromium-headless-shell firefox webkit')).toEqual([])
      rmSync(path.join(fixture.cache, 'webkit-2359/INSTALLATION_COMPLETE'))
      expect(fixture.install('chromium firefox webkit')).toEqual(['downloaded webkit-2359'])
      expect(fixture.install('chromium-headless-shell')).toEqual([])
    } finally {
      rmSync(fixture.root, { recursive: true, force: true })
    }
  },
)

test.skipIf(!supported).each(['', 'unknown-browser'])(
  'invalid browser requests fail before restoring a cache: %j',
  (browsers) => {
    const fixture = payloadFixture()
    try {
      const result = runPayloadScript(actionScript('Resolve Playwright payload cache'), {
        ...fixture.env,
        BROWSERS: browsers,
      })
      expect(result.status).not.toBe(0)
    } finally {
      rmSync(fixture.root, { recursive: true, force: true })
    }
  },
)

test.skipIf(!supported).each(
  ['full', 'requested'].flatMap((plan) =>
    ['missing-url', 'empty-url', 'missing-location', 'empty-location'].map((field) => ({
      plan,
      field,
    })),
  ),
)('incomplete $plan plan rejects $field before writing cache outputs', ({ plan, field }) => {
  const fixture = payloadFixture()
  try {
    fixture.resolve('chromium')
    const result = fixture.attempt('chromium', {
      MALFORMED_PLAN: plan,
      MALFORMED_FIELD: field,
    })
    expect(result.status, result.output).not.toBe(0)
    expect(result.cacheOutputs).toBe('')
  } finally {
    rmSync(fixture.root, { recursive: true, force: true })
  }
})

function pipelineControl(tool: string, empty = false) {
  return `${tool}() {
  local count=0
  if test -f "$PIPELINE_COUNTER"; then read -r count < "$PIPELINE_COUNTER"; fi
  count=$((count + 1))
  command printf '%s\\n' "$count" > "$PIPELINE_COUNTER"
  if test "$count" -eq "$FAIL_CALL"; then
    command ${tool} "$@"${empty ? ' > /dev/null' : ''}
    return ${empty ? 0 : 79}
  fi
  command ${tool} "$@"
}
`
}

const extractionCalls = [
  { tool: 'printf', calls: 8 },
  { tool: 'sed', calls: 5 },
  { tool: 'sort', calls: 5 },
  { tool: 'sha256sum', calls: 2 },
  { tool: 'cut', calls: 2 },
  { tool: 'dirname', calls: 1 },
  { tool: 'wc', calls: 1 },
].flatMap(({ tool, calls }) =>
  Array.from({ length: calls }, (_, index) => ({ tool, call: index + 1 })),
)

test.skipIf(!supported).each(extractionCalls)(
  'extraction failure from $tool call $call propagates before cache outputs',
  ({ tool, call }) => {
    const fixture = payloadFixture()
    try {
      const expected = fixture.attempt('chromium')
      expect(expected.status, expected.output).toBe(0)
      const counter = path.join(fixture.root, 'pipeline-counter')
      const env = { PIPELINE_COUNTER: counter, FAIL_CALL: '0' }
      const healthy = fixture.attempt('chromium', env, pipelineControl(tool))
      expect(healthy.status, healthy.output).toBe(0)
      expect(healthy.cacheOutputs).toBe(expected.cacheOutputs)
      rmSync(counter)
      const failed = fixture.attempt(
        'chromium',
        { ...env, FAIL_CALL: String(call) },
        pipelineControl(tool),
      )
      expect(failed.status, failed.output).toBe(79)
      expect(failed.cacheOutputs).toBe('')
    } finally {
      rmSync(fixture.root, { recursive: true, force: true })
    }
  },
)

test.skipIf(!supported).each([1, 2])(
  'empty fingerprint from hash call %i rejects cache outputs',
  (call) => {
    const fixture = payloadFixture()
    try {
      fixture.resolve('chromium')
      const result = fixture.attempt(
        'chromium',
        { PIPELINE_COUNTER: path.join(fixture.root, 'pipeline-counter'), FAIL_CALL: String(call) },
        pipelineControl('sha256sum', true),
      )
      expect(result.status, result.output).not.toBe(0)
      expect(result.cacheOutputs).toBe('')
    } finally {
      rmSync(fixture.root, { recursive: true, force: true })
    }
  },
)

test.skipIf(!supported)('empty cache parent rejects cache outputs', () => {
  const fixture = payloadFixture()
  try {
    fixture.resolve('chromium')
    const result = fixture.attempt(
      'chromium',
      {},
      'dirname() { command dirname "$@" > /dev/null; }\n',
    )
    expect(result.status, result.output).not.toBe(0)
    expect(result.cacheOutputs).toBe('')
  } finally {
    rmSync(fixture.root, { recursive: true, force: true })
  }
})

test.skipIf(!supported)(
  'cache resolution matches the installed workspace Playwright dry run',
  () => {
    const root = mkdtempSync(path.join(tmpdir(), 'browser-resolved-'))
    try {
      const output = path.join(root, 'output')
      const cache = path.join(root, 'resolved payloads')
      const result = runPayloadScript(actionScript('Resolve Playwright payload cache'), {
        ...process.env,
        PLAYWRIGHT: path.resolve(
          import.meta.dirname,
          '../../../apps/web/node_modules/.bin/playwright',
        ),
        BROWSERS: 'chromium firefox webkit',
        PLAYWRIGHT_BROWSERS_PATH: cache,
        RUNNER_OS: 'Linux',
        RUNNER_ARCH: 'X64',
        GITHUB_OUTPUT: output,
      })
      expect(result.status, result.output).toBe(0)
      expect(readFileSync(output, 'utf8')).toContain(`path=${cache}\n`)
      expect(readFileSync(output, 'utf8')).toMatch(
        /key=playwright-payloads-v1-Linux-X64-[a-f0-9]{64}-[a-f0-9]{64}/,
      )
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  },
)

test('one shared payload cache owner always checks browser and APT installation on hits', () => {
  expect(actionStep('Restore Playwright payloads')).toMatchObject({
    id: 'payload-cache',
    uses: 'actions/cache/restore@v4',
    with: {
      path: '${{ steps.payloads.outputs.path }}',
      key: '${{ steps.payloads.outputs.key }}',
      'restore-keys': '${{ steps.payloads.outputs.prefix }}',
    },
  })
  expect(actionStep('Install Playwright browsers and dependencies')).not.toHaveProperty('if')
  expect(actionStep('Save Playwright payloads')).toMatchObject({
    if: "${{ steps.payload-cache.outputs.cache-hit != 'true' }}",
    uses: 'actions/cache/save@v4',
    with: { path: '${{ steps.payloads.outputs.path }}', key: '${{ steps.payloads.outputs.key }}' },
  })
  expect(actionStep('Restore Ubuntu dependency archives')).toMatchObject({
    uses: 'actions/cache/restore@v4',
    with: { path: '/tmp/playwright-apt/*.deb' },
  })
  const ci = readFileSync(path.resolve(import.meta.dirname, '../../workflows/ci.yml'), 'utf8')
  expect(ci).not.toContain('path: ~/.cache/ms-playwright')
  expect(ci).toContain(
    "browsers: ${{ needs.changes.outputs.tooling == 'true' && 'chromium webkit' || 'chromium' }}",
  )
  expect(ci).toContain(
    "browsers: ${{ startsWith(matrix.shard, 'webkit') && 'webkit' || 'chromium' }}",
  )
})
