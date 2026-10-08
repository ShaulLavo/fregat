import { spawnSync } from 'node:child_process'
import { cp, mkdir, mkdtemp, readdir, readFile, rm, symlink } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { expect, test } from 'vitest'

const repository = path.resolve(import.meta.dirname, '..')

async function freshSettingsCheckout(root: string): Promise<void> {
  for (const relative of [
    'package.json',
    'tsconfig.json',
    '.oxfmtrc.json',
    'scripts/tsconfig.json',
    'scripts/tsconfig.settings.json',
    'scripts/generate-settings-schema.ts',
    'scripts/generate-settings-reference.ts',
    'scripts/target-argument.ts',
    'packages/contracts/src',
    'packages/contracts/package.json',
    'packages/contracts/tsconfig.json',
    'packages/contracts/vitest.config.ts',
    'hotkeys/packages/hotkeys/src',
    'hotkeys/packages/hotkeys/package.json',
    'docs/settings-reference.md',
  ]) {
    const destination = path.join(root, relative)
    await mkdir(path.dirname(destination), { recursive: true })
    await cp(path.join(repository, relative), destination, { recursive: true })
  }

  for (const workspace of ['', 'scripts', 'packages/contracts', 'hotkeys/packages/hotkeys']) {
    await linkDependencies(root, workspace)
  }
  await mkdir(path.join(root, 'node_modules/@fregat'), { recursive: true })
  await symlink(
    path.join(root, 'hotkeys/packages/hotkeys'),
    path.join(root, 'node_modules/@fregat/hotkeys'),
    'dir',
  )
}

async function linkDependencies(root: string, workspace: string): Promise<void> {
  const source = path.join(repository, workspace, 'node_modules')
  if (!existsSync(source)) return

  const destination = path.join(root, workspace, 'node_modules')
  await mkdir(destination, { recursive: true })
  for (const dependency of await readdir(source)) {
    if (dependency === '@fregat') continue
    await symlink(path.join(source, dependency), path.join(destination, dependency), 'dir')
  }
}

test('settings hook checks run without hotkeys build output', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'fregat-settings-checks-'))
  try {
    await freshSettingsCheckout(root)
    const buildOutput = path.join(root, 'hotkeys/packages/hotkeys/dist')
    expect(existsSync(buildOutput)).toBe(false)

    for (const args of [
      ['run', 'settings:schema', '--target', path.join(root, 'generated-schema.json')],
      ['run', 'settings:reference', '--target', path.join(root, 'generated-reference.md')],
      ['run', 'settings:schema:check'],
      ['run', 'settings:reference:check'],
      [
        'run',
        '--cwd',
        'packages/contracts',
        'test',
        '--',
        'src/tests/settings-migrations.test.ts',
        'src/tests/settings-schema.test.ts',
      ],
    ]) {
      const result = spawnSync('bun', args, { cwd: root, encoding: 'utf8' })
      expect(result.status, result.stdout + result.stderr).toBe(0)
    }

    expect(existsSync(buildOutput)).toBe(false)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}, 60_000)

test('production contracts bundles resolve the built hotkeys export', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'fregat-settings-consumer-'))
  try {
    await freshSettingsCheckout(root)
    for (const args of [
      [
        'build',
        'hotkeys/packages/hotkeys/src/index.ts',
        '--outdir=hotkeys/packages/hotkeys/dist',
        '--target=browser',
        '--packages=external',
      ],
      [
        'build',
        'packages/contracts/src/settings.ts',
        '--target=bun',
        '--outfile=consumer.js',
        '--metafile=consumer.json',
      ],
    ]) {
      const result = spawnSync('bun', args, { cwd: root, encoding: 'utf8' })
      expect(result.status, result.stdout + result.stderr).toBe(0)
    }

    const metadata = JSON.parse(await readFile(path.join(root, 'consumer.json'), 'utf8'))
    const hotkeysInputs = Object.keys(metadata.inputs).filter((input) =>
      input.replaceAll('\\', '/').includes('hotkeys/packages/hotkeys/'),
    )
    expect(hotkeysInputs).toHaveLength(1)
    expect(hotkeysInputs[0]?.replaceAll('\\', '/')).toMatch(
      /hotkeys\/packages\/hotkeys\/dist\/index\.js$/,
    )
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}, 60_000)
