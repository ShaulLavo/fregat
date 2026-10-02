#!/usr/bin/env bun
// Provisions the Raspberry Pi lane from this machine. Safe to rerun: each step checks first.
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { parseArgs } from 'node:util'
import { shellQuote } from '../../../apps/server/src/utils/shell'
import { createScriptError, scriptFailureText } from '../../structured-errors'
import { cmdlineWriteScript, repairCmdline } from './cmdline'
import { prerequisitesScript } from './prerequisites'
import { check, LANE_MARKER, remote, remoteOk, resolveLane, run } from './remote'
import { fregatCheckout } from './checkout'
import { holdLaneLock } from './lane-lock'
import { builtWorkspaces, syncLane } from './sync'

const USAGE =
  'bun scripts/heavy/pi/setup.ts [--host pi] [--lane fregat-lane] [--enable-cgroups] [--lock-dir DIR]'
const CMDLINE = '/boot/firmware/cmdline.txt'
const CMDLINE_BACKUP = `${CMDLINE}.before-lane`
const KERNEL_READY =
  'grep -qw memory /sys/fs/cgroup/cgroup.controllers && test -e /proc/pressure/memory'
const ORIGIN = /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+$/
const VERSION = /^\d+\.\d+\.\d+$/
const REBOOT_WAIT_MS = 5 * 60_000

const step = (message: string) => console.log(`[pi-lane] ${message}`)

function reachable(host: string) {
  return run(['ssh', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=5', host, 'true']).exitCode === 0
}

async function rebootAndWait(host: string) {
  // The connection drops as the Pi goes down, so the reboot's own exit status means nothing.
  run(['ssh', '-o', 'BatchMode=yes', host, 'sudo -n systemctl reboot'])
  await Bun.sleep(20_000)
  const deadline = Date.now() + REBOOT_WAIT_MS
  while (!reachable(host)) {
    if (Date.now() > deadline) {
      throw createScriptError(
        `${host} did not answer ssh within ${REBOOT_WAIT_MS / 60_000} minutes of rebooting.`,
      )
    }
    await Bun.sleep(5_000)
  }
}

/** The Raspberry Pi kernel boots with cgroup_disable=memory and no PSI: MemoryMax is ignored. */
async function enableCgroups(host: string, allowed: boolean) {
  if (remoteOk(host, KERNEL_READY)) return
  if (!allowed) {
    throw createScriptError(
      `${host} lacks the memory cgroup or PSI. Rerun with --enable-cgroups to fix ${CMDLINE} and reboot.`,
    )
  }
  const current = remote(host, `cat ${shellQuote(CMDLINE)}`, `Reading ${CMDLINE}`).toString()
  const repaired = repairCmdline(current)
  if (repaired.added.length > 0) {
    step(
      `adding ${repaired.added.join(' ')} to ${CMDLINE} (first backup kept at ${CMDLINE_BACKUP})`,
    )
    remote(
      host,
      cmdlineWriteScript(CMDLINE, CMDLINE_BACKUP, 'sudo -n'),
      `Writing ${CMDLINE}`,
      repaired.text,
    )
    const written = remote(host, `cat ${shellQuote(CMDLINE)}`, `Rereading ${CMDLINE}`).toString()
    if (written !== repaired.text)
      throw createScriptError(
        `${CMDLINE} on ${host} does not hold the line just written; not rebooting.`,
      )
  }
  step(`rebooting ${host}`)
  await rebootAndWait(host)
  if (!remoteOk(host, KERNEL_READY)) {
    throw createScriptError(`${host} came back without the memory cgroup or PSI; check ${CMDLINE}.`)
  }
}

function installRuntime(host: string, lane: string, bunVersion: string, origin: string) {
  const r = shellQuote(lane)
  remote(
    host,
    [
      'set -eu',
      prerequisitesScript(),
      `[ "$("$HOME/.bun/bin/bun" --version 2>/dev/null)" = ${shellQuote(bunVersion)} ] || curl -fsSL https://bun.sh/install | bash -s ${shellQuote(`bun-v${bunVersion}`)} >/dev/null`,
      'mkdir -p "$HOME/.local/bin"',
      'ln -sf "$HOME/.bun/bin/bun" "$HOME/.local/bin/bun"',
      'ln -sf "$HOME/.bun/bin/bun" "$HOME/.local/bin/bunx"',
      `test ! -L ${r}`,
      `mkdir -p ${shellQuote(`${lane}/runs`)}`,
      `[ "$(realpath -e ${r})" = ${r} ]`,
      `touch ${shellQuote(`${lane}/${LANE_MARKER}`)}`,
      `[ -d ${shellQuote(`${lane}/platform/.git`)} ] || git clone --quiet ${shellQuote(origin)} ${shellQuote(`${lane}/platform`)}`,
    ].join('\n'),
    `Installing git, rsync, Bun ${bunVersion} and the lane checkout`,
  )
}

try {
  const { values } = parseArgs({
    options: {
      host: { type: 'string', default: 'pi' },
      lane: { type: 'string', default: 'fregat-lane' },
      'enable-cgroups': { type: 'boolean', default: false },
      'lock-dir': { type: 'string' },
      help: { type: 'boolean' },
    },
  })
  if (values.help) {
    console.log(USAGE)
    process.exit(0)
  }
  const host = values.host
  const root = fregatCheckout()
  // Setup ends with a sync, which needs these; failing now beats failing after a reboot.
  builtWorkspaces(root)
  const bunVersion =
    /"packageManager": "bun@([^"]+)"/.exec(
      readFileSync(path.join(root, 'package.json'), 'utf8'),
    )?.[1] ?? ''
  if (!VERSION.test(bunVersion))
    throw createScriptError(`package.json packageManager names no Bun version (${bunVersion}).`)
  const origin = check(['git', '-C', root, 'remote', 'get-url', 'origin'], 'Reading origin')
    .toString()
    .trim()
    .replace(/\.git$/, '')
  if (!ORIGIN.test(origin))
    throw createScriptError(`origin ${origin} is not a public GitHub https URL the Pi can clone.`)

  // Setup reboots the Pi and replaces its checkout; no lane job may run meanwhile.
  await holdLaneLock('setup.ts', values['lock-dir'])
  if (!reachable(host)) {
    throw createScriptError(
      `ssh ${host} failed. Add a \`Host ${host}\` block with the Pi's tailnet address, \`User pi\` and the key the Pi authorizes (README.md).`,
    )
  }
  if (run(['mesh', host, '--', 'true']).exitCode !== 0) {
    step(`adopting ${host} into mesh`)
    check(['mesh', 'add', host, '--alias', host], `mesh add ${host}`)
  }
  await enableCgroups(host, values['enable-cgroups'])
  const lane = resolveLane(host, values.lane)
  step(`git, rsync, Bun ${bunVersion} and ${lane} on ${host}`)
  installRuntime(host, lane, bunVersion, origin)
  step('syncing this checkout')
  syncLane({ host, lane: values.lane })
  step(`Playwright Chromium and its system libraries on ${host}`)
  // Under Bun: Playwright's CLI has a Node shebang and the lane installs no Node.
  remote(
    host,
    `cd ${shellQuote(`${lane}/platform`)} && PATH=$HOME/.local/bin:$PATH bunx --bun playwright install --with-deps chromium >/dev/null`,
    'Installing Playwright Chromium',
  )
  console.log(
    remote(
      host,
      'printf "[pi-lane] ready: %s, %s, %s CPU, %s MiB, Bun %s\\n" "$(tr -d "\\0" </proc/device-tree/model)" "$(uname -m)" "$(nproc)" "$(($(sed -n "s/MemTotal: *\\([0-9]*\\).*/\\1/p" /proc/meminfo) / 1024))" "$($HOME/.local/bin/bun --version)"',
      'Reading the lane summary',
    )
      .toString()
      .trim(),
  )
} catch (error) {
  console.error(scriptFailureText(error))
  process.exit(1)
}
