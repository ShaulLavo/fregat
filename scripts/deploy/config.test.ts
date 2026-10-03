import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { expect, test } from 'vitest'
import * as v from 'valibot'
import { SETTINGS_REGISTRY } from '../../packages/contracts/src/settings/keys'

const target = {
  productionRoot: path.join(tmpdir(), 'contributor-production'),
  meshHost: 'contributor',
  meshOrigin: 'https://contributor.example',
  meshRoute: '/demo',
}

test.each(['/demo', '/demo/', '/'])(
  'deployment reads the machine target with route %s',
  (route) => {
    const home = mkdtempSync(path.join(tmpdir(), 'deploy-target-'))
    try {
      mkdirSync(path.join(home, '.platform'))
      writeFileSync(
        path.join(home, '.platform/settings.json'),
        JSON.stringify({ 'developer.deployTarget': { ...target, meshRoute: route } }),
      )
      const result = Bun.spawnSync(
        [
          process.execPath,
          '-e',
          `import * as config from ${JSON.stringify(path.join(import.meta.dirname, 'config.ts'))}; import { renderUnit } from ${JSON.stringify(path.join(import.meta.dirname, 'systemd.ts'))}; console.log(JSON.stringify({unit: renderUnit(), productionRoot: config.productionRoot, meshHost: config.meshHost, meshOrigin: config.meshOrigin, meshRoute: config.meshRoute, webBase: config.webBase, meshUrl: config.meshUrl}))`,
        ],
        { env: { ...process.env, HOME: home } },
      )
      expect(result.exitCode, result.stderr.toString()).toBe(0)
      const { unit, ...configured } = JSON.parse(result.stdout.toString())
      const meshRoute = route.replace(/\/$/, '') || '/'
      const webBase = meshRoute === '/' ? '/' : `${meshRoute}/`
      expect(configured).toEqual({
        ...target,
        meshRoute,
        webBase,
        meshUrl: `${target.meshOrigin}${webBase}`,
      })
      expect(unit).toContain(`WorkingDirectory=${target.productionRoot}`)
      expect(unit).toContain(
        `Environment=SERVER_ALLOWED_ORIGINS=${target.meshOrigin},platform-tui://local`,
      )
      expect(unit).toContain('Environment=PORT=3301')
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  },
)

test.each([
  { productionRoot: 'relative' },
  { productionRoot: '/' },
  { productionRoot: '/srv/../' },
  { productionRoot: '/srv/with space' },
  { productionRoot: '/srv/%h' },
  { productionRoot: '/srv/${HOME}' },
  { productionRoot: "/srv/prod'root" },
  { productionRoot: '/srv/prod"root' },
  { productionRoot: '/srv/prod\\root' },
  { productionRoot: '/srv/production\n' },
  { meshHost: '' },
  { meshHost: 'host\n' },
  { meshRoute: '/demo\n' },
  { meshOrigin: 'https://example.com/path' },
  { meshOrigin: 'https://example.com/' },
  { meshOrigin: 'https://user:secret@example.com' },
  { meshRoute: 'relative' },
  { meshRoute: '/a//b' },
])('rejects an invalid deployment target %j', (invalid) => {
  const descriptor = SETTINGS_REGISTRY['developer.deployTarget']
  expect(v.safeParse(descriptor.schema, { ...target, ...invalid }).success).toBe(false)
  expect(descriptor.scope).toBe('machine')
  expect(descriptor.default).toBeNull()
})

test.each(
  [
    ...[[], ['--server'], ['--restart'], ['--rollback']].map((args) => ({
      script: 'mesh.ts',
      args,
    })),
    { script: '../pair.ts', args: [] },
  ].flatMap((command) => [false, true].map((invalid) => ({ ...command, invalid }))),
)(
  '$script $args stops before effects with an invalid target: $invalid',
  ({ script, args, invalid }) => {
    const home = mkdtempSync(path.join(tmpdir(), 'deploy-unconfigured-'))
    try {
      const settings = JSON.stringify({
        'developer.deployTarget': { ...target, meshOrigin: 'https://contributor.example/path' },
      })
      if (invalid) {
        mkdirSync(path.join(home, '.platform'))
        writeFileSync(path.join(home, '.platform/settings.json'), settings)
      }
      const result = Bun.spawnSync(
        [process.execPath, path.join(import.meta.dirname, script), ...args],
        { env: { ...process.env, HOME: home } },
      )
      expect(result.exitCode).toBe(1)
      expect(result.stderr.toString()).toContain('Configure developer.deployTarget')
      expect(readdirSync(home)).toEqual(invalid ? ['.platform'] : [])
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  },
)
