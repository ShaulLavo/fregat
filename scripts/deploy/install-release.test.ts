import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
  existsSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { expect, test } from 'vitest'
import { writeReleasePayload } from './tests/fixtures'

const installer = path.resolve(import.meta.dirname, '../install-release.ts')

test.each([false, true])(
  'a built release installs into a temporary target with server=%s',
  async (server) => {
    const scratch = mkdtempSync(path.join(tmpdir(), 'fregat-install-fixture-'))
    try {
      const home = path.join(scratch, 'home')
      const root = path.join(scratch, 'production')
      const source = path.join(scratch, 'built')
      const previous = path.join(root, 'releases/previous')
      mkdirSync(path.join(home, '.platform'), { recursive: true })
      writeReleasePayload(source, '/demo/')
      writeReleasePayload(previous, '/demo/')
      symlinkSync(previous, path.join(root, 'current'))
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
      const args = ['--from', source, '--skip-live-check'].concat(server ? ['--server'] : [])
      const script = `import { main } from ${JSON.stringify(installer)};
await main(${JSON.stringify(args)}, {
  preflight: async () => {}, installUnit: async () => {},
  notifyServer: async () => 'staged', requestRestart: async () => {},
  waitForServerRelease: async () => {}, signalServer: async () => 'signalled', restartInto: async () => null,
});`
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
      expect(code, stdout + stderr).toBe(0)
      const installed = realpathSync(path.join(root, server ? 'pending' : 'current'))
      expect(installed).not.toBe(source)
      const config = JSON.parse(readFileSync(path.join(installed, 'build-config.json'), 'utf8'))
      expect(config.meshUrl).toBe('https://fixture.example/demo/')
      expect(config.commit).toBe('a'.repeat(40))
      expect(config.previousRelease).toBe(previous)
      expect(readFileSync(path.join(installed, 'web/index.html'), 'utf8')).toContain(
        'platform-release',
      )
      if (server) {
        expect(realpathSync(path.join(root, 'current'))).toBe(previous)
        expect(stdout).toContain('Update available')
        expect(config.server).toBe(installed)
      } else {
        expect(existsSync(path.join(root, 'pending'))).toBe(false)
        expect(config.server).toBe(previous)
      }
    } finally {
      rmSync(scratch, { recursive: true, force: true })
    }
  },
)

test('a notification failure preserves the staged candidate', async () => {
  const scratch = mkdtempSync(path.join(tmpdir(), 'fregat-install-staged-'))
  try {
    const home = path.join(scratch, 'home')
    const root = path.join(scratch, 'production')
    const source = path.join(scratch, 'built')
    const previous = path.join(root, 'releases/previous')
    mkdirSync(path.join(home, '.platform'), { recursive: true })
    writeReleasePayload(source, '/demo/')
    writeReleasePayload(previous, '/demo/')
    symlinkSync(previous, path.join(root, 'current'))
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
    const script = `import { main } from ${JSON.stringify(installer)};
await main(['--from', ${JSON.stringify(source)}, '--server', '--skip-live-check'], {
  preflight: async () => {}, installUnit: async () => {},
  notifyServer: async () => { throw new TypeError('notify failed') }, requestRestart: async () => {},
  waitForServerRelease: async () => {}, signalServer: async () => 'signalled', restartInto: async () => null,
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

    expect(code).toBe(1)
    expect(stdout + stderr).toContain('notify failed')
    expect(realpathSync(path.join(root, 'current'))).toBe(previous)
    const staged = realpathSync(path.join(root, 'pending'))
    expect(staged).not.toBe(source)
    expect(existsSync(path.join(staged, 'build-config.json'))).toBe(true)
    expect(readdirSync(path.join(root, 'releases'))).toHaveLength(2)
  } finally {
    rmSync(scratch, { recursive: true, force: true })
  }
})

test('a rejected candidate removes only its unpublished release', async () => {
  const scratch = mkdtempSync(path.join(tmpdir(), 'fregat-install-rejected-'))
  try {
    const home = path.join(scratch, 'home')
    const root = path.join(scratch, 'production')
    const source = path.join(scratch, 'built')
    const previous = path.join(root, 'releases/previous')
    mkdirSync(path.join(home, '.platform'), { recursive: true })
    writeReleasePayload(source, '/demo/')
    writeReleasePayload(previous, '/demo/')
    rmSync(path.join(source, 'server/index.js'))
    symlinkSync(previous, path.join(root, 'current'))
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
    const script = `import { main } from ${JSON.stringify(installer)};
await main(['--from', ${JSON.stringify(source)}, '--server', '--skip-live-check'], {
  preflight: async () => {}, installUnit: async () => {},
  notifyServer: async () => 'staged', requestRestart: async () => {},
  waitForServerRelease: async () => {}, signalServer: async () => 'signalled', restartInto: async () => null,
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

    expect(code).toBe(1)
    expect(stdout + stderr).toContain('server/index.js is missing')
    expect(realpathSync(path.join(root, 'current'))).toBe(previous)
    expect(existsSync(path.join(root, 'pending'))).toBe(false)
    expect(readdirSync(path.join(root, 'releases'))).toEqual(['previous'])
  } finally {
    rmSync(scratch, { recursive: true, force: true })
  }
})
