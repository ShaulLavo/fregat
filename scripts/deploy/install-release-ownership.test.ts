import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { expect, test } from 'vitest'
import { writeReleasePayload } from './tests/fixtures'

const installer = path.resolve(import.meta.dirname, '../install-release.ts')
const hasPosixPermissions = process.platform !== 'win32' && process.geteuid?.() !== 0

function unlock(directory: string) {
  chmodSync(directory, 0o755)
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.isSymbolicLink()) continue
    unlock(path.join(directory, entry.name))
  }
}

async function probe(mode: string, server = true) {
  const scratch = mkdtempSync(path.join(tmpdir(), 'fregat-install-ownership-'))
  try {
    const home = path.join(scratch, 'home')
    const root = path.join(scratch, 'production')
    const source = path.join(scratch, 'built')
    const previous = path.join(root, 'releases/previous')
    const oldPending = path.join(root, 'releases/old-pending')
    const peer = path.join(root, 'releases/peer')
    mkdirSync(path.join(home, '.platform'), { recursive: true })
    writeReleasePayload(source, '/demo/')
    writeReleasePayload(previous, '/demo/')
    symlinkSync(previous, path.join(root, 'current'))
    if (server && !mode.startsWith('published-')) {
      writeReleasePayload(oldPending, '/demo/')
      symlinkSync(oldPending, path.join(root, 'pending'))
    }
    if (mode.startsWith('competing-') || mode === 'rollback') writeReleasePayload(peer, '/demo/')
    if (mode === 'rollback') {
      const file = path.join(previous, 'build-config.json')
      const config = JSON.parse(readFileSync(file, 'utf8'))
      writeFileSync(file, JSON.stringify({ ...config, previousRelease: peer }))
    }
    writeFileSync(
      path.join(home, '.platform/settings.json'),
      JSON.stringify({
        'developer.deployTarget': {
          productionRoot: root,
          meshHost: 'fixture',
          meshOrigin: 'https://fixture.example',
          meshRoute: '/demo',
        },
      }),
    )
    if (mode === 'prepare') writeFileSync(path.join(source, 'build-config.json'), '{}')
    if (mode === 'verify' || mode === 'cleanup-error') rmSync(path.join(source, 'server/index.js'))
    if (mode === 'boot') {
      const file = path.join(source, 'server/index.js')
      writeFileSync(file, readFileSync(file, 'utf8').replace('status:401', 'status:200'))
    }
    if (mode === 'publish-denied') chmodSync(root, 0o555)
    if (mode === 'cleanup-error') chmodSync(path.join(source, 'web/assets'), 0o555)
    let unit = ''
    if (mode === 'unit') unit = "throw new TypeError('unit failed')"
    if (mode === 'competing-pending')
      unit = `rmSync(${JSON.stringify(path.join(root, 'pending'))}); symlinkSync(${JSON.stringify(peer)}, ${JSON.stringify(path.join(root, 'pending'))})`
    if (mode === 'competing-live')
      unit = `rmSync(${JSON.stringify(path.join(root, 'current'))}); symlinkSync(${JSON.stringify(peer)}, ${JSON.stringify(path.join(root, 'current'))})`
    if (mode === 'rollback')
      unit = `await main(['--rollback', '--skip-live-check'], { signalServer: async () => 'signalled', restartInto: async () => null })`
    const args = ['--from', source, '--skip-live-check'].concat(server ? ['--server'] : [])
    const script = `import { rmSync, symlinkSync, realpathSync } from 'node:fs';
import { main } from ${JSON.stringify(installer)};
await main(${JSON.stringify(args)}, {
  preflight: async () => {}, installUnit: async () => { ${unit} },
  notifyServer: async () => { ${mode === 'published-promote' ? `rmSync(${JSON.stringify(path.join(root, 'current'))}); symlinkSync(${JSON.stringify(path.join(root, 'pending'))}, ${JSON.stringify(path.join(root, 'current'))}); const target = realpathSync(${JSON.stringify(path.join(root, 'pending'))}); rmSync(${JSON.stringify(path.join(root, 'current'))}); symlinkSync(target, ${JSON.stringify(path.join(root, 'current'))}); rmSync(${JSON.stringify(path.join(root, 'pending'))}); throw new TypeError('post promotion failure')` : mode === 'published-notify' ? "throw new TypeError('notification failed')" : "return 'staged'"} },
  requestRestart: async () => {}, waitForServerRelease: async () => {},
  signalServer: async () => { ${mode === 'published-signal' ? "throw new TypeError('signal failed')" : "return 'signalled'"} }, restartInto: async () => null,
}).catch((error) => { console.error(error); process.exit(1) });`
    const child = Bun.spawn([process.execPath, '-e', script], {
      env: {
        ...process.env,
        HOME: home,
        BUN_RUNTIME_TRANSPILER_CACHE_PATH: path.join(scratch, 'cache'),
      },
      stdout: 'pipe',
      stderr: 'pipe',
    })
    const [stdout, stderr, code] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ])
    expect(stderr).not.toContain('Cannot find package')
    expect(stderr).not.toContain('Cannot find module')
    const names = readdirSync(path.join(root, 'releases')).sort()
    const current = realpathSync(path.join(root, 'current'))
    const pending = existsSync(path.join(root, 'pending'))
      ? realpathSync(path.join(root, 'pending'))
      : null
    console.log(
      JSON.stringify({
        mode,
        server,
        code,
        names,
        current: path.basename(current),
        pending: pending && path.basename(pending),
        error: stderr,
        output: stdout,
      }),
    )
    expect(readFileSync(path.join(previous, 'server/index.js'), 'utf8')).toContain('Bun.serve')
    expect(existsSync(path.join(source, 'build-config.json'))).toBe(true)
    if (mode.startsWith('published-')) {
      expect(code).toBe(1)
      expect(names).toHaveLength(2)
      expect(server && mode !== 'published-promote' ? pending : current).not.toBe(previous)
      return
    }
    if (mode === 'success') {
      expect(code, stderr).toBe(0)
      expect(names).toHaveLength(server ? 3 : 2)
      return
    }
    expect(code).toBe(1)
    expect(current).toBe(mode === 'competing-live' || mode === 'rollback' ? peer : previous)
    expect(pending).toBe(
      mode === 'competing-pending' ? peer : mode === 'rollback' ? null : server ? oldPending : null,
    )
    if (mode === 'cleanup-error') {
      const candidate = names.find((name) => name !== 'previous' && name !== 'old-pending')
      expect(candidate).toBeDefined()
      expect(stderr).toContain('server/index.js is missing')
      expect(stderr).toContain('EACCES')
      expect(stderr).toContain(
        `Could not remove unpublished candidate ${path.join(root, 'releases', candidate!)}`,
      )
      expect(names).toHaveLength(3)
      return
    }
    const retained = server ? ['old-pending', 'previous'] : ['previous']
    expect(names).toEqual(
      retained.concat(mode.startsWith('competing-') || mode === 'rollback' ? ['peer'] : []).sort(),
    )
  } finally {
    unlock(scratch)
    rmSync(scratch, { recursive: true, force: true })
  }
}

test.each([
  'success',
  'prepare',
  'verify',
  'boot',
  'unit',
  'competing-pending',
  'competing-live',
  'rollback',
  'published-notify',
  'published-promote',
])('%s owns only unpublished candidate', async (mode) => probe(mode))
test('successful live publication control', async () => probe('success', false))
test('published live survives signal failure', async () => probe('published-signal', false))
test.skipIf(!hasPosixPermissions)(
  'failed pending publication cleans the unpublished candidate (requires unprivileged POSIX permissions)',
  async () => probe('publish-denied'),
)
test.skipIf(!hasPosixPermissions)(
  'failed current publication cleans the unpublished candidate (requires unprivileged POSIX permissions)',
  async () => probe('publish-denied', false),
)
test.skipIf(!hasPosixPermissions)(
  'cleanup failure keeps the original failure visible (requires unprivileged POSIX permissions)',
  async () => probe('cleanup-error'),
)
