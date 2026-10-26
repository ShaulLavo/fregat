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
    'docs/settings-reference.md',
  ]) {
    const destination = path.join(root, relative)
    await mkdir(path.dirname(destination), { recursive: true })
    await cp(path.join(repository, relative), destination, { recursive: true })
  }

  for (const workspace of ['', 'scripts', 'packages/contracts']) {
    await linkDependencies(root, workspace)
  }
}

async function linkDependencies(root: string, workspace: string): Promise<void> {
  const source = path.join(repository, workspace, 'node_modules')
  if (!existsSync(source)) return

  const destination = path.join(root, workspace, 'node_modules')
  await mkdir(destination, { recursive: true })
  for (const dependency of await readdir(source)) {
    await symlink(path.join(source, dependency), path.join(destination, dependency), 'dir')
  }
}

test('settings hook checks consume installed hotkeys without producer source', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'fregat-settings-checks-'))
  try {
    await freshSettingsCheckout(root)
    const producerSource = path.join(root, 'packages/hotkeys')
    expect(existsSync(producerSource)).toBe(false)

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

    expect(existsSync(producerSource)).toBe(false)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}, 60_000)

test('production contracts bundles resolve the installed hotkeys export', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'fregat-settings-consumer-'))
  try {
    await freshSettingsCheckout(root)
    const result = spawnSync(
      'bun',
      [
        'build',
        'packages/contracts/src/settings.ts',
        '--target=bun',
        '--outfile=consumer.js',
        '--metafile=consumer.json',
      ],
      { cwd: root, encoding: 'utf8' },
    )
    expect(result.status, result.stdout + result.stderr).toBe(0)

    const metadata = JSON.parse(await readFile(path.join(root, 'consumer.json'), 'utf8'))
    const inputs = Object.keys(metadata.inputs).map((input) => input.replaceAll('\\', '/'))
    const hotkeysInputs = inputs.filter((input) => input.includes('@fregat/hotkeys/'))
    expect(hotkeysInputs).toHaveLength(1)
    expect(hotkeysInputs[0]).toMatch(/@fregat\/hotkeys\/dist\/index\.js$/)
    expect(inputs.filter((input) => input.includes('packages/hotkeys/'))).toEqual([])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}, 60_000)
