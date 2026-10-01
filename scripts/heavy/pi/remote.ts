import { shellQuote } from '../../../apps/server/src/utils/shell'
import { createScriptError } from '../../structured-errors'
import { laneRoot } from './lane-root'

export const LANE_MARKER = '.fregat-lane'

type Input = string | Uint8Array

/** Runs a local command and returns its output; the caller decides what a failure means. */
export function run(cmd: readonly string[], input?: Input) {
  const child = Bun.spawnSync([...cmd], {
    stdin: input === undefined ? 'ignore' : Buffer.from(input),
    stdout: 'pipe',
    stderr: 'pipe',
  })
  return { exitCode: child.exitCode, stdout: child.stdout, stderr: child.stderr.toString() }
}

export function check(cmd: readonly string[], what: string, input?: Input) {
  const result = run(cmd, input)
  if (result.exitCode !== 0) {
    throw createScriptError(
      `${what} failed with exit ${result.exitCode}: ${result.stderr.trim().slice(-600) || 'no output'}`,
    )
  }
  return result.stdout
}

/** Runs shell text on the host. Every data argument inside `script` must already be quoted. */
export function remote(host: string, script: string, what: string, input?: Input) {
  return check(['ssh', '-o', 'BatchMode=yes', host, script], what, input)
}

export function remoteOk(host: string, script: string) {
  return run(['ssh', '-o', 'BatchMode=yes', host, script]).exitCode === 0
}

export function resolveLane(host: string, name: string) {
  const home = remote(host, 'printf %s "$HOME"', `Reading the home directory on ${host}`).toString()
  return laneRoot(home, name)
}

/** Refuses a lane that is a symlink, resolves elsewhere, or was not created by setup. */
export function verifyLane(host: string, root: string) {
  const r = shellQuote(root)
  const platform = shellQuote(`${root}/platform`)
  const script = [
    `test -d ${r} && test ! -L ${r}`,
    `[ "$(realpath -e ${r})" = ${r} ]`,
    `test -f ${shellQuote(`${root}/${LANE_MARKER}`)}`,
    `test ! -L ${platform}`,
    `[ "$(git -C ${platform} rev-parse --show-toplevel)" = ${platform} ]`,
  ].join(' && ')
  if (!remoteOk(host, script)) {
    throw createScriptError(
      `${host}:${root} is not a lane checkout setup created (a real directory holding ${LANE_MARKER} and a git checkout in platform/). Run scripts/heavy/pi/setup.ts.`,
    )
  }
}
