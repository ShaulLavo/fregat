import type { AgentDiagnosticsSource } from '../lsp/agent-diagnostics'
import type { ProviderDriverKind, ProviderInstanceId } from '@workspace/contracts'
import type { ProviderAdapter } from './types'

/**
 * Driver SPI — a driver is a plain value, registered at startup, that knows how
 * to materialize N independent instances of one provider. Nothing here is a
 * singleton: two Codex accounts are two `ProviderInstanceHandle`s produced by
 * one `CodexDriver`, each with its own home, credentials and child processes.
 *
 * The split that matters: `driverKind` says *how* to talk to a provider,
 * `providerInstanceId` says *which account* is being talked to. Sessions,
 * credentials and resume cursors belong to the instance, never to the kind.
 */

export type ProviderEnvironmentVariable = {
  name: string
  value: string
}

/**
 * One configured instance as the settings layer stores it. `config` stays
 * opaque (`unknown`) on purpose: an entry naming a driver this build does not
 * ship must still parse, so the registry can surface it as unavailable instead
 * of failing the whole settings load.
 */
export type ProviderInstanceConfig = {
  /** Explicit path to the provider CLI; empty resolves it from `PATH`. */
  binaryPath?: string
  config?: unknown
  /** `null` keeps the driver's own name instead of pinning a user-facing one. */
  displayLabel?: string | null
  driverKind: ProviderDriverKind
  enabled?: boolean
  /** User-supplied env overrides, applied after the driver's own derived vars. */
  environment?: readonly ProviderEnvironmentVariable[]
  providerInstanceId: ProviderInstanceId
}

/**
 * Static capability surface, declared by the driver rather than discovered from
 * an adapter object. `multiInstance` is the one the registry enforces: a driver
 * wrapping a global resource (a single desktop socket) rejects a second
 * instance with an explicit error instead of silently sharing state.
 */
type ProviderDriverCapabilities = ProviderAdapter['capabilities'] & {
  multiInstance: boolean
}

/** App services a driver may hand its adapter; absent in tests and harnesses. */
export type ProviderDriverServices = {
  readonly agentDiagnostics?: AgentDiagnosticsSource
}

type ProviderDriverCreateInput<Config> = {
  /** Settings-level binary override. Drivers that get their binary elsewhere ignore it. */
  binaryPath?: string
  config: Config
  displayLabel: string
  enabled: boolean
  /** Fully resolved spawn env: base env + driver-derived vars + user overrides. */
  env: NodeJS.ProcessEnv
  providerInstanceId: ProviderInstanceId
  services: ProviderDriverServices
}

type ProviderInstanceHandle = {
  adapter: ProviderAdapter
  /**
   * Releases everything the instance opened — child processes above all. Called
   * on removal from settings and on server shutdown; must never throw.
   */
  dispose: () => Promise<void>
}

export type ProviderDriver<Config> = {
  capabilities: ProviderDriverCapabilities
  /**
   * Files whose existence or contents decide sign-in state. The registry
   * watches them so an `codex login` run in a terminal updates availability
   * without a restart.
   */
  credentialPaths: (input: { config: Config; env: NodeJS.ProcessEnv }) => readonly string[]
  /**
   * Materializes one instance. Two calls with different ids MUST NOT share
   * mutable state — that is the whole point of the SPI.
   */
  create: (input: ProviderDriverCreateInput<Config>) => Promise<ProviderInstanceHandle>
  defaultConfig: () => Config
  displayName: string
  driverKind: ProviderDriverKind
  /** Env vars derived from this instance's config (its home / credential dir). */
  environment: (config: Config) => ProviderEnvironmentVariable[]
  /** Decodes the opaque envelope once, at registration time. Throws on garbage. */
  parseConfig: (config: unknown) => Config
}

/**
 * Heterogeneous-array shim. `any` erases the per-driver `Config`, which is
 * exactly what the registry wants: it decodes the envelope through
 * `parseConfig` and hands the result straight back to `create`, so the concrete
 * type never escapes the driver. `unknown` would make every driver's `create`
 * unassignable under `strictFunctionTypes`.
 */
export type AnyProviderDriver = ProviderDriver<any>

/**
 * Identity a resume cursor belongs to. A cursor minted by one account is
 * meaningless to another, so it may only travel between sessions that share
 * this key — the same driver *and* the same instance.
 */
export function providerContinuationKey(input: {
  driverKind: ProviderDriverKind
  providerInstanceId: ProviderInstanceId
}) {
  return `${input.driverKind}:instance:${input.providerInstanceId}`
}
