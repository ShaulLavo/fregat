import { spawnSync } from 'node:child_process'
import { cp, mkdir, mkdtemp, readdir, rm, symlink } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { expect, test } from 'vitest'

const repository = path.resolve(import.meta.dirname, '..')

async function freshSettingsCheckout(root: string): Promise<void> {
  for (const relative of [
    'tsconfig.json',
    '.oxfmtrc.json',
    'scripts/tsconfig.json',
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
      ['scripts/generate-settings-schema.ts', '--check'],
      ['scripts/generate-settings-reference.ts', '--check'],
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
