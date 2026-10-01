#!/usr/bin/env bun
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import path from 'node:path'
import { parseArgs } from 'node:util'

import { productionRoot } from '../deploy/config'
import { createScriptError, scriptErrors, scriptFailureText } from '../structured-errors'

const USAGE =
  'Usage: bun scripts/heavy/install.ts [--commit <rev>] [--source <checkout>] [--root <dir>]'
// run.sh and AGENTS.md name `<root>/current/run.js`, so the root is fixed rather than a setting.
const INSTALL_ROOT = path.join(productionRoot, 'heavy')
const ENTRIES = ['run.ts', 'report.ts', 'status.ts']
const SHELL_SCRIPTS = ['scope.sh', 'nested-scope.sh']

try {
  install()
} catch (error) {
  console.error(scriptFailureText(error))
  process.exit(2)
}

/**
 * Bundles the wrapper from a clean checkout into `<root>/<commit>/` and points `current` at
 * it. Sessions run the installed copy, so editing or pulling a checkout never changes it.
 */
function install() {
  const { values } = parseArgs({
    options: {
      commit: { type: 'string' },
      root: { default: INSTALL_ROOT, type: 'string' },
      source: { default: path.resolve(import.meta.dirname, '../..'), type: 'string' },
    },
  })
  const source = path.resolve(values.source)
  const changes = git(source, ['status', '--porcelain']).split('\n').filter(Boolean).length
  if (changes > 0) throw scriptErrors.HEAVY_INSTALL_DIRTY({ changes, source })

  const head = git(source, ['rev-parse', 'HEAD'])
  const wanted = values.commit
    ? git(source, ['rev-parse', '--verify', `${values.commit}^{commit}`])
    : head
  if (wanted !== head) throw scriptErrors.HEAVY_INSTALL_COMMIT({ head, wanted })

  const root = path.resolve(values.root)
  const target = path.join(root, head)
  const built = !existsSync(target)
  if (built) build(source, root, head)
  pointCurrent(root, head)
  const verb = built ? 'Installed' : 'Already installed'
  console.log(
    `[heavy] ${verb} ${head.slice(0, 9)} at ${target}; ${path.join(root, 'current')} points at it.`,
  )
}

function build(source: string, root: string, commit: string) {
  const staging = path.join(root, `.${commit}.partial-${process.pid}`)
  mkdirSync(staging, { recursive: true })
  const heavy = path.join(source, 'scripts', 'heavy')
  const result = Bun.spawnSync(
    [
      'bun',
      'build',
      ...ENTRIES.map((entry) => path.join(heavy, entry)),
      '--target=bun',
      '--outdir',
      staging,
    ],
    { cwd: source, stderr: 'pipe', stdout: 'pipe' },
  )
  if (result.exitCode !== 0) {
    rmSync(staging, { force: true, recursive: true })
    throw scriptErrors.HEAVY_INSTALL_BUILD({ detail: result.stderr.toString().trim(), source })
  }
  for (const script of SHELL_SCRIPTS) {
    copyFileSync(path.join(heavy, script), path.join(staging, script))
    chmodSync(path.join(staging, script), 0o755)
  }
  writeFileSync(path.join(staging, 'commit'), `${commit}\n`)
  renameSync(staging, path.join(root, commit))
}

// A rename over the old link swaps it in one step, so a job starting mid-install sees one copy.
function pointCurrent(root: string, commit: string) {
  const link = path.join(root, 'current')
  const next = path.join(root, `.current-${process.pid}`)
  rmSync(next, { force: true })
  symlinkSync(commit, next)
  renameSync(next, link)
}

function git(cwd: string, args: readonly string[]) {
  const result = Bun.spawnSync(['git', '-C', cwd, ...args], { stderr: 'pipe', stdout: 'pipe' })
  if (result.exitCode !== 0) {
    throw createScriptError(
      `git ${args.join(' ')} failed in ${cwd}: ${result.stderr.toString().trim()}. ${USAGE}`,
    )
  }
  return result.stdout.toString().trim()
}
