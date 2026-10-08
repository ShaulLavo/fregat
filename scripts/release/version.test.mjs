import { expect, test } from 'vitest'
import { mkdir, readFile, symlink, writeFile } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { Glob } from 'bun'
import { withWorkspace } from './fixture.mjs'

const checkout = fileURLToPath(new URL('../../', import.meta.url))
const require = createRequire(import.meta.url)
const cliRequire = createRequire(require.resolve('@changesets/cli/package.json'))
const { readChangesets } = await import(pathToFileURL(cliRequire.resolve('@changesets/read')).href)
const fixture = JSON.parse(
  await readFile(new URL('./editor-fixture.json', import.meta.url), 'utf8'),
)

async function expectPublicChangesets(root) {
  const { workspaces } = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
  const patterns = Array.isArray(workspaces) ? workspaces : workspaces.packages
  const manifests = new Map()
  for (const pattern of patterns) {
    for await (const file of new Glob(`${pattern}/package.json`).scan({ cwd: root })) {
      const manifest = JSON.parse(await readFile(join(root, file), 'utf8'))
      manifests.set(manifest.name, manifest)
    }
  }
  const config = JSON.parse(await readFile(join(root, '.changeset/config.json'), 'utf8'))
  const targets = (await readChangesets(root)).flatMap(({ id, releases }) =>
    releases.map(({ name }) => ({ file: `.changeset/${id}.md`, name })),
  )
  const privateTargets = []
  for (const { file, name } of targets) {
    expect(manifests.has(name), `${file} targets an unknown workspace: ${name}`).toBe(true)
    if (config.privatePackages?.version !== false || !manifests.get(name).private) continue
    privateTargets.push(`${file}: ${name}`)
  }
  expect(
    privateTargets,
    `Changesets target excluded private workspaces: ${privateTargets.join(', ')}`,
  ).toEqual([])
}

test('pending changesets target versioned workspace manifests', async () => {
  await expectPublicChangesets(checkout)
})

test('reports pending releases without dependency-range warnings', () => {
  const result = spawnSync(
    'node',
    [join(checkout, 'node_modules/@changesets/cli/bin.js'), 'status'],
    { cwd: checkout, encoding: 'utf8' },
  )
  expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0)
  expect(result.stderr).toBe('')
})

test('accepts compact empty changesets', async () => {
  await withWorkspace(async ({ root, put }) => {
    await put('', { name: 'empty-release-fixture', private: true, workspaces: ['packages/*'] })
    await mkdir(join(root, '.changeset'))
    await writeFile(
      join(root, '.changeset/config.json'),
      await readFile(join(checkout, '.changeset/config.json')),
    )
    await writeFile(join(root, '.changeset/empty.md'), '---\n---\n\nNo release.\n')
    await expectPublicChangesets(root)
  })
})

test('rejects invalid public release types', async () => {
  await withWorkspace(async ({ root, put }) => {
    await put('', { name: 'public-release-fixture', private: true, workspaces: ['packages/*'] })
    await put('packages/example', { name: '@release-fixture/example', version: '0.0.1' })
    await mkdir(join(root, '.changeset'))
    await writeFile(
      join(root, '.changeset/config.json'),
      await readFile(join(checkout, '.changeset/config.json')),
    )
    await writeFile(
      join(root, '.changeset/invalid.md'),
      '---\n"@release-fixture/example": banana\n---\n\nInvalid release.\n',
    )
    await expect(expectPublicChangesets(root)).rejects.toThrow(/invalid version type "banana"/)
  })
})

test('rejects private-only changesets that versioning retains without package changes', async () => {
  const { scripts } = JSON.parse(await readFile(join(checkout, 'package.json'), 'utf8'))
  await withWorkspace(async ({ root, put }) => {
    await put('', {
      name: 'private-release-fixture',
      private: true,
      workspaces: ['apps/*'],
      scripts: { 'version-packages': scripts['version-packages'] },
    })
    await put('apps/server', { name: 'server', private: true, version: '0.0.1' })
    await put('apps/web', { name: 'web', private: true, version: '0.0.1' })
    await symlink(join(checkout, 'node_modules'), join(root, 'node_modules'), 'junction')
    await mkdir(join(root, '.changeset'))
    const config = JSON.parse(await readFile(join(checkout, '.changeset/config.json'), 'utf8'))
    await writeFile(join(root, '.changeset/config.json'), JSON.stringify({ ...config, fixed: [] }))
    const install = spawnSync('bun', ['install', '--lockfile-only'], {
      cwd: root,
      encoding: 'utf8',
    })
    expect(install.status, `${install.stdout}\n${install.stderr}`).toBe(0)
    const tracked = ['apps/server/package.json', 'apps/web/package.json', 'bun.lock']
    const before = await Promise.all(tracked.map((file) => readFile(join(root, file), 'utf8')))
    const changeset = "---\n'server': patch\n'web': patch\n---\n\nPrivate fix.\n"
    const changesetPath = join(root, '.changeset/private-patch.md')
    await writeFile(changesetPath, changeset)
    await expect(expectPublicChangesets(root)).rejects.toThrow(/server[\s\S]*web/)
    const result = spawnSync('bun', ['run', 'version-packages'], { cwd: root, encoding: 'utf8' })
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0)
    expect(await Promise.all(tracked.map((file) => readFile(join(root, file), 'utf8')))).toEqual(
      before,
    )
    expect(await readFile(changesetPath, 'utf8')).toBe(changeset)
    await expect(expectPublicChangesets(root)).rejects.toThrow(/server[\s\S]*web/)
  })
})

test('version-packages bumps a package and refreshes its Bun lockfile entry', async () => {
  const { scripts } = JSON.parse(await readFile(join(checkout, 'package.json'), 'utf8'))
  await withWorkspace(async ({ root, put, read }) => {
    await put('', {
      name: 'release-fixture',
      private: true,
      workspaces: ['packages/*'],
      scripts: { 'version-packages': scripts['version-packages'] },
    })
    await put('packages/example', { name: '@release-fixture/example', version: '0.0.1' })
    await symlink(join(checkout, 'node_modules'), join(root, 'node_modules'), 'junction')
    await mkdir(join(root, '.changeset'))
    await writeFile(
      join(root, '.changeset/config.json'),
      JSON.stringify({
        changelog: false,
        commit: false,
        access: 'public',
        baseBranch: 'main',
        privatePackages: { version: false, tag: false },
      }),
    )
    const install = spawnSync('bun', ['install', '--lockfile-only'], {
      cwd: root,
      encoding: 'utf8',
    })
    expect(install.status, `${install.stdout}\n${install.stderr}`).toBe(0)
    const lockBefore = await readFile(join(root, 'bun.lock'), 'utf8')
    expect(lockBefore).toContain('"version": "0.0.1"')
    await writeFile(
      join(root, '.changeset/example-patch.md'),
      '---\n"@release-fixture/example": patch\n---\n\nRelease fix.\n',
    )
    await expectPublicChangesets(root)
    const result = spawnSync('bun', ['run', 'version-packages'], {
      cwd: root,
      encoding: 'utf8',
    })
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0)
    expect((await read('packages/example')).version).toBe('0.0.2')
    const lockAfter = await readFile(join(root, 'bun.lock'), 'utf8')
    expect(lockAfter).not.toBe(lockBefore)
    expect(lockAfter).toContain('"version": "0.0.2"')
    expect(lockAfter).not.toContain('"version": "0.0.1"')
  })
})

test('versions the public Editor group with versioned and unversioned private examples', async () => {
  await withWorkspace(async ({ root, put, read }) => {
    await put('', {
      name: 'fregat',
      private: true,
      workspaces: [
        'editor/packages/*',
        'editor/examples/*',
        'hotkeys/packages/*',
        'ghostty-webgpu',
      ],
    })
    for (const [file, manifest] of Object.entries(fixture.packages))
      await put(dirname(file), manifest)
    await put('hotkeys/packages/hotkeys', { name: '@fregat/hotkeys', version: '0.0.0' })
    await put('hotkeys/packages/react-hotkeys', { name: '@fregat/react-hotkeys', version: '0.0.0' })
    await put('ghostty-webgpu', { name: 'ghostty-webgpu', version: '0.1.2' })
    await writeFile(join(root, 'bun.lock'), '{}\n')
    await symlink(join(checkout, 'node_modules'), join(root, 'node_modules'), 'junction')
    await mkdir(join(root, '.changeset'))
    await writeFile(
      join(root, '.changeset/config.json'),
      await readFile(join(checkout, '.changeset/config.json')),
    )
    await writeFile(
      join(root, '.changeset/editor-patch.md'),
      '---\n"@singapore-editor/core": patch\n---\n\nEditor fix.\n',
    )
    const result = spawnSync(
      'node',
      [join(checkout, 'node_modules/@changesets/cli/bin.js'), 'version'],
      {
        cwd: root,
        encoding: 'utf8',
      },
    )
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0)
    const publicPackages = Object.entries(fixture.packages).filter(
      ([, manifest]) => !manifest.private,
    )
    expect(publicPackages).toHaveLength(20)
    for (const [file] of publicPackages) expect((await read(dirname(file))).version).toBe('0.2.1')
    expect((await read('editor/examples/app')).version).toBe('0.0.0')
    expect(await read('editor/examples/stress')).not.toHaveProperty('version')
    expect((await read('hotkeys/packages/hotkeys')).version).toBe('0.0.0')
    expect((await read('ghostty-webgpu')).version).toBe('0.1.2')
  })
})
