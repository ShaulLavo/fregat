import { expect, test } from 'vitest'
import { mkdir, readFile, symlink, writeFile } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { withWorkspace } from './fixture.mjs'

const checkout = fileURLToPath(new URL('../../', import.meta.url))
const fixture = JSON.parse(
  await readFile(new URL('./editor-fixture.json', import.meta.url), 'utf8'),
)

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
      JSON.stringify({ changelog: false, commit: false, access: 'public', baseBranch: 'main' }),
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
