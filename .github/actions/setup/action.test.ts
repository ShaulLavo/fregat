import { expect, test } from 'vitest'
import { readdirSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

function installScript() {
  const action: unknown = Bun.YAML.parse(
    readFileSync(path.join(import.meta.dirname, 'action.yml'), 'utf8'),
  )
  expect(action).toBeTypeOf('object')
  if (!action || typeof action !== 'object' || !('runs' in action)) return ''
  const runs = action.runs
  if (!runs || typeof runs !== 'object' || !('steps' in runs) || !Array.isArray(runs.steps))
    return ''
  const steps: unknown[] = runs.steps
  const install = steps.find(
    (step) =>
      step && typeof step === 'object' && 'name' in step && step.name === 'Install dependencies',
  )
  if (
    !install ||
    typeof install !== 'object' ||
    !('run' in install) ||
    typeof install.run !== 'string'
  )
    return ''
  return install.run
}

const download =
  'error: failed to download @opentui/react@https://github.com/ShaulLavo/bubli/releases/download/v0.5.12-bubli.2/opentui-react-0.5.12-bubli.2.tgz: HTTP 5xx'
const supported = ['bash', 'git', 'tar'].every((tool) => Bun.which(tool) !== null)
if (!supported)
  console.info('Skipping dependency installation tests. Bash, Git, and tar are required.')

function runInstall({
  output,
  failures = 1,
  status = 1,
  finalStatus = 0,
  finalOutput = '',
  signal = false,
  loggingStatus = 0,
  preflight = 'none',
}: {
  output: string
  failures?: number
  status?: number
  finalStatus?: number
  finalOutput?: string
  signal?: boolean
  loggingStatus?: number
  preflight?: 'none' | 'dirty' | 'untracked' | 'ignored' | 'archive' | 'cache'
}) {
  const root = mkdtempSync(path.join(tmpdir(), 'setup-install-'))
  try {
    writeFileSync(path.join(root, 'failure'), output)
    writeFileSync(path.join(root, 'package.json'), '{}')
    writeFileSync(path.join(root, '.gitignore'), 'node_modules/\n.npmrc\n')
    writeFileSync(path.join(root, 'final-output'), finalOutput)
    writeFileSync(
      path.join(root, 'bun'),
      `#!/usr/bin/env bash
set -euo pipefail
if [[ "$*" == 'pm cache' ]]; then printf '%s\\n' "$RUNNER_TEMP/cache"; exit ${preflight === 'cache' ? 79 : 0}; fi
cd "$RUNNER_TEMP"
printf '%s\\n' "$*" >> calls
count=$(wc -l < calls)
if [[ "$*" == 'install --frozen-lockfile' ]]; then
  cat final-output >&2
  exit ${finalStatus}
fi
if [[ "$count" -le ${failures} ]]; then
  printf 'bun install v1.4.2 (744846f84)\\nResolving dependencies\\n'
  cat failure >&2
  printf 'partial install' > installed
  if ${signal}; then kill -TERM "$$"; fi
  exit ${status}
fi
[[ -f installed ]] && [[ "$(cat installed)" == 'partial install' ]]
printf 'Installed dependencies\\n'
`,
      { mode: 0o755 },
    )
    writeFileSync(
      path.join(root, 'sleep'),
      '#!/usr/bin/env bash\nprintf "%s\\n" "$*" >> sleeps\n',
      { mode: 0o755 },
    )
    if (loggingStatus !== 0)
      writeFileSync(path.join(root, 'tee'), `#!/usr/bin/env bash\ncat\nexit ${loggingStatus}\n`, {
        mode: 0o755,
      })
    trackFixture(root)
    if (preflight === 'dirty') writeFileSync(path.join(root, 'package.json'), '{"name":"changed"}')
    if (preflight === 'untracked') writeFileSync(path.join(root, 'bunfig.toml'), '[install]\n')
    if (preflight === 'ignored')
      writeFileSync(path.join(root, '.npmrc'), 'registry=http://fixture.invalid\n')
    if (preflight === 'archive')
      writeFileSync(
        path.join(root, 'git'),
        '#!/usr/bin/env bash\nif [[ "$1" == archive ]]; then exit 87; fi\nexec ' +
          shellQuote(Bun.which('git') ?? 'git') +
          ' "$@"\n',
        { mode: 0o755 },
      )
    const script = installScript()
    expect(script).not.toBe('')
    const result = Bun.spawnSync(
      ['bash', '--noprofile', '--norc', '-e', '-o', 'pipefail', '-c', script],
      {
        cwd: root,
        env: { ...process.env, PATH: root + path.delimiter + process.env.PATH, RUNNER_TEMP: root },
        timeout: 5_000,
      },
    )
    expect(readdirSync(root).filter((name) => /^bun-(prepare|install)\./.test(name))).toEqual([])
    return {
      status: result.exitCode,
      output: result.stdout.toString() + result.stderr.toString(),
      calls: readFileSync(path.join(root, 'calls'), { encoding: 'utf8', flag: 'a+' })
        .trim()
        .split('\n')
        .filter(Boolean)
        .map((call) => call.replaceAll(root, '<fixture>')),
      sleeps: readFileSync(path.join(root, 'sleeps'), { encoding: 'utf8', flag: 'a+' })
        .trim()
        .split('\n')
        .filter(Boolean),
    }
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

test.skipIf(!supported)('recovers from the observed GitHub release HTTP 5xx', () => {
  const result = runInstall({ output: download })
  expect(result.status, result.output).toBe(0)
  expect(result.calls).toEqual([
    'install --frozen-lockfile --ignore-scripts --cache-dir <fixture>/cache',
    'install --frozen-lockfile --ignore-scripts --cache-dir <fixture>/cache',
    'install --frozen-lockfile',
  ])
  expect(result.output).toContain(download)
  expect(result.output).toContain('Installed dependencies')
  expect(result.sleeps).toEqual(['2'])
})

test.skipIf(!supported)('succeeds without retrying an ordinary successful install', () => {
  const result = runInstall({ output: '', failures: 0 })
  expect(result.status, result.output).toBe(0)
  expect(result.calls).toEqual([
    'install --frozen-lockfile --ignore-scripts --cache-dir <fixture>/cache',
    'install --frozen-lockfile',
  ])
  expect(result.sleeps).toEqual([])
})

test.skipIf(!supported)('bounds repeated download failures and preserves their exit status', () => {
  const result = runInstall({ output: download, failures: 10, status: 7 })
  expect(result.status, result.output).toBe(7)
  expect(result.calls).toEqual(
    Array(6).fill('install --frozen-lockfile --ignore-scripts --cache-dir <fixture>/cache'),
  )
  expect(result.sleeps).toEqual(['2', '4', '8', '16', '32'])
  expect(result.output.split(download)).toHaveLength(7)
})

const failures = [
  'error: lockfile had changes, but lockfile is frozen',
  'error: No version matching "missing" found for specifier "package"',
  'error: Integrity check failed for tarball',
  'error: postinstall script from "package" exited with 1',
  download.replace('HTTP 5xx', 'HTTP 401'),
  download.replace('HTTP 5xx', 'HTTP 403'),
  download.replace('HTTP 5xx', 'HTTP 404'),
  download.replace('HTTP 5xx', 'HTTP 429'),
  download.replace('failed to download', 'failed to resolve'),
  download.replace('github.com', 'registry.npmjs.org'),
  download.replace('.tgz:', '.zip:'),
  'error: failed to download package: ConnectionRefused',
  download + '\nerror: Integrity check failed for another tarball',
  download + '\n$ postinstall\ncommand failed',
  download + '\nunknown diagnostic',
  '',
]

for (const output of failures) {
  test.skipIf(!supported)(`stops immediately for ${output || 'an unexplained failure'}`, () => {
    const result = runInstall({ output, status: 23 })
    expect(result.status, result.output).toBe(23)
    expect(result.calls).toEqual([
      'install --frozen-lockfile --ignore-scripts --cache-dir <fixture>/cache',
    ])
    expect(result.sleeps).toEqual([])
    expect(result.output).toContain(output)
  })
}

for (const finalOutput of ['error: postinstall script failed', download]) {
  test.skipIf(!supported)(`propagates the final install failure once: ${finalOutput}`, () => {
    const result = runInstall({ output: download, finalOutput, finalStatus: 42 })
    expect(result.status, result.output).toBe(42)
    expect(result.output).toContain(finalOutput)
    expect(result.calls).toEqual([
      'install --frozen-lockfile --ignore-scripts --cache-dir <fixture>/cache',
      'install --frozen-lockfile --ignore-scripts --cache-dir <fixture>/cache',
      'install --frozen-lockfile',
    ])
    expect(result.sleeps).toEqual(['2'])
  })
}

test.skipIf(!supported)('accepts the surrounding output from the failed CI installation', () => {
  const result = runInstall({
    output:
      download +
      '\n  https://github.com/ShaulLavo/bubli/releases/download/v0.5.12-bubli.2/opentui-react-0.5.12-bubli.2.tgz\n\n+ vitest@5.0.2\n\n1108 packages installed [6.41s]\nFailed to install 1 package',
  })
  expect(result.status, result.output).toBe(0)
  expect(result.calls).toHaveLength(3)
})

function shellQuote(value: string) {
  return "'" + value.replaceAll("'", "'\\''") + "'"
}

async function runBash(script: string, root: string, env: Record<string, string | undefined>) {
  const child = Bun.spawn(['bash', '--noprofile', '--norc', '-e', '-o', 'pipefail', '-c', script], {
    cwd: root,
    env,
    stdout: 'pipe',
    stderr: 'pipe',
    timeout: 10_000,
  })
  const [status, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ])
  return { status, output: stdout + stderr }
}

const realSupported = supported && Bun.which('tar') !== null
if (!realSupported) console.info('Skipping real Bun lifecycle controls. Bash and tar are required.')

async function lifecycleFixture(mode: 'cold' | 'healthy' | 'warm' | 'workspace') {
  const warm = mode === 'warm'
  const workspace = mode === 'workspace'
  const healthy = mode === 'healthy'
  const root = mkdtempSync(path.join(tmpdir(), 'setup-lifecycle-'))
  let failing = false
  let scriptsAtRecovery = ''
  const archive = path.join(root, 'bad.tgz')
  const goodArchive = path.join(root, 'good.tgz')
  const scriptLog = path.join(root, 'scripts.log')
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch(request) {
      if (new URL(request.url).pathname === '/recover') {
        scriptsAtRecovery = readFileSync(scriptLog, { encoding: 'utf8', flag: 'a+' })
        failing = false
        return new Response('recovered')
      }
      if (new URL(request.url).pathname === '/good.tgz') return new Response(Bun.file(goodArchive))
      return failing
        ? new Response('unavailable', { status: 503 })
        : new Response(Bun.file(archive))
    },
  })
  try {
    const url = `http://127.0.0.1:${server.port}/bad.tgz`
    const seed = path.join(root, 'seed')
    const install = path.join(root, 'install')
    mkdirSync(path.join(root, 'package'))
    writeFileSync(
      path.join(root, 'package/package.json'),
      JSON.stringify({ name: 'bad', version: '1.0.0' }),
    )
    const tar = Bun.spawnSync(['tar', '-czf', archive, 'package'], { cwd: root })
    expect(tar.exitCode, tar.stderr.toString()).toBe(0)
    const script = (name: string) =>
      shellQuote(process.execPath) +
      ' -e ' +
      shellQuote(`require('node:fs').appendFileSync(process.env.FIXTURE_SCRIPT_LOG, '${name}\\n')`)
    const manifest = JSON.stringify({
      name: 'fixture',
      dependencies: {
        good: `http://127.0.0.1:${server.port}/good.tgz`,
        bad: url,
        ...(workspace ? { linked: 'workspace:*' } : {}),
      },
      ...(workspace ? { workspaces: ['packages/*'] } : {}),
      trustedDependencies: ['good'],
      scripts: {
        postinstall:
          shellQuote(process.execPath) +
          ' -e ' +
          shellQuote(
            (workspace ? "if (require('linked') !== 42) process.exit(9); " : '') +
              "require('node:fs').appendFileSync(process.env.FIXTURE_SCRIPT_LOG, 'root\\n')",
          ),
      },
    })
    for (const directory of [seed, install]) {
      mkdirSync(path.join(directory, 'packages/linked'), { recursive: true })
      writeFileSync(
        path.join(directory, 'packages/linked/package.json'),
        JSON.stringify({ name: 'linked', version: '1.0.0', main: 'index.js' }),
      )
      writeFileSync(path.join(directory, 'packages/linked/index.js'), 'module.exports = 42\n')
      writeFileSync(path.join(directory, 'bunfig.toml'), '[install]\nglobalStore = false\n')
      writeFileSync(path.join(directory, '.npmrc'), `registry=http://127.0.0.1:${server.port}/\n`)
      writeFileSync(path.join(directory, 'package.json'), manifest)
      writeFileSync(path.join(directory, '.gitignore'), 'node_modules/\n')
    }
    mkdirSync(path.join(root, 'good-package/package'), { recursive: true })
    writeFileSync(
      path.join(root, 'good-package/package/package.json'),
      JSON.stringify({ name: 'good', version: '1.0.0', scripts: { postinstall: script('good') } }),
    )
    const goodTar = Bun.spawnSync(['tar', '-czf', goodArchive, 'package'], {
      cwd: path.join(root, 'good-package'),
    })
    expect(goodTar.exitCode, goodTar.stderr.toString()).toBe(0)
    const env = {
      ...process.env,
      FIXTURE_SCRIPT_LOG: scriptLog,
      BUN_INSTALL_CACHE_DIR: path.join(root, 'seed-cache'),
    }
    const initial = await runBash(shellQuote(process.execPath) + ' install', seed, env)
    expect(initial.status, initial.output).toBe(0)
    expect(readFileSync(scriptLog, 'utf8')).toBe('good\nroot\n')
    writeFileSync(path.join(install, 'bun.lock'), readFileSync(path.join(seed, 'bun.lock')))
    env.BUN_INSTALL_CACHE_DIR = path.join(root, 'install-cache')
    trackFixture(install)
    // This external Bun adapter translates the fixture URL into the GitHub release diagnostic.
    const adapter = path.join(root, 'bun-adapter.ts')
    writeFileSync(
      adapter,
      `import { appendFileSync, existsSync, readFileSync } from 'node:fs'
const args = process.argv.slice(2)
if (args[0] === 'install') appendFileSync(${JSON.stringify(path.join(root, 'calls'))}, args.join(' ').replaceAll(${JSON.stringify(root)}, '<fixture>') + '\\n')
const child = Bun.spawn([${JSON.stringify(process.execPath)}, ...args], { stdout: 'pipe', stderr: 'pipe' })
const [status, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()])
const output = stdout + stderr
if (args.includes('--ignore-scripts')) {
  const configEqual = ['bunfig.toml', '.npmrc', 'bun.lock', 'package.json', 'packages/linked/package.json', 'packages/linked/index.js'].every(file => readFileSync(file, 'utf8') === readFileSync(${JSON.stringify(install)} + '/' + file, 'utf8'))
  appendFileSync(${JSON.stringify(path.join(root, 'prep-state'))}, [process.cwd() === ${JSON.stringify(install)}, existsSync(${JSON.stringify(path.join(install, 'node_modules'))}), configEqual].join(' ') + '\\n')
}
appendFileSync(${JSON.stringify(path.join(root, 'raw-output'))}, output)
process.stdout.write(output.replaceAll(${JSON.stringify(url)}, 'https://github.com/fixture/packages/releases/download/v1/bad.tgz'))
if (status !== 0 && args.includes('--ignore-scripts')) await fetch(${JSON.stringify(`http://127.0.0.1:${server.port}/recover`)})
process.exit(status)
`,
    )
    writeFileSync(
      path.join(root, 'bun'),
      '#!/usr/bin/env bash\nexec ' +
        shellQuote(process.execPath) +
        ' ' +
        shellQuote(adapter) +
        ' "$@"\n',
      { mode: 0o755 },
    )
    writeFileSync(path.join(root, 'sleep'), '#!/usr/bin/env bash\nexit 0\n', { mode: 0o755 })
    const actionEnv = { ...env, PATH: root + path.delimiter + process.env.PATH, RUNNER_TEMP: root }
    if (warm) {
      const first = await runBash(
        shellQuote(process.execPath) + ' install --frozen-lockfile',
        install,
        env,
      )
      expect(first.status, first.output).toBe(0)
      writeFileSync(scriptLog, '')
      const baseline = await runBash(
        shellQuote(process.execPath) + ' install --frozen-lockfile',
        install,
        env,
      )
      expect(baseline.status, baseline.output).toBe(0)
      const baselineScripts = readFileSync(scriptLog, 'utf8')
      writeFileSync(scriptLog, '')
      const result = await runBash(installScript(), install, actionEnv)
      expect(result.status, result.output).toBe(0)
      expect(readFileSync(scriptLog, 'utf8')).toBe(baselineScripts)
      expect(readFileSync(path.join(root, 'prep-state'), 'utf8')).toBe('false true true\n')
      expect(readFileSync(path.join(install, 'bun.lock'), 'utf8')).toBe(
        readFileSync(path.join(seed, 'bun.lock'), 'utf8'),
      )
      expect(readdirSync(root).filter((name) => /^bun-(prepare|install)\./.test(name))).toEqual([])
      expect(readFileSync(path.join(root, 'calls'), 'utf8').trim().split('\n')).toEqual([
        'install --frozen-lockfile --ignore-scripts --cache-dir <fixture>/install-cache',
        'install --frozen-lockfile',
      ])
      return
    }
    writeFileSync(scriptLog, '')
    failing = !healthy
    const result = await runBash(installScript(), install, actionEnv)
    expect(result.status, result.output).toBe(0)
    const raw = readFileSync(path.join(root, 'raw-output'), 'utf8')
    if (!healthy)
      expect(
        raw.includes(`error: failed to download bad@${url}: HTTP 5xx`) ||
          raw.includes(`error: GET ${url} - 503`),
        raw,
      ).toBe(true)
    expect(scriptsAtRecovery).toBe('')
    expect(readFileSync(scriptLog, 'utf8')).toBe('good\nroot\n')
    expect(readFileSync(path.join(root, 'prep-state'), 'utf8')).toBe(
      healthy ? 'false false true\n' : 'false false true\nfalse false true\n',
    )
    expect(readFileSync(path.join(install, 'bun.lock'), 'utf8')).toBe(
      readFileSync(path.join(seed, 'bun.lock'), 'utf8'),
    )
    expect(readdirSync(root).filter((name) => /^bun-(prepare|install)\./.test(name))).toEqual([])
    expect(readFileSync(path.join(root, 'calls'), 'utf8').trim().split('\n')).toEqual([
      ...(!healthy
        ? ['install --frozen-lockfile --ignore-scripts --cache-dir <fixture>/install-cache']
        : []),
      'install --frozen-lockfile --ignore-scripts --cache-dir <fixture>/install-cache',
      'install --frozen-lockfile',
    ])
  } finally {
    server.stop(true)
    rmSync(root, { recursive: true, force: true })
  }
}

test.skipIf(!realSupported)(
  'real Bun cold recovery defers trusted and root lifecycle scripts until the final install',
  async () => {
    await lifecycleFixture('cold')
  },
)

test.skipIf(!realSupported)(
  'real Bun warm preparation preserves normal lifecycle behavior',
  async () => {
    await lifecycleFixture('warm')
  },
)

test.skipIf(!supported)('preserves a signaled preparation failure without retrying', () => {
  const result = runInstall({ output: download, signal: true })
  expect(result.status, result.output).toBe(143)
  expect(result.calls).toEqual([
    'install --frozen-lockfile --ignore-scripts --cache-dir <fixture>/cache',
  ])
  expect(result.sleeps).toEqual([])
})

test.skipIf(!supported)(
  'preserves logging failure even when Bun emits a transient diagnostic',
  () => {
    const result = runInstall({ output: download, loggingStatus: 74 })
    expect(result.status, result.output).toBe(74)
    expect(result.calls).toEqual([
      'install --frozen-lockfile --ignore-scripts --cache-dir <fixture>/cache',
    ])
    expect(result.sleeps).toEqual([])
  },
)

function trackFixture(root: string) {
  const hooks = path.join(root, 'fixture-hooks')
  mkdirSync(hooks)
  const commands = [
    ['init', '-q'],
    ['add', '.'],
    [
      '-c',
      'user.name=Fixture',
      '-c',
      'user.email=fixture@example.com',
      '-c',
      `core.hooksPath=${hooks}`,
      'commit',
      '-qm',
      'fixture',
    ],
  ]
  for (const args of commands) {
    const result = Bun.spawnSync(['git', ...args], { cwd: root })
    expect(result.exitCode, result.stderr.toString()).toBe(0)
  }
}

test.skipIf(!realSupported)(
  'real Bun healthy cold install preserves trusted tarball lifecycle behavior',
  async () => {
    await lifecycleFixture('healthy')
  },
)

test.skipIf(!realSupported)(
  'real Bun preparation retains workspace links and root configuration',
  async () => {
    await lifecycleFixture('workspace')
  },
)

const getDownload =
  'error: GET https://github.com/fixture/packages/releases/download/v1/bad.tgz - 503'

test.skipIf(!supported)('recovers from the real Bun GET 503 diagnostic', () => {
  const result = runInstall({ output: getDownload })
  expect(result.status, result.output).toBe(0)
  expect(result.calls).toHaveLength(3)
  expect(result.sleeps).toEqual(['2'])
})

for (const output of [
  getDownload.replace('503', '403'),
  getDownload.replace('503', '429'),
  getDownload + '\nerror: Integrity check failed',
]) {
  test.skipIf(!supported)(`rejects terminal or mixed GET diagnostics: ${output}`, () => {
    const result = runInstall({ output, status: 23 })
    expect(result.status, result.output).toBe(23)
    expect(result.calls).toHaveLength(1)
    expect(result.sleeps).toEqual([])
  })
}

for (const preflight of ['dirty', 'untracked', 'ignored', 'archive', 'cache'] satisfies Array<
  'dirty' | 'untracked' | 'ignored' | 'archive' | 'cache'
>) {
  test.skipIf(!supported)(`preserves preparation preflight failure: ${preflight}`, () => {
    const result = runInstall({ output: download, preflight })
    const statuses = { dirty: 1, untracked: 1, ignored: 1, archive: 87, cache: 79 }
    expect(result.status, result.output).toBe(statuses[preflight])
    expect(result.calls).toEqual([])
    expect(result.sleeps).toEqual([])
  })
}
