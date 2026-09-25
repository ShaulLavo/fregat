import { realpathSync } from 'node:fs'
import os from 'node:os'
import { MutationObserver, QueryCache, QueryClient } from '@tanstack/query-core'
import * as v from 'valibot'
import type {
  ProviderDriverKind,
  ProviderInstanceId,
  ProviderUpdateAdvisory,
  ProviderUpdateResult,
} from '@workspace/contracts'
import { recordProcessInfo, recordProcessWarning } from '../observability/runtime'
import { createStructuredError } from '../observability/structured-errors'
import type { ProviderAdapterRegistry } from './provider-adapter-registry'
import { sessionIdentityErrors } from './structured-errors'
import { readCliVersion } from './utils/cli-version'
import { providerPackage, providerUpdatePlan, type ProviderUpdatePlan } from './utils/update-method'

const LATEST_STALE_MS = 60 * 60_000
const UPDATE_TIMEOUT_MS = 5 * 60_000
const OUTPUT_LIMIT = 10_000
const FAILURE_TAIL = 400

const npmLatestSchema = v.object({ version: v.string() })

type Fetcher = (url: string, init?: RequestInit) => Promise<Response>

type UpdateCommandResult = { exitCode: number | null; output: string; timedOut: boolean }

/** Everything maintenance asks the machine. Tests replace it so nothing is installed. */
type ProviderMaintenanceProbe = {
  fetcher: Fetcher
  realPath: (filePath: string) => string
  run: (argv: readonly string[], env: NodeJS.ProcessEnv) => Promise<UpdateCommandResult>
  version: (executablePath: string, env: NodeJS.ProcessEnv) => Promise<string | null>
}

const defaultProbe: ProviderMaintenanceProbe = {
  fetcher: fetch,
  realPath: (filePath) => realpathSync(filePath),
  run: runUpdateCommand,
  version: readCliVersion,
}

type Registry = Pick<ProviderAdapterRegistry, 'refreshSnapshot' | 'updateTarget'>

type Inspection = { advisory: ProviderUpdateAdvisory; plan: ProviderUpdatePlan }

/**
 * Reads whether an instance's CLI is behind the published release, and updates it
 * where the install's owner is proven. Updates sharing an install run one at a time.
 */
export class ProviderMaintenance {
  private readonly client = new QueryClient({
    queryCache: new QueryCache({
      onError: (error) =>
        recordProcessWarning('provider.maintenance.latest_failed', { error, fallback: 'unknown' }),
    }),
  })
  private readonly registry: Registry
  private readonly probe: ProviderMaintenanceProbe

  constructor(registry: Registry, probe: Partial<ProviderMaintenanceProbe> = {}) {
    this.registry = registry
    this.probe = { ...defaultProbe, ...probe }
  }

  async advisory(providerInstanceId: ProviderInstanceId) {
    return (await this.inspect(providerInstanceId)).advisory
  }

  /** A second call while one runs queues behind it, then finds nothing left to do. */
  async update(providerInstanceId: ProviderInstanceId): Promise<ProviderUpdateResult> {
    const { plan } = await this.inspect(providerInstanceId)
    const observer = new MutationObserver(this.client, {
      mutationKey: ['provider', 'update', providerInstanceId],
      mutationFn: () => this.runUpdate(providerInstanceId),
      scope: { id: plan.lockKey },
    })
    return observer.mutate()
  }

  close() {
    this.client.clear()
  }

  private async runUpdate(providerInstanceId: ProviderInstanceId): Promise<ProviderUpdateResult> {
    const before = await this.inspect(providerInstanceId)
    if (before.advisory.status === 'current')
      return { advisory: before.advisory, outcome: 'unchanged' }
    if (!before.plan.argv) {
      throw sessionIdentityErrors.UPDATE_MANUAL_ONLY({
        internal: { method: before.plan.method, providerInstanceId },
      })
    }

    const { env } = this.registry.updateTarget(providerInstanceId)
    const startedAt = Date.now()
    const result = await this.probe.run(before.plan.argv, env)
    if (result.timedOut || result.exitCode !== 0) throw updateFailed(before, result)

    const after = await this.settle(providerInstanceId)
    const outcome =
      after.advisory.installedVersion !== before.advisory.installedVersion ? 'updated' : 'unchanged'
    recordProcessInfo('provider.maintenance.updated', {
      durationMs: Date.now() - startedAt,
      from: before.advisory.installedVersion,
      method: before.plan.method,
      outcome,
      providerInstanceId,
      to: after.advisory.installedVersion,
    })
    return { advisory: after.advisory, outcome }
  }

  /** The adapter re-resolves its CLI and the snapshot re-probes it, so the catalog follows. */
  private async settle(providerInstanceId: ProviderInstanceId) {
    const { adapter } = this.registry.updateTarget(providerInstanceId)
    adapter.forgetExecutable?.()
    await this.registry.refreshSnapshot(providerInstanceId).catch((error: unknown) => {
      recordProcessWarning('provider.maintenance.refresh_failed', { error, providerInstanceId })
    })
    return this.inspect(providerInstanceId)
  }

  private async inspect(providerInstanceId: ProviderInstanceId): Promise<Inspection> {
    const { adapter, env } = this.registry.updateTarget(providerInstanceId)
    const commandPath = (await adapter.executablePath?.()) ?? null
    const install = commandPath ? this.install(commandPath, env) : null
    const plan: ProviderUpdatePlan = install
      ? providerUpdatePlan(adapter.driverKind, install)
      : { argv: null, command: null, lockKey: `instance:${providerInstanceId}`, method: 'unknown' }
    const [installedVersion, latestVersion] = await Promise.all([
      install ? this.probe.version(install.commandPath, env) : null,
      this.latestVersion(adapter.driverKind),
    ])

    return {
      advisory: {
        canUpdate: plan.argv !== null,
        checkedAt: new Date().toISOString(),
        command: plan.command,
        installedVersion,
        latestVersion,
        method: plan.method,
        providerInstanceId,
        status: versionStatus(installedVersion, latestVersion),
      },
      plan,
    }
  }

  private install(commandPath: string, env: NodeJS.ProcessEnv) {
    try {
      return {
        commandPath,
        home: env.HOME ?? os.homedir(),
        realPath: this.probe.realPath(commandPath),
      }
    } catch {
      // Not on disk: the snapshot already reports the CLI as not installed.
      return null
    }
  }

  private async latestVersion(driverKind: ProviderDriverKind) {
    const npm = providerPackage(driverKind)
    if (!npm) return null
    try {
      return await this.client.fetchQuery({
        queryKey: ['provider', 'latest-version', npm],
        queryFn: ({ signal }) => this.fetchLatest(npm, signal),
        staleTime: LATEST_STALE_MS,
        networkMode: 'always',
        retry: 1,
        retryDelay: 1_000,
      })
    } catch {
      // QueryCache records the failure; the row reads "unknown" until the next check.
      return null
    }
  }

  private async fetchLatest(npm: string, signal: AbortSignal) {
    const response = await this.probe.fetcher(`https://registry.npmjs.org/${npm}/latest`, {
      signal: AbortSignal.any([signal, AbortSignal.timeout(10_000)]),
    })
    if (!response.ok) {
      throw createStructuredError({
        code: 'provider.LATEST_VERSION_UNAVAILABLE',
        status: 502,
        message: `The npm registry answered HTTP ${response.status} for ${npm}.`,
        why: 'The latest published version could not be read.',
        fix: 'Check the connection to registry.npmjs.org; the next check retries.',
      })
    }
    return v.parse(npmLatestSchema, await response.json()).version
  }
}

function versionStatus(installed: string | null, latest: string | null) {
  if (!installed || !latest) return 'unknown' as const
  return Bun.semver.order(installed, latest) < 0 ? ('behind' as const) : ('current' as const)
}

function updateFailed(before: Inspection, result: UpdateCommandResult) {
  const tail = result.output.trim().slice(-FAILURE_TAIL)
  const reason = result.timedOut ? 'timed out' : `exited with code ${result.exitCode}`
  return createStructuredError({
    code: 'provider.UPDATE_FAILED',
    status: 502,
    message: `\`${before.plan.command}\` ${reason}.`,
    why: tail || 'The command printed nothing.',
    fix: 'Run the command in a terminal to see the whole output. The installed CLI is unchanged.',
    internal: {
      exitCode: result.exitCode,
      method: before.plan.method,
      providerInstanceId: before.advisory.providerInstanceId,
      timedOut: result.timedOut,
    },
  })
}

async function runUpdateCommand(
  argv: readonly string[],
  env: NodeJS.ProcessEnv,
): Promise<UpdateCommandResult> {
  const [command, ...args] = argv
  const executable = command ? Bun.which(command, { PATH: env.PATH ?? '' }) : null
  if (!executable)
    return { exitCode: 127, output: `${command ?? ''}: command not found`, timedOut: false }

  const child = Bun.spawn([executable, ...args], {
    env,
    stderr: 'pipe',
    stdin: 'ignore',
    stdout: 'pipe',
    timeout: UPDATE_TIMEOUT_MS,
  })
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ])
  const output = `${stdout}${stderr}`.slice(-OUTPUT_LIMIT)
  return { exitCode, output, timedOut: child.signalCode !== null && exitCode !== 0 }
}
