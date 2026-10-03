import { chmod, copyFile, mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from 'vitest'

const transactionTools = ['bash', 'flock', 'cp', 'install', 'mv', 'mktemp', 'date', 'rm']
const missingTransactionTool = transactionTools.find((name) => !Bun.which(name))
const transactionTest = missingTransactionTool ? test.skip : test

transactionTest.each([
  ['healthy', 0, 'new-bundle', 1, 1],
  ['build-fails', 1, 'old-bundle', 0, 0],
  ['restart-fails', 1, 'old-bundle', 2, 1],
  ['unhealthy', 1, 'old-bundle', 2, 31],
  ['malformed', 1, 'old-bundle', 2, 31],
  ['recovery-fails', 2, 'old-bundle', 2, 60],
  ['interrupted', 1, 'old-bundle', 2, 1],
  ['interrupted-twice', 1, 'old-bundle', 2, 1],
] as const)(
  `deployment %s keeps bundle, backup and bounded health consistent${missingTransactionTool ? ` (requires ${missingTransactionTool})` : ''}`,
  async (mode, exitCode, expectedBundle, restarts, probes) => {
    const root = await mkdtemp(join(tmpdir(), 'gateway-deploy-test-'))
    const source = join(root, 'src')
    const bin = join(root, 'bin')
    try {
      await mkdir(source)
      await writeFile(join(source, 'run.ts'), 'fixture-retained-source')
      await mkdir(bin)
      await copyFile(
        join(import.meta.dirname, 'producer-retirement-deploy.sh'),
        join(root, 'producer-retirement-deploy.sh'),
      )
      await writeFile(join(root, 'gateway.js'), 'old-bundle')
      await writeFile(join(root, 'runtime.json'), 'fixture-runtime-must-stay-unchanged')
      const commands = {
        bun: `#!/bin/bash
if [[ "$1" == build ]]; then
  [[ "$2" == "$FIXTURE_SOURCE/run.ts" ]] || exit 93
  [[ "$FIXTURE_MODE" != build-fails ]] || exit 1
  while [[ "$1" != --outfile ]]; do shift; done
  printf new-bundle > "$2"
  exit 0
fi
exec "$FIXTURE_BUN" "$@"
`,
        mesh: `#!/bin/bash
[[ "$*" == 'serve stop /ai' ]] || exit 91
printf 'restart\\n' >> "$FIXTURE_ROOT/restarts"
if [[ $(cat "$FIXTURE_ROOT/gateway.js") == new-bundle ]]; then
  [[ "$FIXTURE_MODE" != restart-fails ]] || exit 1
  if [[ "$FIXTURE_MODE" == interrupted* ]]; then kill -TERM "$PPID"; fi
fi
`,
        curl: `#!/bin/bash
[[ "$1" == --disable && "$2" == --noproxy && "$3" == '*' && "$4" == --proxy && -z "$5" && "\${@:6}" == '--fail --silent --max-time 3 http://127.0.0.1:8318/health' ]] || exit 92
printf 'probe\\n' >> "$FIXTURE_ROOT/probes"
if [[ "$FIXTURE_MODE" == recovery-fails ]]; then printf '{"status":"starting"}'; exit 0; fi
if [[ $(cat "$FIXTURE_ROOT/gateway.js") == new-bundle ]]; then
  if [[ "$FIXTURE_MODE" == unhealthy ]]; then printf '{"status":"starting"}'; exit 0; fi
  if [[ "$FIXTURE_MODE" == malformed ]]; then printf invalid; exit 0; fi
fi
printf '{"status":"ready"}'
`,
        cp: `#!/bin/bash
if [[ "$FIXTURE_MODE" == interrupted-twice && "$*" == *gateway-backup* && "$*" == *gateway-next* ]]; then
  kill -TERM "$PPID"
fi
exec "$FIXTURE_CP" "$@"
`,
        sleep: '#!/bin/bash\nexit 0\n',
      }
      for (const [name, text] of Object.entries(commands)) {
        await writeFile(join(bin, name), text)
        await chmod(join(bin, name), 0o755)
      }
      const child = Bun.spawn(['bash', join(root, 'producer-retirement-deploy.sh'), source, root], {
        env: {
          ...process.env,
          PATH: `${bin}:${process.env.PATH}`,
          FIXTURE_MODE: mode,
          FIXTURE_ROOT: root,
          FIXTURE_SOURCE: source,
          FIXTURE_BUN: process.execPath,
          FIXTURE_CP: Bun.which('cp')!,
        },
        stdout: 'pipe',
        stderr: 'pipe',
      })
      const [resultExitCode, stderr] = await Promise.all([
        child.exited,
        new Response(child.stderr).text(),
        new Response(child.stdout).text(),
      ])
      const result = { exitCode: resultExitCode, stderr }
      expect(result.exitCode, result.stderr).toBe(exitCode)
      expect(await readFile(join(root, 'gateway.js'), 'utf8')).toBe(expectedBundle)
      expect(await readFile(join(root, 'runtime.json'), 'utf8')).toBe(
        'fixture-runtime-must-stay-unchanged',
      )
      for (const [file, count] of [
        ['restarts', restarts],
        ['probes', probes],
      ] as const) {
        const lines = await readFile(join(root, file), 'utf8').catch(() => '')
        expect(lines.trim() ? lines.trim().split('\n').length : 0).toBe(count)
      }
      const entries = await readdir(root)
      const backups = entries.filter((name) => name.startsWith('gateway-backup-'))
      expect(backups).toHaveLength(mode === 'build-fails' ? 0 : 1)
      if (backups[0])
        expect(await readFile(join(root, backups[0], 'gateway.js'), 'utf8')).toBe('old-bundle')
      expect(
        entries.some(
          (name) => name.startsWith('.gateway-build-') || name.startsWith('.gateway-next-'),
        ),
      ).toBe(false)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  },
  20_000,
)

test('ambient proxy cannot satisfy copied-script readiness for an unhealthy fixture target', async (context) => {
  if (missingTransactionTool)
    return context.skip(`${missingTransactionTool} is required for the deployment fixture`)
  const realCurl = Bun.which('curl')
  if (!realCurl) return context.skip('curl is required for the proxy-isolation fixture')
  const root = await mkdtemp(join(tmpdir(), 'gateway-deploy-proxy-test-'))
  let targetReads = 0
  let proxyReads = 0
  const target = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    async fetch(request) {
      expect(new URL(request.url).pathname).toBe('/health')
      targetReads++
      const bundle = await readFile(join(root, 'gateway.js'), 'utf8')
      return Response.json(
        { status: bundle === 'old-bundle' ? 'ready' : 'starting' },
        { status: bundle === 'old-bundle' ? 200 : 503 },
      )
    },
  })
  const proxy = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch() {
      proxyReads++
      return Response.json({ status: 'ready' })
    },
  })
  try {
    const source = join(root, 'src')
    const bin = join(root, 'bin')
    await mkdir(source)
    await writeFile(join(source, 'run.ts'), 'fixture-retained-source')
    await mkdir(bin)
    const script = await readFile(
      join(import.meta.dirname, 'producer-retirement-deploy.sh'),
      'utf8',
    )
    expect(script.split('http://127.0.0.1:8318/health')).toHaveLength(2)
    await writeFile(
      join(root, 'producer-retirement-deploy.sh'),
      script.replace('http://127.0.0.1:8318/health', new URL('/health', target.url).toString()),
    )
    await writeFile(join(root, 'gateway.js'), 'old-bundle')
    await writeFile(join(root, 'runtime.json'), 'fixture-runtime-must-stay-unchanged')
    const commands = {
      bun: `#!/bin/bash
if [[ "$1" == build ]]; then
  [[ "$2" == "$FIXTURE_SOURCE/run.ts" ]] || exit 93
  while [[ "$1" != --outfile ]]; do shift; done
  printf new-bundle > "$2"
  exit 0
fi
exec "$FIXTURE_BUN" "$@"
`,
      mesh: `#!/bin/bash
[[ "$*" == 'serve stop /ai' ]] || exit 91
printf 'restart\\n' >> "$FIXTURE_ROOT/restarts"
`,
      curl: `#!/bin/bash
exec "$FIXTURE_CURL" "$@"
`,
      sleep: '#!/bin/bash\nexit 0\n',
    }
    for (const [name, text] of Object.entries(commands)) {
      await writeFile(join(bin, name), text)
      await chmod(join(bin, name), 0o755)
    }
    const env: Record<string, string> = {}
    for (const [name, value] of Object.entries(process.env)) {
      if (value !== undefined && !/^(http|https|all|no)_proxy$/i.test(name)) env[name] = value
    }
    for (const name of [
      'http_proxy',
      'https_proxy',
      'all_proxy',
      'HTTP_PROXY',
      'HTTPS_PROXY',
      'ALL_PROXY',
    ])
      env[name] = proxy.url.toString()
    Object.assign(env, {
      no_proxy: '',
      NO_PROXY: '',
      PATH: `${bin}:${process.env.PATH}`,
      FIXTURE_ROOT: root,
      FIXTURE_SOURCE: source,
      FIXTURE_BUN: process.execPath,
      FIXTURE_CURL: realCurl,
    })
    const control = Bun.spawn(
      [
        realCurl,
        '--disable',
        '--fail',
        '--silent',
        '--max-time',
        '3',
        new URL('/health', target.url).toString(),
      ],
      { env, stdout: 'pipe', stderr: 'pipe' },
    )
    const [controlExit, controlBody] = await Promise.all([
      control.exited,
      new Response(control.stdout).text(),
      new Response(control.stderr).text(),
    ])
    expect(controlExit).toBe(0)
    expect(JSON.parse(controlBody)).toEqual({ status: 'ready' })
    expect(proxyReads).toBe(1)
    expect(targetReads).toBe(0)
    proxyReads = 0
    const child = Bun.spawn(['bash', join(root, 'producer-retirement-deploy.sh'), source, root], {
      env,
      stdout: 'pipe',
      stderr: 'pipe',
    })
    const [exitCode, stderr] = await Promise.all([
      child.exited,
      new Response(child.stderr).text(),
      new Response(child.stdout).text(),
    ])
    expect(exitCode, stderr).toBe(1)
    expect(targetReads).toBe(31)
    expect(proxyReads).toBe(0)
    expect(await readFile(join(root, 'gateway.js'), 'utf8')).toBe('old-bundle')
    expect(await readFile(join(root, 'runtime.json'), 'utf8')).toBe(
      'fixture-runtime-must-stay-unchanged',
    )
    expect((await readFile(join(root, 'restarts'), 'utf8')).trim().split('\n')).toHaveLength(2)
  } finally {
    target.stop(true)
    proxy.stop(true)
    await rm(root, { recursive: true, force: true })
  }
}, 20_000)
