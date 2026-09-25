import { defineErrorCatalog } from 'evlog'

/**
 * Settings failures the client has to branch on.
 *
 * Each one is a different answer to "why did my save not take": the value was
 * wrong, the key does not exist, the layer may not carry it, the file is broken,
 * someone else edited it, or an administrator owns it. Collapsing them into one
 * generic failure is what makes a settings page feel haunted.
 */
export const settingsErrors = defineErrorCatalog('settings', {
  WRITE_INVALID: {
    status: 400,
    message: ({ key, reason }: { key: string; reason: string }) => `Cannot set ${key}: ${reason}`,
    why: 'The value did not match the setting’s schema, so storing it would have persisted a document the server cannot read back.',
    fix: 'Send a value matching the setting’s declared type. Retrying the same value cannot succeed.',
  },
  UNKNOWN_KEY: {
    status: 400,
    message: ({ key }: { key: string }) => `Unknown setting: ${key}`,
    why: 'The write named a setting this build does not register. Reads keep unknown keys so another build’s settings survive, but a write has to name something real.',
    fix: 'Check the key against the settings registry. A web build newer than the server offers settings the server cannot store — compare GET /platform/release. A renamed setting keeps its old value in the file until it is removed explicitly.',
  },
  SCOPE_NOT_ALLOWED: {
    status: 400,
    message: ({ key, scope, target }: { key: string; scope: string; target: string }) =>
      `${key} is ${scope}-scoped and cannot be written to ${target} settings`,
    why: 'Workspace settings ship inside a cloned repository, so settings that reach process spawn, exec, env, or the keymap are readable only from the user’s own file.',
    fix: 'Write this setting to user settings instead.',
  },
  FILE_MALFORMED: {
    status: 409,
    message: ({ detail }: { detail: string }) => `Settings file has syntax errors (${detail})`,
    why: 'Editing a document the parser could not fully read would compute the edit against a broken tree and corrupt the parts it did understand.',
    fix: 'Fix the JSON syntax in the named file, or delete the file to start from defaults.',
  },
  SECRETS_UNREADABLE: {
    status: 500,
    message: ({ file, detail }: { file: string; detail: string }) =>
      `Secret store cannot be read: ${file} (${detail})`,
    why: 'Starting with an unreadable secret store would hand every provider spawn an empty credential, which fails later and far from this cause. A reload degrades instead; construction has nothing to keep serving.',
    fix: 'Repair or delete the named file. A secret store that does not exist is the normal empty case and starts fine.',
  },
  RAW_REVISION_STALE: {
    status: 409,
    message: ({ target }: { target: string }) =>
      `The ${target} settings document changed while this edit was open`,
    why: 'Raw JSON replaces a whole document, so saving bytes based on an older revision could discard another edit.',
    fix: 'Reload, compare, or explicitly overwrite against the newly confirmed revision.',
  },
  WRITE_CONTENDED: {
    status: 503,
    message: () => 'Settings kept changing before the update could be committed',
    why: 'Another process repeatedly replaced the settings document while this update was being staged.',
    fix: 'Stop the competing writer, then retry the same settings action.',
  },
  ID_COLLISION: {
    status: 409,
    message: () => 'A settings write id was reused for different content',
    why: 'Write ids make uncertain retries idempotent. Reusing one for another request would make acknowledgement ambiguous.',
    fix: 'Retry the original request unchanged, or create a new id for a different request.',
  },
  TRANSACTION_RECOVERY_INVALID: {
    status: 500,
    message: ({ detail }: { detail: string }) => `Settings transaction recovery failed: ${detail}`,
    why: 'A staged settings-and-secrets transaction is incomplete or does not match its journal hashes.',
    fix: 'Preserve the journal and staged files, then repair the named transaction artifacts before restarting.',
  },
  TRANSACTION_RECOVERY_CONFLICT: {
    status: 500,
    message: () => 'Settings transaction recovery found an unrelated external change',
    why: 'At least one destination matches neither the old nor new hash recorded by the interrupted transaction, so recovery cannot overwrite it safely.',
    fix: 'Reconcile the settings, secrets, and transaction journal manually, then restart.',
  },
  TRANSACTION_RECOVERY_REQUIRED: {
    status: 503,
    message: () => 'Settings are unavailable until an interrupted transaction is recovered',
    why: 'A durable settings-and-secrets journal remains after an uncertain write, so another live mutation could make safe recovery impossible.',
    fix: 'Restart Platform to recover the journal before reading or changing settings again.',
  },
  POLICY_CONTROLLED: {
    status: 403,
    message: ({ key }: { key: string }) => `${key} is managed by policy and cannot be changed`,
    why: 'A policy layer owns this setting. Accepting the write and then resolving back to the policy value would look like a silent failure.',
    fix: 'Change the policy configuration, or remove the key from it.',
  },
  FILE_PATH_UNSET: {
    status: 500,
    message: () => 'Settings file path was not configured',
    why: 'The settings store was constructed without a file path. Defaulting to the user’s home directory here would let a test run overwrite real settings.',
    fix: 'Pass `settings.userFilePath` to createApp, or set PLATFORM_HOME.',
  },
})

export function rawRevisionStaleError(metadata: {
  readonly coordinatorWaitMs: number
  readonly foundRevision: string
  readonly target: 'user' | 'workspace'
}) {
  return Object.assign(settingsErrors.RAW_REVISION_STALE({ target: metadata.target }), metadata)
}

export function settingsWriteContendedError(attempts: number, coordinatorWaitMs: number) {
  return Object.assign(settingsErrors.WRITE_CONTENDED({}), { attempts, coordinatorWaitMs })
}
