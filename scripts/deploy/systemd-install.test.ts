import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { expect, test } from 'vitest'

function install(root: string, failRename: boolean) {
  const module = path.join(import.meta.dirname, 'systemd.ts')
  return Bun.spawnSync(
    [
      process.execPath,
      '-e',
      `import fs from 'node:fs'
import path from 'node:path'
import { mock } from 'bun:test'
const root = ${JSON.stringify(root)}
const installed = path.join(root, 'production/bin/promote.ts')
mock.module('node:fs', () => ({
  ...fs,
  renameSync(from, to) {
    if (${failRename} && to === installed)
      throw Object.assign(new TypeError('Injected busy destination'), { code: 'EBUSY' })
    return fs.renameSync(from, to)
  },
}))
const { installUnit, renderUnit } = await import(${JSON.stringify(module)})
const unit = path.join(root, 'home/.config/systemd/user/platform-prod.service')
fs.mkdirSync(path.dirname(unit), { recursive: true })
fs.writeFileSync(unit, renderUnit())
let outcome = 'installed'
try {
  await installUnit()
} catch (error) {
  if (!(error instanceof Error) || !('code' in error)) throw error
  outcome = error.code
}
console.log(JSON.stringify({ outcome }))`,
    ],
    {
      env: {
        ...process.env,
        HOME: path.join(root, 'home'),
        PATH: path.join(root, 'empty-bin'),
        BUN_RUNTIME_TRANSPILER_CACHE_PATH: path.join(root, 'cache'),
      },
      timeout: 30_000,
    },
  )
}

test.each([false, true])(
  'promoter installation cleans staging after rename failure: %s',
  (failRename) => {
    const root = mkdtempSync(path.join(tmpdir(), 'deploy-install-unit-'))
    const production = path.join(root, 'production')
    const bin = path.join(production, 'bin')
    const installed = path.join(bin, 'promote.ts')
    const marker = path.join(production, 'releases/existing/marker')
    try {
      mkdirSync(bin, { recursive: true })
      mkdirSync(path.dirname(marker), { recursive: true })
      mkdirSync(path.join(root, 'home/.platform'), { recursive: true })
      mkdirSync(path.join(root, 'empty-bin'))
      writeFileSync(installed, 'old promoter\n')
      writeFileSync(path.join(bin, 'promote.ts.next-unrelated'), 'preserved staging\n')
      writeFileSync(marker, 'preserved release\n')
      symlinkSync('releases/existing', path.join(production, 'current'))
      writeFileSync(
        path.join(root, 'home/.platform/settings.json'),
        JSON.stringify({
          'developer.deployTarget': {
            productionRoot: production,
            meshHost: 'fixture',
            meshOrigin: 'https://fixture.example',
            meshRoute: '/',
          },
        }),
      )

      const result = install(root, failRename)
      expect(result.exitCode, result.stderr.toString()).toBe(0)
      const lastLine = result.stdout.toString().trim().split('\n').at(-1)!
      expect(JSON.parse(lastLine)).toEqual({ outcome: failRename ? 'EBUSY' : 'installed' })
      const source = readFileSync(installed, 'utf8')
      if (failRename) expect(source).toBe('old promoter\n')
      if (!failRename) expect(source).toContain('// @bun')
      expect(readlinkSync(path.join(production, 'current'))).toBe('releases/existing')
      expect(readFileSync(marker, 'utf8')).toBe('preserved release\n')
      expect(readFileSync(path.join(bin, 'promote.ts.next-unrelated'), 'utf8')).toBe(
        'preserved staging\n',
      )
      expect(readdirSync(bin).sort()).toEqual(['promote.ts', 'promote.ts.next-unrelated'])
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  },
)
