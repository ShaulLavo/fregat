import { readFileSync } from 'node:fs'
import * as v from 'valibot'

import { hostPaths, terminalHostErrors } from './protocol'

const identitySchema = v.object({
  hostPid: v.pipe(v.number(), v.integer(), v.minValue(2)),
  processStart: v.string(),
})
export type HostIdentity = v.InferOutput<typeof identitySchema>

/** Kernel start ticks disambiguate reused Linux pids; ps supplies the macOS fallback. */
export function processStart(pid: number): string | null {
  try {
    if (process.platform === 'linux') {
      const stat = readFileSync(`/proc/${pid}/stat`, 'utf8')
      return stat.slice(stat.lastIndexOf(')') + 2).split(' ')[19] ?? null
    }
    const result = Bun.spawnSync(['ps', '-p', String(pid), '-o', 'lstart='], {
      env: { ...process.env, LC_ALL: 'C' },
      stderr: 'ignore',
    })
    return result.exitCode === 0 ? result.stdout.toString().trim() || null : null
  } catch {
    return null
  }
}

export function readHostIdentity(manifest: string): HostIdentity | null {
  try {
    const parsed = v.safeParse(identitySchema, JSON.parse(readFileSync(manifest, 'utf8')))
    return parsed.success ? parsed.output : null
  } catch {
    return null
  }
}

export function hostIdentityMatches(identity: HostIdentity) {
  return processStart(identity.hostPid) === identity.processStart
}

/** Test/desktop teardown must wait for the host's own shell cleanup before deleting its home. */
export async function stopTerminalHost(stateRoot: string, env: NodeJS.ProcessEnv = process.env) {
  const paths = hostPaths(stateRoot, env)
  const identity = readHostIdentity(paths.manifest)
  if (!identity || !hostIdentityMatches(identity)) return
  try {
    process.kill(identity.hostPid, 'SIGTERM')
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ESRCH') return
    throw error
  }
  const deadline = Date.now() + 5_000
  while (Date.now() < deadline) {
    if (!hostIdentityMatches(identity)) return
    await Bun.sleep(25)
  }
  throw terminalHostErrors.HOST_UNREACHABLE({
    internal: { reason: 'shutdown-timeout', hostPid: identity.hostPid },
  })
}
