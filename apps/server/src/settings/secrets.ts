import { REDACTED_SETTINGS_VALUE } from '@workspace/contracts'
import { isRecord } from '@workspace/utils/objects'
import {
  discardStagedSettingsFile,
  parseSettingsDocument,
  readSettingsFile,
  readSettingsFileSync,
  stageSettingsFile,
  tryCommitStagedSettingsFile,
} from './json-document'
import { SECRET_FILE_MODE } from './transaction'

/**
 * Identifies one provider secret. Deliberately the same pair `restoreRedactedSecrets`
 * already matches on — instance id and variable name, never position — so the
 * wire protocol needs no change; only its backing storage moves.
 */
type ProviderSecretRef = `provider.${string}.env.${string}`

/** The Web Push signing key (VAPID, P-256), base64url. The server creates it; no client reads it. */
export const VAPID_PRIVATE_KEY_REF = 'push.vapid.privateKey'

/** A secret the server generates for itself and never hands to a client. */
export type ServerSecretRef = typeof VAPID_PRIVATE_KEY_REF

export type SecretRef = ProviderSecretRef | ServerSecretRef

export type SecretWriteOutcome = 'committed' | 'unchanged' | 'revision-mismatch'

export function providerEnvSecretRef(instanceId: string, variableName: string): SecretRef {
  return `provider.${instanceId}.env.${variableName}`
}

/**
 * Secrets, kept out of the settings document on purpose.
 *
 * Redaction protects the wire. It does nothing for the disk, and the settings
 * file is served raw (`GET /settings/raw`), opened as an editor tab, and copied
 * by export — three paths that would hand the disk straight back to the channel
 * redaction exists to close. Keeping values here instead makes all three safe by
 * construction rather than by a filter someone has to remember.
 *
 * Deliberately dumber than the settings store: no layers, no registry, no
 * watcher, no scope filter. Not encrypted at rest either — `0600` in `$HOME` is
 * what an SSH private key gets, and matching the OS keychain is its own project.
 * If a keychain lands later it replaces these two functions and nothing else.
 */
export class SecretStore {
  private readonly filePath: string

  constructor(filePath: string) {
    this.filePath = filePath
  }

  readSync(): Map<SecretRef, string> {
    return this.toSecrets(readSettingsFileSync(this.filePath).text)
  }

  async read(): Promise<Map<SecretRef, string>> {
    return this.toSecrets((await readSettingsFile(this.filePath)).text)
  }

  private toSecrets(text: string): Map<SecretRef, string> {
    const { values } = parseSettingsDocument(text)
    const secrets = new Map<SecretRef, string>()

    for (const [ref, value] of Object.entries(values)) {
      if (typeof value !== 'string') continue
      secrets.set(ref as SecretRef, value)
    }

    return secrets
  }

  async prepare(edits: ReadonlyMap<SecretRef, string | null>): Promise<{
    readonly changed: boolean
    readonly expectedRevision: string | null
    readonly text: string
  }> {
    const source = await readSettingsFile(this.filePath)
    const current = this.toSecrets(source.text)
    const next = new Map(current)
    for (const [ref, value] of edits) {
      if (value === null || value === '') {
        next.delete(ref)
        continue
      }

      next.set(ref, value)
    }

    return {
      changed: !secretMapsEqual(current, next),
      expectedRevision: source.revision,
      text: serializeSecrets(next),
    }
  }

  /**
   * Writes edits with no settings change beside them. The caller holds the
   * settings write coordinator for this file, so a revision mismatch here is
   * another process writing the file.
   */
  async write(edits: ReadonlyMap<SecretRef, string | null>): Promise<SecretWriteOutcome> {
    const prepared = await this.prepare(edits)
    if (!prepared.changed) return 'unchanged'

    const staged = await stageSettingsFile(this.filePath, prepared.text, SECRET_FILE_MODE)
    const outcome = await tryCommitStagedSettingsFile(staged, prepared.expectedRevision)
    if (outcome.kind === 'committed') return 'committed'

    await discardStagedSettingsFile(staged)
    return 'revision-mismatch'
  }
}

/**
 * Rewrites every environment variable of every instance, keyed by instance id
 * and variable name.
 *
 * Matching on the pair rather than on position is the rule the wire protocol
 * already follows: reordering or removing rows must never move a secret onto a
 * different variable.
 */
function mapEnvironment(
  instances: unknown,
  rewrite: (ref: SecretRef, value: string) => string,
): unknown {
  if (!Array.isArray(instances)) return instances

  return instances.map((instance) => {
    if (!isRecord(instance) || !Array.isArray(instance.environment)) return instance

    const id = typeof instance.providerInstanceId === 'string' ? instance.providerInstanceId : ''
    const environment = instance.environment.map((variable) => {
      if (!isRecord(variable) || typeof variable.name !== 'string') return variable

      const value = typeof variable.value === 'string' ? variable.value : ''

      return { ...variable, value: rewrite(providerEnvSecretRef(id, variable.name), value) }
    })

    return { ...instance, environment }
  })
}

/**
 * Splits provider values typed into the raw JSON hatch.
 *
 * Non-empty literals move to the secret store; empty values and masks preserve
 * existing secrets. Semantic provider intent carries no credential values.
 */
export function extractRawProviderSecrets(instances: unknown): {
  readonly instances: unknown
  readonly secrets: Map<SecretRef, string>
} {
  const secrets = new Map<SecretRef, string>()
  const stripped = mapEnvironment(instances, (ref, value) => {
    if (value !== '' && value !== REDACTED_SETTINGS_VALUE) secrets.set(ref, value)

    return ''
  })

  return { instances: stripped, secrets }
}

/** Puts stored values back on their variables, for the spawn path only. */
export function applyProviderSecrets<T>(instances: T, secrets: ReadonlyMap<SecretRef, string>): T {
  return mapEnvironment(instances, (ref) => secrets.get(ref) ?? '') as T
}

/**
 * What a client sees: the mask where a secret exists, empty where none does.
 * Never the value — this is the only shape that leaves the process.
 */
export function maskProviderSecrets<T>(instances: T, secrets: ReadonlySet<SecretRef>): T {
  return mapEnvironment(instances, (ref) => (secrets.has(ref) ? REDACTED_SETTINGS_VALUE : '')) as T
}

function serializeSecrets(secrets: ReadonlyMap<SecretRef, string>): string {
  // This file is not hand-edited. Stable key order makes recovery hashes and
  // operator diffs deterministic without exposing any value to telemetry.
  const entries = [...secrets.entries()].sort(([a], [b]) => a.localeCompare(b))

  return `${JSON.stringify(Object.fromEntries(entries), null, 2)}\n`
}

function secretMapsEqual(
  left: ReadonlyMap<SecretRef, string>,
  right: ReadonlyMap<SecretRef, string>,
): boolean {
  if (left.size !== right.size) return false

  for (const [ref, value] of left) {
    if (right.get(ref) !== value) return false
  }

  return true
}
