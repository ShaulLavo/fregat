import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { expect, test } from 'vitest'

interface SearchToolsStep {
  name: string
  env: Record<string, string>
  run: string
}

const action = Bun.YAML.parse(
  readFileSync(path.resolve(import.meta.dirname, '../.github/actions/setup/action.yml'), 'utf8'),
) as { runs: { steps: SearchToolsStep[] } }
const step = action.runs.steps.find((entry) => entry.name === 'Install search tools')!
const tools = ['rg', 'fd'] as const
type Tool = (typeof tools)[number]
const required = ['bash', 'curl', 'sha256sum', 'tar', 'install', 'timeout']
const missing = required.filter((command) => !Bun.which(command))
const fixtureTest = test.skipIf(missing.length > 0 || process.platform === 'win32')
const archives: Record<Tool, string> = {
  rg: `ripgrep-${step.env.RG_VERSION}-x86_64-unknown-linux-musl`,
  fd: `fd-v${step.env.FD_VERSION}-x86_64-unknown-linux-musl`,
}

async function runSetup(
  responses: Partial<Record<Tool, number[]>> = {},
  failure?: 'checksum' | 'extraction' | 'installation',
  cached: readonly Tool[] = [],
) {
  const root = mkdtempSync(path.join(tmpdir(), 'fregat-ci-search-tools-'))
  const bin = path.join(root, 'bin')
  const destination = path.join(root, 'installed')
  const downloads = path.join(root, 'downloads')
  for (const directory of [bin, destination, downloads]) mkdirSync(directory)
  const bodies = {} as Record<Tool, Uint8Array<ArrayBuffer>>
  const env: Record<string, string> = { ...step.env, GH_TOKEN: 'fixture-token' }
  const cache = path.join(downloads, 'search-tools')
  mkdirSync(cache)
  for (const tool of tools) {
    const archiveRoot = path.join(root, archives[tool])
    mkdirSync(archiveRoot)
    writeFileSync(
      path.join(archiveRoot, tool),
      `#!/usr/bin/env bash\nprintf '${tool} fixture\\n'\n`,
    )
    const archive = path.join(root, `${archives[tool]}.tar.gz`)
    const result = Bun.spawnSync(['tar', '-czf', archive, '-C', root, `${archives[tool]}/${tool}`])
    expect(result.exitCode, result.stderr.toString()).toBe(0)
    bodies[tool] = new Uint8Array(readFileSync(archive))
    if (tool === 'fd' && failure === 'extraction')
      bodies[tool] = new TextEncoder().encode('invalid archive')
    env[`${tool.toUpperCase()}_SHA256`] = createHash('sha256').update(bodies[tool]).digest('hex')
    if (tool === 'fd' && failure === 'checksum')
      bodies[tool] = new TextEncoder().encode('tampered archive')
  }
  for (const tool of cached)
    writeFileSync(path.join(cache, `${archives[tool]}.tar.gz`), bodies[tool])
  const requests: Record<Tool, number[]> = { rg: [], fd: [] }
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch(request) {
      const pathname = new URL(request.url).pathname
      const tool = tools.find((name) => pathname === `/${archives[name]}.tar.gz`)
      if (!tool) return new Response('Unknown fixture', { status: 404 })
      const sequence = responses[tool] ?? [200]
      const index = Math.min(requests[tool].length, sequence.length - 1)
      const status = sequence[index]!
      requests[tool].push(status)
      return new Response(status === 200 ? bodies[tool] : 'fixture transfer failure', { status })
    },
  })
  writeFileSync(
    path.join(bin, 'gh'),
    `#!/usr/bin/env bash
set -eu
if [ "$GH_TOKEN" != fixture-token ]; then exit 65; fi
if [ "$#" != 10 ] || [ "$1" != release ] || [ "$2" != download ] || [ "$4" != --repo ] || [ "$6" != --pattern ] || [ "$8" != --dir ] || [ "$9" != . ] || [ "\${10}" != --clobber ]; then exit 64; fi
case "$5:$3:$7" in
  "$FIXTURE_RG_RELEASE") ;;
  "$FIXTURE_FD_RELEASE") ;;
  *) printf 'Unexpected release request\\n' >&2; exit 64 ;;
esac
exec "$FIXTURE_CURL" --disable --noproxy '*' -fsS --output "$7" "$FIXTURE_ORIGIN/$7"
`,
    { mode: 0o755 },
  )
  writeFileSync(
    path.join(bin, 'sleep'),
    `#!/usr/bin/env bash\nprintf '%s\\n' "$1" >> "$FIXTURE_DELAY_LOG"\n`,
    { mode: 0o755 },
  )
  writeFileSync(
    path.join(bin, 'sudo'),
    `#!/usr/bin/env bash
set -eu
printf '%s\\n' "$*" >> "$FIXTURE_INSTALL_LOG"
if [ "$FIXTURE_INSTALL_FAILURE" = 1 ]; then exit 42; fi
if [ "$#" != 6 ] || [ "$1" != install ] || [ "$2" != -m ] || [ "$3" != 0755 ] || [ "$6" != /usr/local/bin/ ]; then exit 64; fi
exec install -m 0755 "$4" "$5" "$FIXTURE_DESTINATION/"
`,
    { mode: 0o755 },
  )
  try {
    const child = Bun.spawn(['bash', '-e', '-o', 'pipefail', '-c', step.run], {
      cwd: root,
      env: {
        ...process.env,
        ...env,
        PATH: `${bin}:${process.env.PATH}`,
        RUNNER_TEMP: downloads,
        FIXTURE_CURL: Bun.which('curl')!,
        FIXTURE_ORIGIN: `http://127.0.0.1:${server.port}`,
        FIXTURE_RG_RELEASE: `BurntSushi/ripgrep:${env.RG_VERSION}:${archives.rg}.tar.gz`,
        FIXTURE_FD_RELEASE: `sharkdp/fd:v${env.FD_VERSION}:${archives.fd}.tar.gz`,
        FIXTURE_DELAY_LOG: path.join(root, 'delays.log'),
        FIXTURE_DESTINATION: destination,
        FIXTURE_INSTALL_LOG: path.join(root, 'install.log'),
        FIXTURE_INSTALL_FAILURE: failure === 'installation' ? '1' : '0',
      },
      stdout: 'pipe',
      stderr: 'pipe',
    })
    const [exitCode, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ])
    const installed = tools.filter((tool) => existsSync(path.join(destination, tool)))
    const output = installed.map((tool) =>
      Bun.spawnSync(['bash', path.join(destination, tool)]).stdout.toString(),
    )
    return {
      exitCode,
      stdout,
      stderr,
      requests,
      installed,
      output,
      delays: existsSync(path.join(root, 'delays.log'))
        ? readFileSync(path.join(root, 'delays.log'), 'utf8').trim().split('\n').map(Number)
        : [],
      installationAttempts: existsSync(path.join(root, 'install.log'))
        ? readFileSync(path.join(root, 'install.log'), 'utf8').trim().split('\n').length
        : 0,
    }
  } finally {
    server.stop(true)
    rmSync(root, { recursive: true, force: true })
  }
}

test('CI search tools keep their release versions and checksums pinned', () => {
  expect(step.env).toEqual({
    GH_TOKEN: '${{ github.token }}',
    RG_VERSION: '15.2.0',
    RG_SHA256: '33e15bcf1624b25cdd2a55813a47a2f95dbe126268203e76aa6a585d1e7b149c',
    FD_VERSION: '10.4.2',
    FD_SHA256: 'e3257d48e29a6be965187dbd24ce9af564e0fe67b3e73c9bdcd180f4ec11bdde',
  })
})

fixtureTest(
  `CI search tools install verified archives (requires ${required.join(', ')})`,
  async () => {
    const result = await runSetup()
    expect(result.exitCode, result.stderr).toBe(0)
    expect(result.requests).toEqual({ rg: [200], fd: [200] })
    expect(result.installed).toEqual(tools)
    expect(result.output).toEqual(['rg fixture\n', 'fd fixture\n'])
    expect(result.stdout).toContain(`${archives.fd}.tar.gz: OK`)
  },
)

fixtureTest.each(tools)('CI search tools recover HTTP 403 then 503 for %s', async (tool) => {
  const result = await runSetup({ [tool]: [403, 503, 200] })
  expect(result.exitCode, result.stderr).toBe(0)
  expect(result.requests[tool]).toEqual([403, 503, 200])
  expect(result.delays).toEqual([2, 4])
  expect(result.stdout + result.stderr).not.toContain('fixture-token')
  expect(result.installed).toEqual(tools)
  expect(result.output).toEqual(['rg fixture\n', 'fd fixture\n'])
})

fixtureTest('CI search tools give up after six failed transfer attempts', async () => {
  const result = await runSetup({ fd: [502] })
  expect(result.exitCode).toBe(1)
  expect(result.requests.fd).toEqual([502, 502, 502, 502, 502, 502])
  expect(result.delays).toEqual([2, 4, 8, 16, 32])
  expect(result.stdout).toContain('Failed to download sharkdp/fd')
  expect(result.installationAttempts).toBe(0)
  expect(result.installed).toEqual([])
})

fixtureTest('CI search tools fail closed after bounded HTTP 404 retries', async () => {
  const result = await runSetup({ fd: [404] })
  expect(result.exitCode).toBe(1)
  expect(result.requests.fd).toEqual([404, 404, 404, 404, 404, 404])
  expect(result.installationAttempts).toBe(0)
})

fixtureTest.each(['checksum', 'extraction', 'installation'] as const)(
  'CI search tools propagate %s failures without retrying provisioning',
  async (failure) => {
    const result = await runSetup({}, failure)
    expect(result.exitCode).not.toBe(0)
    expect(result.requests).toEqual({ rg: [200], fd: [200] })
    expect(result.installed).toEqual([])
    expect(result.installationAttempts).toBe(failure === 'installation' ? 1 : 0)
    if (failure === 'checksum') expect(result.stdout).toContain(`${archives.fd}.tar.gz: FAILED`)
    if (failure === 'installation') expect(result.exitCode).toBe(42)
  },
)

fixtureTest('CI search tools verify cached archives without release requests', async () => {
  const result = await runSetup({}, undefined, tools)
  expect(result.exitCode, result.stderr).toBe(0)
  expect(result.requests).toEqual({ rg: [], fd: [] })
  expect(result.installed).toEqual(tools)
  expect(result.stdout).toContain(`${archives.rg}.tar.gz: OK`)
  expect(result.stdout).toContain(`${archives.fd}.tar.gz: OK`)
})

fixtureTest('CI search tools download only the missing cached archive', async () => {
  const result = await runSetup({}, undefined, ['rg'])
  expect(result.exitCode, result.stderr).toBe(0)
  expect(result.requests).toEqual({ rg: [], fd: [200] })
  expect(result.installed).toEqual(tools)
})

fixtureTest('CI search tools reject tampered cached archives before installation', async () => {
  const result = await runSetup({}, 'checksum', tools)
  expect(result.exitCode).not.toBe(0)
  expect(result.requests).toEqual({ rg: [], fd: [] })
  expect(result.installationAttempts).toBe(0)
  expect(result.installed).toEqual([])
})
