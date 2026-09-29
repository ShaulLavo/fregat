import { expect, test } from 'vitest'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'

const prepare = new URL('./prepare.mjs', import.meta.url).pathname

test('prepares npm manifests while preserving private workspace consumers', async () => {
  const root = await mkdtemp(join(tmpdir(), 'release-prepare-'))
  const put = async (path, value) => {
    const file = join(root, path, 'package.json')
    await mkdir(join(root, path), { recursive: true })
    await writeFile(file, JSON.stringify(value))
  }
  try {
    await put('', {
      private: true,
      workspaces: {
        packages: ['packages/*', 'apps/*'],
        catalog: { vitest: '5.0.2' },
        catalogs: { react: { react: '^19.3.0' } },
      },
    })
    await put('packages/hotkeys', { name: '@fregat/hotkeys', version: '0.1.0' })
    await put('packages/react-hotkeys', {
      name: '@fregat/react-hotkeys',
      version: '0.1.0',
      dependencies: { '@fregat/hotkeys': 'workspace:*' },
      optionalDependencies: { '@fregat/hotkeys': 'workspace:~' },
      peerDependencies: { '@fregat/hotkeys': 'workspace:^', react: 'catalog:react' },
      devDependencies: { vitest: 'catalog:', '@fregat/hotkeys': 'workspace:^0.1.0' },
    })
    const app = { name: 'web', private: true, dependencies: { '@fregat/hotkeys': 'workspace:*' } }
    await put('apps/web', app)
    const result = spawnSync('bun', [prepare], { cwd: root, encoding: 'utf8' })
    expect(result.status, result.stderr).toBe(0)
    const manifest = JSON.parse(
      await readFile(join(root, 'packages/react-hotkeys/package.json'), 'utf8'),
    )
    expect(manifest.dependencies['@fregat/hotkeys']).toBe('0.1.0')
    expect(manifest.optionalDependencies['@fregat/hotkeys']).toBe('~0.1.0')
    expect(manifest.peerDependencies).toEqual({ '@fregat/hotkeys': '^0.1.0', react: '^19.3.0' })
    expect(manifest.devDependencies).toEqual({ vitest: '5.0.2', '@fregat/hotkeys': '^0.1.0' })
    expect(JSON.parse(await readFile(join(root, 'apps/web/package.json'), 'utf8'))).toEqual(app)
    const packed = spawnSync('npm', ['pack', '--dry-run', '--json', './packages/react-hotkeys'], {
      cwd: root,
      encoding: 'utf8',
    })
    expect(packed.status, packed.stderr).toBe(0)
    expect(JSON.parse(packed.stdout)[0].files.map((file) => file.path)).toContain('package.json')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('rejects a public package depending on a private workspace before writing', async () => {
  const root = await mkdtemp(join(tmpdir(), 'release-private-'))
  try {
    await mkdir(join(root, 'packages/private'), { recursive: true })
    await mkdir(join(root, 'packages/public'), { recursive: true })
    await writeFile(join(root, 'package.json'), JSON.stringify({ workspaces: ['packages/*'] }))
    await writeFile(
      join(root, 'packages/private/package.json'),
      JSON.stringify({ name: 'internal', version: '1.0.0', private: true }),
    )
    const manifest = JSON.stringify({
      name: 'public',
      version: '1.0.0',
      dependencies: { internal: 'workspace:*' },
    })
    await writeFile(join(root, 'packages/public/package.json'), manifest)
    const result = spawnSync('bun', [prepare], { cwd: root, encoding: 'utf8' })
    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain('Publishable workspace dependency required: internal')
    expect(await readFile(join(root, 'packages/public/package.json'), 'utf8')).toBe(manifest)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
