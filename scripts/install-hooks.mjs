import { spawnSync } from 'node:child_process'
import {
  lstatSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { EvlogError } from 'evlog'
import { createScriptError, scriptFailureText } from './structured-errors.ts'

const hooksPath = '.fregat-hooks'
const ownerFile = '.owner'
const ownerLayout = 'fregat-hooks-v1\n'
const rcLine = '[ -f scripts/lefthook-env.sh ] && . scripts/lefthook-env.sh'
const require = createRequire(import.meta.url)

function refuse(
  message,
  internal,
  fix = 'Review Git hook configuration before installing commit hooks.',
) {
  throw createScriptError(message, {
    why: 'Commit-hook installation requires checkout-owned hook storage and supported Git configuration.',
    fix,
    internal,
  })
}

function run(cwd, command, args, env = process.env, allowed = [0]) {
  const result = spawnSync(command, args, { cwd, env, encoding: 'utf8' })
  if (result.error || !allowed.includes(result.status)) {
    throw createScriptError('A required hook-installation command failed.', {
      why: 'The Git or Lefthook process did not complete successfully.',
      fix: 'Check Git, Lefthook and checkout permissions, then run hooks:install again.',
      internal: {
        operation: args[0],
        exitCode: result.status,
        signal: result.signal,
        spawnFailed: Boolean(result.error),
        stderrPresent: Boolean(result.stderr),
      },
    })
  }
  return result
}

function git(cwd, args, allowed = [0]) {
  return run(cwd, 'git', args, process.env, allowed).stdout
}

function entries(cwd, key) {
  const output = git(
    cwd,
    ['config', '--null', '--show-origin', '--show-scope', '--get-all', key],
    [0, 1],
  )
  if (output && !output.endsWith('\0'))
    refuse('Git returned incomplete configuration records.', {
      completeRecord: false,
    })
  const values = output.split('\0')
  values.pop()
  if (values.length % 3)
    refuse('Git returned incomplete configuration records.', { fields: values.length })
  const result = []
  for (let index = 0; index < values.length; index += 3) {
    result.push({ scope: values[index], origin: values[index + 1], value: values[index + 2] })
  }
  return result
}

function fromFile(cwd, entry, file) {
  return entry.origin.startsWith('file:') && resolve(cwd, entry.origin.slice(5)) === file
}

function fileValue(cwd, file, key) {
  const value = git(cwd, ['config', '--file', file, '--null', '--get', key], [0, 1])
  return value.endsWith('\0') ? value.slice(0, -1) : value
}

function lineValue(value) {
  if (!value.endsWith('\n')) return value
  const line = value.slice(0, -1)
  return process.platform === 'win32' && line.endsWith('\r') ? line.slice(0, -1) : line
}

function stat(file) {
  try {
    return lstatSync(file)
  } catch (error) {
    if (error.code === 'ENOENT') return null
    throw error
  }
}

function ownedDirectory(root) {
  const directory = join(root, hooksPath)
  const info = stat(directory)
  if (!info) return false
  const marker = stat(join(directory, ownerFile))
  const hook = stat(join(directory, 'pre-commit'))
  const valid =
    info.isDirectory() &&
    !info.isSymbolicLink() &&
    marker?.isFile() &&
    !marker.isSymbolicLink() &&
    marker.size === Buffer.byteLength(ownerLayout) &&
    hook?.isFile() &&
    !hook.isSymbolicLink()
  if (!valid || readFileSync(join(directory, ownerFile), 'utf8') !== ownerLayout) {
    refuse('The private hook directory has different ownership.', { validLayout: Boolean(valid) })
  }
  return true
}

function checkHooksPolicy(repository) {
  const owned = ownedDirectory(repository.root)
  const configured = entries(repository.root, 'core.hooksPath')
  const custom = configured.filter(
    (entry) =>
      entry.scope !== 'worktree' ||
      !fromFile(repository.root, entry, repository.currentConfig) ||
      entry.value !== hooksPath ||
      !owned,
  )
  if (custom.length) {
    refuse(
      'A custom Git hook path is configured.',
      { configuredPaths: configured.length },
      'Keep your hook manager and invoke bun run hooks:pre-commit from its script.',
    )
  }
  return owned
}

function inspectRepository(cwd) {
  const version = git(cwd, ['--version']).match(/git version (\d+)\.(\d+)/)
  const supported =
    version && (Number(version[1]) > 2 || (Number(version[1]) === 2 && Number(version[2]) >= 31))
  if (!supported)
    refuse(
      'Git 2.31 or newer is required for checkout hook installation.',
      {
        versionRecognized: Boolean(version),
      },
      'Install Git 2.31 or newer and run hooks:install again.',
    )
  const bare = git(cwd, ['rev-parse', '--is-bare-repository']).trim() === 'true'
  if (bare) refuse('Commit-hook installation requires a working checkout.', { bare })
  const root = lineValue(git(cwd, ['rev-parse', '--show-toplevel']))
  const common = lineValue(git(root, ['rev-parse', '--path-format=absolute', '--git-common-dir']))
  const currentConfig = lineValue(
    git(root, ['rev-parse', '--path-format=absolute', '--git-path', 'config.worktree']),
  )
  return { root, common, currentConfig, mainConfig: join(common, 'config.worktree') }
}

function extensionEnabled(repository) {
  return (
    git(
      repository.root,
      ['config', '--local', '--type=bool', '--get', 'extensions.worktreeConfig'],
      [0, 1],
    ).trim() === 'true'
  )
}

function dormantConfigs(repository) {
  const result = [{ file: repository.mainConfig, main: true, root: null }]
  const directory = join(repository.common, 'worktrees')
  if (!stat(directory)) return result
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const metadata = join(directory, entry.name)
    const file = join(metadata, 'config.worktree')
    if (!stat(file)) continue
    result.push({
      file,
      main: false,
      root: dirname(lineValue(readFileSync(join(metadata, 'gitdir'), 'utf8'))),
    })
  }
  return result
}

function checkDormant(repository) {
  for (const config of dormantConfigs(repository)) {
    checkDormantFile(repository, config)
  }
}

function checkDormantFile(repository, config) {
  const info = stat(config.file)
  if (!info) return
  if (!info.isFile() || info.isSymbolicLink()) {
    refuse('Worktree configuration has an unsupported file layout.', { regularFile: info.isFile() })
  }
  const keys = git(repository.root, [
    'config',
    '--file',
    config.file,
    '--name-only',
    '--null',
    '--list',
  ])
    .split('\0')
    .filter(Boolean)
  for (const key of keys) {
    if (
      key === 'core.bare' &&
      config.main &&
      fileValue(repository.root, config.file, key) === 'false'
    )
      continue
    const root = config.file === repository.currentConfig ? repository.root : config.root
    if (
      key === 'core.hookspath' &&
      root &&
      fileValue(repository.root, config.file, key) === hooksPath &&
      ownedDirectory(root)
    )
      continue
    refuse('Enabling worktree configuration would activate additional settings.', {
      keys: keys.length,
    })
  }
  if (new Set(keys).size !== keys.length) {
    refuse('Worktree configuration contains duplicate settings.', { keys: keys.length })
  }
}

function migration(repository) {
  if (extensionEnabled(repository)) return { enabled: true, bare: null }
  const bare = entries(repository.root, 'core.bare')
  const worktree = entries(repository.root, 'core.worktree')
  const allowedBare =
    bare.length === 0 ||
    (bare.length === 1 &&
      bare[0].scope === 'local' &&
      fromFile(repository.root, bare[0], join(repository.common, 'config')) &&
      bare[0].value === 'false')
  if (!allowedBare || worktree.length) {
    refuse('Git configuration requires a separate worktree migration.', {
      bareEntries: bare.length,
      worktreeEntries: worktree.length,
    })
  }
  checkDormant(repository)
  return { enabled: false, bare: bare[0] ?? null }
}

function stagingEnvironment(stage) {
  const count = Number(process.env.GIT_CONFIG_COUNT ?? 0)
  if (!Number.isSafeInteger(count) || count < 0) {
    refuse('Git command configuration has an invalid entry count.', { countValid: false })
  }
  return {
    ...process.env,
    GIT_CONFIG_COUNT: String(count + 1),
    [`GIT_CONFIG_KEY_${count}`]: 'core.hooksPath',
    [`GIT_CONFIG_VALUE_${count}`]: stage,
  }
}

function generate(repository, stage) {
  const binary = require('lefthook/get-exe').getExePath()
  run(repository.root, binary, ['install', '--force'], stagingEnvironment(stage))
  const files = readdirSync(stage)
  const hook = join(stage, 'pre-commit')
  const info = stat(hook)
  const valid =
    files.length === 1 &&
    files[0] === 'pre-commit' &&
    info?.isFile() &&
    !info.isSymbolicLink() &&
    (process.platform === 'win32' || (info.mode & 0o111) !== 0)
  if (!valid || !readFileSync(hook, 'utf8').includes(rcLine)) {
    refuse(
      'Lefthook produced an unexpected commit-hook layout.',
      {
        files: files.length,
        executableHook: Boolean(valid),
      },
      'Check lefthook.yml and its scripts/lefthook-env.sh rc entry.',
    )
  }
  writeFileSync(join(stage, ownerFile), ownerLayout, { flag: 'wx' })
}

function activate(repository) {
  checkHooksPolicy(repository)
  const plan = migration(repository)
  if (plan.enabled) {
    git(repository.root, [
      'config',
      '--file',
      repository.currentConfig,
      'core.hooksPath',
      hooksPath,
    ])
    return
  }
  if (plan.bare)
    git(repository.root, ['config', '--file', repository.mainConfig, 'core.bare', 'false'])
  git(repository.root, ['config', '--file', repository.currentConfig, 'core.hooksPath', hooksPath])
  if (plan.bare) {
    git(
      repository.root,
      [
        'config',
        '--file',
        join(repository.common, 'config'),
        '--fixed-value',
        '--unset-all',
        'core.bare',
        'false',
      ],
      [0, 5],
    )
  }
  checkHooksPolicy(repository)
  migration(repository)
  git(repository.root, [
    'config',
    '--file',
    join(repository.common, 'config'),
    'extensions.worktreeConfig',
    'true',
  ])
}

function installHooks(cwd = process.cwd()) {
  const repository = inspectRepository(cwd)
  const owned = checkHooksPolicy(repository)
  migration(repository)
  let stage = mkdtempSync(join(repository.root, '.fregat-hooks-stage-'))
  try {
    generate(repository, stage)
    checkHooksPolicy(repository)
    migration(repository)
    if (owned) {
      renameSync(join(stage, 'pre-commit'), join(repository.root, hooksPath, 'pre-commit'))
    } else {
      renameSync(stage, join(repository.root, hooksPath))
      stage = null
    }
    activate(repository)
    const effective = entries(repository.root, 'core.hooksPath')
    if (
      effective.length !== 1 ||
      effective[0].scope !== 'worktree' ||
      effective[0].value !== hooksPath ||
      !fromFile(repository.root, effective[0], repository.currentConfig)
    ) {
      refuse('Git did not select the published private commit hook.', { entries: effective.length })
    }
    return { status: 'installed', hookDirectory: join(repository.root, hooksPath) }
  } finally {
    if (stage) rmSync(stage, { recursive: true, force: true })
  }
}

if (import.meta.main) {
  try {
    installHooks()
    console.log('Installed commit hooks in .fregat-hooks for this checkout.')
  } catch (error) {
    const failure =
      error instanceof EvlogError
        ? error
        : createScriptError('Commit-hook installation failed.', {
            why: 'A filesystem or dependency operation did not complete.',
            fix: 'Check checkout permissions and dependencies, then run hooks:install again.',
            internal: { failureType: error instanceof Error ? error.name : typeof error },
          })
    console.error(scriptFailureText(failure))
    process.exitCode = 1
  }
}
