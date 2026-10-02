import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import type { MachineServiceIntent } from '../../packages/contracts/src/server-identity'
import { descriptorFor } from '../../packages/contracts/src/settings/keys'
import { tryFileLock } from '../../apps/server/src/system/file-lock'
import {
  createRelease,
  currentRelease,
  pendingRelease,
  releaseAt,
  stagePending,
  swapCurrent,
  type Release,
} from '../deploy/release-operations'
import { releaseProblem } from '../deploy/systemd/promote'
import { serviceErrors } from './structured-errors'

export type BundledInstall = { disposition: 'installed' | 'staged' | 'unchanged'; release: Release }

/** Copies immutable payloads; only the first installation can change current without approval. */
export function installBundledRelease(
  source: string,
  root: string,
  intent: MachineServiceIntent,
  options: { readinessMs?: number } = {},
): BundledInstall {
  mkdirSync(root, { recursive: true })
  const lock = tryFileLock(path.join(root, 'release-install.lock'))
  if (!lock) throw serviceErrors.SETUP_BUSY({ internal: { stage: 'bundled-release' } })
  try {
    return install(source, root, intent, options)
  } finally {
    lock.release()
  }
}

function install(
  source: string,
  root: string,
  intent: MachineServiceIntent,
  options: { readinessMs?: number },
): BundledInstall {
  const config = readConfig(source)
  const problem = releaseProblem(source)
  if (problem || !config)
    throw serviceErrors.REGISTRATION_FAILED({
      internal: { stage: 'bundled-release', validConfig: !!config, validFiles: !problem },
    })
  const current = currentRelease(root)
  if (current && readConfig(current)?.commit === config.commit)
    return { disposition: 'unchanged', release: releaseAt(current) }
  const pending = pendingRelease(root)
  if (current && pending && readConfig(pending)?.commit === config.commit)
    return { disposition: 'staged', release: releaseAt(pending, current) }
  const release = createRelease(root, config.commit, 'app')
  try {
    cpSync(source, release.directory, { recursive: true, verbatimSymlinks: true })
    writeFileSync(
      path.join(release.directory, 'build-config.json'),
      JSON.stringify({
        ...config,
        release: release.name,
        previousRelease: current ? path.basename(current) : null,
        readiness: {
          ...intent,
          timeoutMs:
            options.readinessMs ?? descriptorFor('server.activationTimeoutSeconds').default * 1000,
        },
      }),
    )
    if (current) stagePending(root, release)
    else swapCurrent(root, release)
  } catch (error) {
    rmSync(release.directory, { recursive: true, force: true })
    throw error
  }
  return { disposition: current ? 'staged' : 'installed', release }
}

/** A failed first activation keeps its copied release for diagnostics and retries. */
export function rollbackBundledInstall(root: string, result: BundledInstall) {
  if (result.disposition !== 'installed' || currentRelease(root) !== result.release.directory)
    return
  rmSync(path.join(root, 'current'), { force: true })
}

function readConfig(directory: string): (Record<string, unknown> & { commit: string }) | null {
  try {
    const value = JSON.parse(readFileSync(path.join(directory, 'build-config.json'), 'utf8'))
    if (typeof value?.commit !== 'string' || !/^[a-f0-9]{40}$/.test(value.commit)) return null
    return value
  } catch {
    return null
  }
}
