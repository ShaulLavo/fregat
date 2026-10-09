import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
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
