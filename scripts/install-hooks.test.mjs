import { expect, test } from 'vitest'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { copyFile, mkdir, readFile, rename, rm, symlink, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { withWorkspace } from './release/fixture.mjs'

const checkout = fileURLToPath(new URL('../', import.meta.url))
const installer = join(checkout, 'scripts/install-hooks.mjs')
const require = createRequire(import.meta.url)
const native = require('lefthook/get-exe').getExePath()
const gitVersion = spawnSync('git', ['--version'], { encoding: 'utf8' }).stdout?.match(
  /git version (\d+)\.(\d+)/,
)
const isolatedGit =
  gitVersion &&
  (Number(gitVersion[1]) > 2 || (Number(gitVersion[1]) === 2 && Number(gitVersion[2]) >= 32))
const supported =
  isolatedGit &&
  process.platform !== 'win32' &&
  spawnSync('git', ['--version']).status === 0 &&
  spawnSync('bun', ['--version']).status === 0
const hookTest = test.skipIf(!supported)
if (!supported)
  console.info(
    'Hook fixture controls require Git 2.32 for GIT_CONFIG_GLOBAL isolation, Bun, and POSIX. The installer requires Git 2.31.',
  )

function run(cwd, env, command, args) {
  return spawnSync(command, args, { cwd, env, encoding: 'utf8' })
}

function checked(cwd, env, command, args) {
  const result = run(cwd, env, command, args)
  expect(result.status, result.stdout + result.stderr).toBe(0)
  return result.stdout.trim()
}

function git(fixture, cwd, args) {
  return checked(cwd, fixture.env, 'git', args)
}

function install(fixture, cwd = fixture.active, extra = {}) {
  return run(cwd, { ...fixture.env, ...extra }, 'bun', [installer])
}

function installChecked(fixture, cwd = fixture.active, extra = {}) {
  const result = install(fixture, cwd, extra)
  expect(result.status, result.stdout + result.stderr).toBe(0)
}

async function content(file) {
  return readFile(file, 'utf8').catch((error) => {
    if (error.code === 'ENOENT') return null
    throw error
  })
}

async function hash(file) {
  return createHash('sha256')
    .update(await readFile(file))
    .digest('hex')
}

async function putConfig(root, label, rc = true) {
  await writeFile(
    join(root, 'lefthook.yml'),
    `${rc ? 'rc: scripts/lefthook-env.sh\n' : ''}no_auto_install: true\npre-commit:\n  commands:\n    observer:\n      run: printf ${label} > "$HOOK_INSTALL_MARKER"\n`,
  )
}

async function copyBinary(root) {
  await mkdir(join(root, 'node_modules/.bin'), { recursive: true })
  await copyFile(native, join(root, 'node_modules/.bin/lefthook'))
}

async function withHooks(body) {
  await withWorkspace(async ({ root }) => {
    const main = join(root, 'main checkout')
    const active = join(root, 'active checkout')
    const old = join(root, 'old checkout')
    const emptyHooks = join(root, 'empty-hooks')
    const globalConfig = join(root, 'global.gitconfig')
    const marker = join(root, 'observed.txt')
    await mkdir(join(main, 'scripts'), { recursive: true })
    await mkdir(emptyHooks)
    await writeFile(globalConfig, '')
    const env = Object.fromEntries(
      Object.entries(process.env).filter(
        ([key]) => !key.startsWith('GIT_') && !key.startsWith('LEFTHOOK'),
      ),
    )
    Object.assign(env, {
      CI: '',
      LEFTHOOK: '1',
      LEFTHOOK_BIN: '',
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_CONFIG_GLOBAL: globalConfig,
      HOOK_INSTALL_MARKER: marker,
    })
    const fixture = { root, main, active, old, env, globalConfig, marker }
    await putConfig(main, 'main')
    await copyFile(join(checkout, 'scripts/lefthook-env.sh'), join(main, 'scripts/lefthook-env.sh'))
    await writeFile(
      join(main, '.gitignore'),
      'node_modules/\n.fregat-hooks/\n.fregat-hooks-stage-*/\n',
    )
    git(fixture, main, ['init', '-b', 'main'])
    git(fixture, main, ['add', '.'])
    git(fixture, main, [
      '-c',
      'user.name=Hook Fixture',
      '-c',
      'user.email=fixture@example.invalid',
      '-c',
      `core.hooksPath=${emptyHooks}`,
      'commit',
      '-m',
      'fixture',
    ])
    git(fixture, main, ['config', 'fixture.keep', 'retained'])
    git(fixture, main, ['worktree', 'add', '-b', 'active', active])
    git(fixture, main, ['worktree', 'add', '-b', 'old', old])
    await putConfig(active, 'active')
    await putConfig(old, 'old', false)
    for (const directory of [main, active, old]) await copyBinary(directory)
    checked(main, env, native, ['install'])
    fixture.common = git(fixture, main, ['rev-parse', '--path-format=absolute', '--git-common-dir'])
    fixture.commonHook = join(fixture.common, 'hooks/pre-commit')
    fixture.currentConfig = git(fixture, active, [
      'rev-parse',
      '--path-format=absolute',
      '--git-path',
      'config.worktree',
    ])
    try {
      await body(fixture)
    } finally {
      removeWorktrees(fixture)
    }
  })
}

function removeWorktrees(fixture) {
  for (const directory of [fixture.active, fixture.old]) {
    const listing = git(fixture, fixture.main, ['worktree', 'list', '--porcelain'])
    if (listing.includes(directory))
      git(fixture, fixture.main, ['worktree', 'remove', '--force', directory])
  }
}

async function commitProbe(fixture, cwd) {
  await writeFile(join(cwd, 'probe.txt'), 'probe\n')
  git(fixture, cwd, ['add', 'probe.txt'])
  git(fixture, cwd, [
    '-c',
    'user.name=Hook Fixture',
    '-c',
    'user.email=fixture@example.invalid',
    'commit',
    '-m',
    'exercise private hook',
  ])
  expect(await content(fixture.marker)).toBe('active')
}

hookTest(
  'private hook survives an older native writer and executes a real commit (requires Git, Bun and POSIX)',
  async () => {
    await withHooks(async (fixture) => {
      const commonBefore = await hash(fixture.commonHook)
      const roots = [fixture.main, fixture.active, fixture.old].map((cwd) =>
        git(fixture, cwd, ['rev-parse', '--show-toplevel']),
      )
      installChecked(fixture, fixture.active, {
        GIT_CONFIG_COUNT: '1',
        GIT_CONFIG_KEY_0: 'fixture.command',
        GIT_CONFIG_VALUE_0: 'preserved',
      })
      const privateHook = join(fixture.active, '.fregat-hooks/pre-commit')
      const privateBefore = await hash(privateHook)
      expect(await hash(fixture.commonHook)).toBe(commonBefore)
      expect(
        git(fixture, fixture.active, ['config', '--show-scope', '--get', 'core.hooksPath']),
      ).toBe('worktree\t.fregat-hooks')
      expect(
        git(fixture, fixture.main, [
          'config',
          '--file',
          join(fixture.common, 'config.worktree'),
          '--get',
          'core.bare',
        ]),
      ).toBe('false')
      expect(
        run(fixture.main, fixture.env, 'git', ['config', '--local', '--get', 'core.bare']).status,
      ).toBe(1)
      expect(git(fixture, fixture.main, ['config', '--get', 'fixture.keep'])).toBe('retained')
      expect(
        [fixture.main, fixture.active, fixture.old].map((cwd) =>
          git(fixture, cwd, ['rev-parse', '--show-toplevel']),
        ),
      ).toEqual(roots)
      expect(
        [fixture.main, fixture.active, fixture.old].map((cwd) =>
          git(fixture, cwd, ['rev-parse', '--is-bare-repository']),
        ),
      ).toEqual(['false', 'false', 'false'])
      checked(fixture.old, fixture.env, native, ['install'])
      expect(await hash(fixture.commonHook)).not.toBe(commonBefore)
      expect(await content(fixture.commonHook)).not.toContain('. scripts/lefthook-env.sh')
      expect(await hash(privateHook)).toBe(privateBefore)
      await commitProbe(fixture, fixture.active)
    })
  },
)

hookTest(
  'private hook survives the actual unpatched dependency postinstall writer (requires Git, Bun and POSIX)',
  async () => {
    await withHooks(async (fixture) => {
      installChecked(fixture)
      const privateHook = join(fixture.active, '.fregat-hooks/pre-commit')
      const privateBefore = await hash(privateHook)
      const commonBefore = await hash(fixture.commonHook)
      const patch = await readFile(join(checkout, 'patches/lefthook@2.1.15.patch'), 'utf8')
      const original =
        patch
          .split('\n')
          .filter((line) => line.startsWith('-') && !line.startsWith('---'))
          .map((line) => line.slice(1))
          .join('\n') + '\n'
      const producer = join(fixture.root, 'old producer')
      await mkdir(producer)
      await writeFile(join(producer, 'postinstall.cjs'), original)
      const selector = require.resolve('lefthook/get-exe')
      await copyFile(selector, join(producer, 'get-exe.js'))
      await symlink(dirname(dirname(selector)), join(producer, 'node_modules'), 'dir')
      checked(fixture.old, { ...fixture.env, INIT_CWD: fixture.old }, 'bun', [
        join(producer, 'postinstall.cjs'),
      ])
      expect(await hash(fixture.commonHook)).not.toBe(commonBefore)
      expect(await hash(privateHook)).toBe(privateBefore)
      await commitProbe(fixture, fixture.active)
    })
  },
)

hookTest(
  'patched postinstall leaves a fresh checkout unopted (requires Git, Bun and POSIX)',
  async () => {
    await withHooks(async (fixture) => {
      const fresh = join(fixture.root, 'fresh checkout')
      await mkdir(fresh)
      await putConfig(fresh, 'fresh')
      git(fixture, fresh, ['init', '-b', 'main'])
      const configBefore = await content(join(fresh, '.git/config'))
      checked(fresh, { ...fixture.env, INIT_CWD: fresh }, 'bun', [
        require.resolve('lefthook/postinstall.js'),
      ])
      expect(await content(join(fresh, '.git/hooks/pre-commit'))).toBe(null)
      expect(await content(join(fresh, '.git/config'))).toBe(configBefore)
    })
  },
)

hookTest(
  'repeat and worktree movement preserve private selection (requires Git, Bun and POSIX)',
  async () => {
    await withHooks(async (fixture) => {
      installChecked(fixture)
      const before = await hash(join(fixture.active, '.fregat-hooks/pre-commit'))
      installChecked(fixture)
      expect(await hash(join(fixture.active, '.fregat-hooks/pre-commit'))).toBe(before)
      git(fixture, fixture.main, ['worktree', 'remove', '--force', fixture.old])
      const moved = join(fixture.root, 'moved checkout')
      git(fixture, fixture.main, ['worktree', 'move', fixture.active, moved])
      fixture.active = moved
      expect(git(fixture, moved, ['config', '--get', 'core.hooksPath'])).toBe('.fregat-hooks')
      await commitProbe(fixture, moved)
    })
  },
)

hookTest.each(['neutral-main', 'prepared-selection', 'removed-common-false'])(
  'resumes the %s migration prefix (requires Git, Bun and POSIX)',
  async (prefix) => {
    await withHooks(async (fixture) => {
      installChecked(fixture)
      git(fixture, fixture.main, ['config', '--local', 'extensions.worktreeConfig', 'false'])
      if (prefix !== 'removed-common-false')
        git(fixture, fixture.main, ['config', '--local', 'core.bare', 'false'])
      if (prefix === 'neutral-main') {
        git(fixture, fixture.main, [
          'config',
          '--file',
          fixture.currentConfig,
          '--unset-all',
          'core.hooksPath',
        ])
        await rm(join(fixture.active, '.fregat-hooks'), { recursive: true })
      }
      const roots = [fixture.main, fixture.active, fixture.old].map((cwd) =>
        git(fixture, cwd, ['rev-parse', '--show-toplevel']),
      )
      expect(
        [fixture.main, fixture.active, fixture.old].map((cwd) =>
          git(fixture, cwd, ['rev-parse', '--is-bare-repository']),
        ),
      ).toEqual(['false', 'false', 'false'])
      installChecked(fixture)
      expect(
        [fixture.main, fixture.active, fixture.old].map((cwd) =>
          git(fixture, cwd, ['rev-parse', '--show-toplevel']),
        ),
      ).toEqual(roots)
      await commitProbe(fixture, fixture.active)
    })
  },
)

hookTest.each(['local', 'global', 'worktree', 'command', 'empty'])(
  'preserves a %s custom hook policy before writes (requires Git, Bun and POSIX)',
  async (scope) => {
    await withHooks(async (fixture) => {
      const custom = join(fixture.root, 'custom hooks')
      await mkdir(custom)
      await writeFile(join(custom, 'pre-commit'), 'user-owned hook\n')
      const extra = {}
      if (scope === 'global')
        git(fixture, fixture.main, ['config', '--global', 'core.hooksPath', custom])
      if (scope === 'local' || scope === 'empty')
        git(fixture, fixture.main, [
          'config',
          '--local',
          'core.hooksPath',
          scope === 'empty' ? '' : custom,
        ])
      if (scope === 'worktree') {
        git(fixture, fixture.main, ['config', '--local', 'extensions.worktreeConfig', 'true'])
        git(fixture, fixture.active, ['config', '--worktree', 'core.hooksPath', custom])
      }
      if (scope === 'command')
        Object.assign(extra, {
          GIT_CONFIG_COUNT: '1',
          GIT_CONFIG_KEY_0: 'core.hooksPath',
          GIT_CONFIG_VALUE_0: custom,
        })
      const before = await content(join(fixture.common, 'config'))
      const currentBefore = await content(fixture.currentConfig)
      const commonBefore = await hash(fixture.commonHook)
      const result = install(fixture, fixture.active, extra)
      expect(result.status).toBe(1)
      expect(result.stderr).toContain('custom Git hook path')
      expect(await content(join(custom, 'pre-commit'))).toBe('user-owned hook\n')
      expect(await content(join(fixture.common, 'config'))).toBe(before)
      expect(await content(fixture.currentConfig)).toBe(currentBefore)
      expect(await hash(fixture.commonHook)).toBe(commonBefore)
      expect(await content(join(fixture.active, '.fregat-hooks/.owner'))).toBe(null)
    })
  },
)

hookTest.each(['core-worktree', 'dormant', 'unmarked', 'symlink'])(
  'refuses the %s ownership layout (requires Git, Bun and POSIX)',
  async (layout) => {
    await withHooks(async (fixture) => {
      const directory = join(fixture.active, '.fregat-hooks')
      if (layout === 'core-worktree')
        git(fixture, fixture.main, ['config', '--local', 'core.worktree', fixture.main])
      if (layout === 'dormant')
        git(fixture, fixture.main, [
          'config',
          '--file',
          fixture.currentConfig,
          'fixture.dormant',
          'preserved',
        ])
      if (layout === 'unmarked') {
        await mkdir(directory)
        await writeFile(join(directory, 'pre-commit'), 'user-owned\n')
      }
      if (layout === 'symlink') await symlink(join(fixture.common, 'hooks'), directory, 'dir')
      const before = await content(join(fixture.common, 'config'))
      const currentBefore = await content(fixture.currentConfig)
      const commonBefore = await hash(fixture.commonHook)
      const result = install(fixture)
      expect(result.status).toBe(1)
      const messages = {
        dormant: 'additional settings',
        'core-worktree': 'separate worktree migration',
        unmarked: 'different ownership',
        symlink: 'different ownership',
      }
      expect(result.stderr).toContain(messages[layout])
      expect(await content(join(fixture.common, 'config'))).toBe(before)
      expect(await content(fixture.currentConfig)).toBe(currentBefore)
      expect(await hash(fixture.commonHook)).toBe(commonBefore)
      if (layout === 'unmarked')
        expect(await content(join(directory, 'pre-commit'))).toBe('user-owned\n')
    })
  },
)

hookTest(
  'failed generation keeps prior hook selection and bytes (requires Git, Bun and POSIX)',
  async () => {
    await withHooks(async (fixture) => {
      installChecked(fixture)
      const before = await hash(join(fixture.active, '.fregat-hooks/pre-commit'))
      const configBefore = await content(fixture.currentConfig)
      await writeFile(join(fixture.active, 'lefthook.yml'), 'pre-commit: [\n')
      const result = install(fixture)
      expect(result.status).toBe(1)
      expect(result.stderr).toContain('required hook-installation command failed')
      expect(await hash(join(fixture.active, '.fregat-hooks/pre-commit'))).toBe(before)
      expect(await content(fixture.currentConfig)).toBe(configBefore)
    })
  },
)

hookTest(
  'preserves a whitespace-distinct dormant hook path before writes (requires Git 2.32, Bun and POSIX)',
  async () => {
    await withHooks(async (fixture) => {
      installChecked(fixture)
      const hook = join(fixture.active, '.fregat-hooks/pre-commit')
      await writeFile(hook, (await content(hook)) + '\n# retained evidence\n')
      git(fixture, fixture.main, ['config', '--local', 'extensions.worktreeConfig', 'false'])
      git(fixture, fixture.main, ['config', '--local', 'core.bare', 'false'])
      git(fixture, fixture.main, [
        'config',
        '--file',
        fixture.currentConfig,
        'core.hooksPath',
        ' .fregat-hooks ',
      ])
      const before = {
        hook: await content(hook),
        current: await content(fixture.currentConfig),
        common: await content(join(fixture.common, 'config')),
      }
      const result = install(fixture)
      expect(result.status, result.stdout + result.stderr).toBe(1)
      expect(result.stderr).toContain('additional settings')
      expect(await content(hook)).toBe(before.hook)
      expect(await content(fixture.currentConfig)).toBe(before.current)
      expect(await content(join(fixture.common, 'config'))).toBe(before.common)
    })
  },
)

hookTest(
  'a whole clone move preserves relative hooks and trailing spaces in its path (requires Git 2.32, Bun and POSIX)',
  async () => {
    await withHooks(async (fixture) => {
      const clone = join(fixture.root, 'cloned checkout ')
      git(fixture, fixture.main, ['clone', fixture.main, clone])
      await putConfig(clone, 'active')
      await copyBinary(clone)
      installChecked(fixture, clone)
      const selected = await hash(join(clone, '.fregat-hooks/pre-commit'))
      const moved = join(fixture.root, 'relocated clone ')
      await rename(clone, moved)
      expect(git(fixture, moved, ['config', '--show-scope', '--get', 'core.hooksPath'])).toBe(
        'worktree\t.fregat-hooks',
      )
      expect(await hash(join(moved, '.fregat-hooks/pre-commit'))).toBe(selected)
      await commitProbe(fixture, moved)
    })
  },
)
