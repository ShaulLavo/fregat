import { expect, test } from 'vitest'
import { copyFile, mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { withWorkspace } from './release/fixture.mjs'

const checkout = fileURLToPath(new URL('../', import.meta.url))
const require = createRequire(import.meta.url)
const hookTest = test.skipIf(process.platform === 'win32' || !Bun.which('sh') || !Bun.which('git'))

function run(cwd, env, command, args) {
  return spawnSync(command, args, { cwd, env, encoding: 'utf8' })
}

function checked(cwd, env, command, args) {
  const result = run(cwd, env, command, args)
  expect(result.status, result.stdout + result.stderr).toBe(0)
  return result.stdout.trim()
}

async function executable(file, source) {
  await writeFile(file, source, { mode: 0o755 })
}

async function withHookFixture(body) {
  const native = require('lefthook/get-exe').getExePath()
  await withWorkspace(async ({ root }) => {
    const active = join(root, 'active checkout')
    const sibling = join(root, 'installing checkout')
    const tools = join(root, 'tools')
    const marker = join(root, 'selected.txt')
    await mkdir(active)
    await mkdir(tools)
    await executable(join(tools, 'lefthook'), '#!/bin/sh\nexit 1\n')
    const env = Object.fromEntries(
      Object.entries(process.env).filter(
        ([key]) => !key.startsWith('GIT_') && !key.startsWith('LEFTHOOK'),
      ),
    )
    Object.assign(env, {
      LEFTHOOK: '1',
      LEFTHOOK_BIN: '',
      GIT_CONFIG_GLOBAL: '/dev/null',
      GIT_CONFIG_NOSYSTEM: '1',
      HOOK_RESOLUTION_MARKER: marker,
      PATH: `${tools}:${process.env.PATH}`,
    })
    const config = await readFile(join(checkout, 'lefthook.yml'), 'utf8')
    const rc = config.split('\n').find((line) => line.startsWith('rc:')) ?? ''
    if (rc) {
      const relative = rc
        .slice(3)
        .trim()
        .replace(/^['"]|['"]$/g, '')
      await mkdir(join(active, 'scripts'))
      await copyFile(join(checkout, relative), join(active, relative))
    }
    await writeFile(
      join(active, 'lefthook.yml'),
      `${rc}\nno_auto_install: true\npre-commit:\n  commands:\n    observer:\n      run: printf active > "$HOOK_RESOLUTION_MARKER"\n`,
    )
    await writeFile(join(active, '.gitignore'), 'node_modules/\n')
    checked(active, env, 'git', ['init', '-b', 'main'])
    checked(active, env, 'git', ['add', '.'])
    checked(active, env, 'git', [
      '-c',
      'user.name=Hook Fixture',
      '-c',
      'user.email=fixture@example.invalid',
      '-c',
      'core.hooksPath=/dev/null',
      'commit',
      '-m',
      'fixture',
    ])
    const common = checked(active, env, 'git', [
      'rev-parse',
      '--path-format=absolute',
      '--git-common-dir',
    ])
    checked(active, env, 'git', ['config', 'core.hooksPath', join(common, 'hooks')])
    checked(active, env, 'git', ['worktree', 'add', '-b', 'sibling', sibling])
    const activeBinary = join(active, 'node_modules/.bin/lefthook')
    const installer = join(sibling, 'node_modules/.bin/lefthook')
    for (const binary of [activeBinary, installer]) {
      await mkdir(join(binary, '..'), { recursive: true })
      await copyFile(native, binary)
    }
    checked(sibling, env, installer, ['install', '--force'])
    const replacement = `${installer}.replacement`
    await executable(
      replacement,
      '#!/bin/sh\ncase "$1" in -h|--help) exit 0;; esac\nprintf sibling > "$HOOK_RESOLUTION_MARKER"\nexit 42\n',
    )
    await rename(replacement, installer)
    await writeFile(join(active, 'probe.txt'), 'fixture change\n')
    checked(active, env, 'git', ['add', 'probe.txt'])
    try {
      await body({ active, sibling, marker, env, activeBinary })
    } finally {
      removeSibling(active, sibling, env)
    }
  })
}

function removeSibling(active, sibling, env) {
  const worktrees = checked(active, env, 'git', ['worktree', 'list', '--porcelain'])
  if (!worktrees.includes(sibling)) return
  checked(active, env, 'git', ['worktree', 'remove', '--force', sibling])
}

hookTest(
  'a shared Git hook chooses the active checkout binary (requires POSIX sh and Git)',
  async () => {
    await withHookFixture(async ({ active, marker, env, activeBinary }) => {
      checked(active, { ...env, LEFTHOOK_BIN: activeBinary }, 'git', ['hook', 'run', 'pre-commit'])
      expect(await readFile(marker, 'utf8')).toBe('active')
      const result = run(active, env, 'git', ['hook', 'run', 'pre-commit'])
      expect(result.status, result.stdout + result.stderr).toBe(0)
      expect(await readFile(marker, 'utf8')).toBe('active')
    })
  },
)

hookTest(
  'removing the installer worktree preserves the active hook (requires POSIX sh and Git)',
  async () => {
    await withHookFixture(async ({ active, sibling, marker, env }) => {
      checked(active, env, 'git', ['worktree', 'remove', '--force', sibling])
      checked(active, env, 'git', ['hook', 'run', 'pre-commit'])
      expect(await readFile(marker, 'utf8')).toBe('active')
    })
  },
)

hookTest('an explicit hook binary keeps precedence (requires POSIX sh and Git)', async () => {
  await withHookFixture(async ({ active, marker, env }) => {
    const override = join(active, 'explicit hook')
    await executable(override, '#!/bin/sh\nprintf explicit > "$HOOK_RESOLUTION_MARKER"\n')
    checked(active, { ...env, LEFTHOOK_BIN: override }, 'git', ['hook', 'run', 'pre-commit'])
    expect(await readFile(marker, 'utf8')).toBe('explicit')
  })
})
