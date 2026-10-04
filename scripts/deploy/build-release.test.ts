import {
  existsSync,
  lstatSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { expect, test } from 'vitest'
import { buildPortableRelease } from './build-release'
import { compilerFixture } from './tests/fixtures'

test.each([false, true])(
  'a portable release with explicit output=%s builds in a fresh checkout and relocates',
  async (explicit) => {
    const scratch = mkdtempSync(path.join(tmpdir(), 'fregat-portable-build-'))
    try {
      const root = path.join(scratch, 'checkout')
      const execute = compilerFixture(root)
      const output = path.join(scratch, 'release')
      const release = await buildPortableRelease(
        { output: explicit ? output : undefined, base: '/demo' },
        execute,
        root,
      )
      if (explicit) expect(release.directory).toBe(output)
      else expect(path.dirname(release.directory)).toBe(tmpdir())
      const builtDirectory = release.directory
      const built = JSON.parse(readFileSync(path.join(builtDirectory, 'build-config.json'), 'utf8'))
      expect(built.webBase).toBe('/demo/')
      expect(built.meshUrl).toBe('')
      expect(built.previousRelease).toBeNull()
      expect(built.source).toBe(root)
      expect(existsSync(path.join(builtDirectory, 'bin/bun'))).toBe(true)
      expect(lstatSync(path.join(builtDirectory, 'server/node_modules')).isSymbolicLink()).toBe(
        true,
      )
      const relocated = path.join(scratch, 'relocated')
      renameSync(builtDirectory, relocated)
      rmSync(root, { recursive: true, force: true })
      expect(realpathSync(path.join(relocated, 'server/node_modules'))).toBe(
        path.join(relocated, 'server/runtime/node_modules'),
      )
      expect(realpathSync(path.join(relocated, 'node_modules'))).toBe(
        path.join(relocated, 'server/runtime/node_modules'),
      )
      expect(readFileSync(path.join(relocated, 'server/node_modules/fixture.txt'), 'utf8')).toBe(
        'runtime dependency',
      )
      expect(readFileSync(path.join(relocated, 'web/index.html'), 'utf8')).toContain(
        '/demo/assets/',
      )
    } finally {
      rmSync(scratch, { recursive: true, force: true })
    }
  },
)

test('a release rejects an occupied output and invalid base before compiler effects', async () => {
  const scratch = mkdtempSync(path.join(tmpdir(), 'fregat-release-input-'))
  try {
    writeFileSync(path.join(scratch, 'kept.txt'), 'existing output')
    let calls = 0
    const execute = async () => {
      calls++
      return { code: 0, stdout: '' }
    }
    await expect(buildPortableRelease({ output: scratch }, execute)).rejects.toMatchObject({
      internal: { outputExists: true },
    })
    await expect(
      buildPortableRelease({ output: path.join(scratch, 'new'), base: '/demo?/' }, execute),
    ).rejects.toMatchObject({ internal: { validBase: false } })
    expect(calls).toBe(0)
    expect(readFileSync(path.join(scratch, 'kept.txt'), 'utf8')).toBe('existing output')
    expect(existsSync(path.join(scratch, 'new'))).toBe(false)
  } finally {
    rmSync(scratch, { recursive: true, force: true })
  }
})
