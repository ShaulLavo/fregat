#!/usr/bin/env bun
// Mirrors this checkout onto the Pi lane: its commit, its tracked changes and its built
// workspaces, so the bench's git provenance on the Pi describes the tree measured here.
import { existsSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { parseArgs } from 'node:util'
import { shellQuote } from '../../../apps/server/src/utils/shell'
import { createScriptError, scriptFailureText } from '../../structured-errors'
import { check, remote, resolveLane, verifyLane } from './remote'
import { fregatCheckout } from './checkout'
import { holdLaneLock } from './lane-lock'
import { shipPlan } from './transfer'

const USAGE =
  'bun scripts/heavy/pi/sync.ts [--host pi] [--lane fregat-lane] [--web <built web dir>] [--include <untracked file>]… [--max-transfer-mib 64] [--lock-dir DIR]'
const BUILD_PARENTS = ['editor/packages', 'hotkeys/packages']

export type SyncOptions = {
  readonly host: string
  readonly lane: string
  readonly web?: string
  readonly includes?: readonly string[]
  readonly maxTransferMiB?: number
}

/** Workspace packages resolve through dist/, and the Pi builds nothing. */
export function builtWorkspaces(root: string) {
  if (!existsSync(path.join(root, 'editor/packages/editor/dist/index.js'))) {
    throw createScriptError(
      `No built workspaces in ${root}. Run \`bun run build:workspaces\` through the heavy wrapper first.`,
    )
  }
  const parents = BUILD_PARENTS.flatMap((parent) =>
    readdirSync(path.join(root, parent)).map((name) => path.join(parent, name)),
  )
  return [...parents, 'ghostty-webgpu']
    .map((dir) => path.join(dir, 'dist'))
    .filter((dist) => existsSync(path.join(root, dist)))
}

/**
 * Copies each built dist/ to the same path under `destination`. The `/./` marks where the kept
 * relative path starts, so the copy works from any directory, as `--host pi` runs it.
 */
export function buildsTransfer(root: string, builds: readonly string[], destination: string) {
  return ['rsync', '-aR', '--delete', ...builds.map((dist) => `${root}/./${dist}`), destination]
}

export function syncLane(options: SyncOptions) {
  const root = fregatCheckout()
  const builds = builtWorkspaces(root)
  const plan = shipPlan(root, options.includes ?? [], (options.maxTransferMiB ?? 64) * 2 ** 20)
  const lane = resolveLane(options.host, options.lane)
  verifyLane(options.host, lane)
  const platform = `${lane}/platform`
  const commit = check(['git', '-C', root, 'rev-parse', 'HEAD'], 'Reading HEAD').toString().trim()

  // A ref the lane checkout never has checked out, so the push is never refused.
  check(
    [
      'git',
      '-C',
      root,
      'push',
      '--quiet',
      '--no-verify',
      '--force',
      `${options.host}:${platform}`,
      'HEAD:refs/heads/lane',
    ],
    'Pushing HEAD to the lane',
  )
  const cd = `cd ${shellQuote(platform)}`
  remote(
    options.host,
    `${cd} && git checkout --quiet --force --detach ${commit} && git clean -fdq`,
    'Checking out the lane commit',
  )
  remote(
    options.host,
    `${cd} && git apply --allow-empty --whitespace=nowarn`,
    'Applying tracked changes',
    plan.diff,
  )
  if (plan.includes.length > 0) {
    check(
      ['rsync', '-a', '--from0', '--files-from=-', `${root}/`, `${options.host}:${platform}/`],
      'Copying included files',
      plan.includes.join('\0'),
    )
  }
  check(buildsTransfer(root, builds, `${options.host}:${platform}/`), 'Copying built workspaces')
  // Tree-sitter grammar packages build native bindings with no arm64 prebuild; the editor loads wasm.
  remote(
    options.host,
    `${cd} && PATH=$HOME/.local/bin:$PATH bun install --frozen-lockfile --ignore-scripts >/dev/null 2>&1`,
    'bun install on the lane',
  )
  if (options.web) {
    if (!existsSync(path.join(options.web, 'index.html'))) {
      throw createScriptError(`No production web build at ${options.web}.`)
    }
    check(
      ['rsync', '-a', '--delete', `${path.resolve(options.web)}/`, `${options.host}:${lane}/web/`],
      'Copying the web build',
    )
  }
  console.log(
    `[pi-lane] synced ${commit.slice(0, 9)} + ${plan.bytes} bytes of changes and includes to ${options.host}:${platform}${options.web ? `, web to ${lane}/web` : ''}`,
  )
  if (plan.omitted.length > 0) {
    console.log(
      `[pi-lane] ${plan.omitted.length} untracked files stayed here (name them with --include): ${plan.omitted.slice(0, 5).join(', ')}${plan.omitted.length > 5 ? ', …' : ''}`,
    )
  }
}

if (import.meta.main) {
  try {
    const { values } = parseArgs({
      options: {
        host: { type: 'string', default: 'pi' },
        lane: { type: 'string', default: 'fregat-lane' },
        web: { type: 'string' },
        include: { type: 'string', multiple: true, default: [] },
        'max-transfer-mib': { type: 'string', default: '64' },
        'lock-dir': { type: 'string' },
        help: { type: 'boolean' },
      },
    })
    if (values.help) {
      console.log(USAGE)
      process.exit(0)
    }
    const maxTransferMiB = Number(values['max-transfer-mib'])
    if (!Number.isSafeInteger(maxTransferMiB) || maxTransferMiB <= 0) {
      throw createScriptError(`--max-transfer-mib must be a positive integer. ${USAGE}`)
    }
    // Local checks first, so a wrong checkout fails without waiting for the lock.
    builtWorkspaces(fregatCheckout())
    await holdLaneLock('sync.ts', values['lock-dir'])
    syncLane({
      host: values.host,
      lane: values.lane,
      web: values.web,
      includes: values.include,
      maxTransferMiB,
    })
  } catch (error) {
    console.error(scriptFailureText(error))
    process.exit(1)
  }
}
