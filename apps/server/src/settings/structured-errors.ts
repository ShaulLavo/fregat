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
    why: 'The value does not fit this setting, and saving it would leave a settings file the server cannot read.',
    fix: 'Enter a value of the kind this setting expects.',
  },
  UNKNOWN_KEY: {
    status: 400,
    message: ({ key }: { key: string }) => `Unknown setting: ${key}`,
    why: 'This server does not know that setting. The page may be newer than the server, or the setting was renamed.',
    fix: 'Reload the page. If the setting is still unknown, update the server. A renamed setting keeps its old value in the file until you remove it.',
  },
  SCOPE_NOT_ALLOWED: {
    status: 400,
    message: ({ key, scope, target }: { key: string; scope: string; target: string }) =>
      `${key} is ${scope}-scoped and cannot be written to ${target} settings`,
    why: 'Workspace settings travel with a cloned repository, so settings that run programs or change shortcuts are read only from your own settings file.',
    fix: 'Save this setting in your user settings.',
  },
  FILE_MALFORMED: {
    status: 409,
    message: ({ detail }: { detail: string }) => `Settings file has syntax errors (${detail})`,
    why: 'Changing a file the app cannot fully read could damage the parts it did read.',
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
      `The ${target} settings file changed while you were editing it`,
    why: 'Saving replaces the whole file, so saving over the newer version would erase the other change.',
    fix: 'Choose Use the latest version to drop your edits, Keep my changes to save over it, or Compare to see both.',
  },
  KEYBINDINGS_STALE: {
    status: 409,
    message: () => 'Authored bindings changed before this entry was deleted',
    why: 'Another change moved or replaced entries in the binding list.',
    fix: 'Review the refreshed bindings and delete the entry again.',
  },
  WRITE_CONTENDED: {
    status: 503,
    message: () => 'Settings kept changing while this change was being saved',
    why: 'Another program kept rewriting the settings file during the save.',
    fix: 'Close the other program that edits settings, then try again.',
  },
  SERVER_SECRET_CONTENDED: {
    status: 503,
    message: 'The secrets file changed while this server was creating a key',
    why: 'Another process wrote the secrets file while this server created its push signing key.',
    fix: 'Try again. If it repeats, stop the other process that edits the secrets file.',
  },
  ID_COLLISION: {
    status: 409,
    message: () => 'A settings write id was reused for different content',
    why: 'The app reused a save ID for a different change, so the server cannot tell which change it means.',
    fix: 'Reload the app and try again.',
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
    message: () => 'Settings are unavailable until an interrupted save is finished',
    why: 'A settings save was cut off partway, and changing settings now could make it impossible to finish safely.',
    fix: 'Restart Platform so it can finish the interrupted save.',
  },
  POLICY_CONTROLLED: {
    status: 403,
    message: ({ key }: { key: string }) => `${key} is managed by policy and cannot be changed`,
    why: 'A policy sets this value, so a change here would not take effect.',
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
