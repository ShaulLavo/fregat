import { chmod, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { textFileVersion } from '../../fs/version'
import { testSettingsOptions } from '../testing'
import { SettingsStore, type SettingsStoreOptions } from '../store'
import { settingsErrors } from '../structured-errors'
import {
  commitSettingsSecretTransactionOwned,
  settingsTransactionJournalPath,
  withSettingsSecretTransactionOwner,
  type SettingsTransactionBoundary,
} from '../transaction'

const OLD_SECRET = 'sk-old-transaction-secret'
const NEW_SECRET = 'sk-new-transaction-secret'
const RAW_MARKER = 'raw-transaction-marker'
const roots: string[] = []
const stores: SettingsStore[] = []

const preJournalBoundaries: readonly SettingsTransactionBoundary[] = [
  'settings-staged',
  'settings-backed-up',
  'secrets-staged',
  'secrets-backed-up',
]

const recoverableBoundaries: readonly SettingsTransactionBoundary[] = [
  'journal-prepared',
  'settings-renamed',
  'settings-directory-synced',
  'journal-settings-committed',
  'secrets-renamed',
  'secrets-directory-synced',
  'journal-secrets-committed',
  'cleanup-complete',
]

async function tempRoot() {
  const root = await mkdtemp(path.join(tmpdir(), 'settings-transaction-'))
  roots.push(root)

  return root
}

function paths(root: string) {
  const directory = path.join(root, '.platform-test')
  const settings = path.join(directory, 'settings.json')
  const secrets = path.join(directory, 'secrets.json')

  return {
    directory,
    journal: settingsTransactionJournalPath(secrets),
    secrets,
    settings,
  }
}

function providerDocument(secret: string, fontSize: number, marker: string) {
  return `${JSON.stringify(
    {
      'editor.fontSize': fontSize,
      'providers.instances': [
        {
          driverKind: 'codex',
          enabled: true,
          environment: [{ name: 'CODEX_TOKEN', value: secret }],
          providerInstanceId: 'codex-work',
        },
      ],
      'unknown.transactionMarker': marker,
    },
    null,
    2,
  )}\n`
}

async function seedTransactionFiles(root: string) {
  const store = new SettingsStore(testSettingsOptions(root))
  await store.writeRaw({
    baseRevision: '',
    target: 'user',
    text: providerDocument(OLD_SECRET, 18, 'old-marker'),
    writeId: 'seed-transaction',
  })
  store.close()
}

function createStore(root: string, overrides: Partial<SettingsStoreOptions> = {}) {
  const store = new SettingsStore({ ...testSettingsOptions(root), ...overrides })
  stores.push(store)

  return store
}

async function interruptAt(root: string, wanted: SettingsTransactionBoundary) {
  await seedTransactionFiles(root)
  let reached = false
  const store = createStore(root, {
    transactionHooks: {
      afterBoundary(boundary) {
        if (boundary !== wanted) return
        reached = true
        throw injectedFailure(`injected crash after ${boundary}`)
      },
    },
  })
  const baseRevision = store.rawLayer('user').revision

  await expect(
    store.writeRaw({
      baseRevision,
      target: 'user',
      text: providerDocument(NEW_SECRET, 29, RAW_MARKER),
      writeId: `../../boundary-${wanted}`,
    }),
  ).rejects.toThrow(`injected crash after ${wanted}`)
  expect(reached).toBe(true)
  store.close()

  return paths(root)
}

async function artifactNames(directory: string) {
  return (await readdir(directory)).filter(
    (name) => /\.(?:backup|stage|tmp)$/u.test(name) || name.includes('settings-transaction'),
  )
}

function providerSecret(store: SettingsStore) {
  return store
    .providerInstancesForSpawnSync()
    .find((instance) => instance.providerInstanceId === 'codex-work')
    ?.environment?.find((variable) => variable.name === 'CODEX_TOKEN')?.value
}

afterEach(async () => {
  for (const store of stores.splice(0)) store.close()
  await Promise.all(roots.splice(0).map((root) => rm(root, { force: true, recursive: true })))
})

describe('settings and secrets transaction boundaries', () => {
  it.each(preJournalBoundaries)('cleans a failure after %s before journaling', async (boundary) => {
    const root = await tempRoot()
    const transactionPaths = await interruptAt(root, boundary)

    expect(await artifactNames(transactionPaths.directory)).toEqual([])
    const recovered = createStore(root)
    expect(recovered.snapshot().values['editor.fontSize']).toBe(18)
    expect(providerSecret(recovered)).toBe(OLD_SECRET)
  })

  it.each(recoverableBoundaries)(
    'recovers a failure after %s to one complete pair',
    async (boundary) => {
      const root = await tempRoot()
      const transactionPaths = await interruptAt(root, boundary)
      if (boundary !== 'cleanup-complete') {
        const journal = await readFile(transactionPaths.journal, 'utf8')
        const parsedJournal = JSON.parse(journal) as { journalStage: string }
        expect(journal).not.toContain(NEW_SECRET)
        expect(journal).not.toContain(RAW_MARKER)
        expect((await stat(transactionPaths.journal)).mode & 0o777).toBe(0o600)
        await expect(stat(parsedJournal.journalStage)).rejects.toMatchObject({ code: 'ENOENT' })
      }

      const recovered = createStore(root)
      expect(recovered.snapshot().values['editor.fontSize']).toBe(29)
      expect(providerSecret(recovered)).toBe(NEW_SECRET)
      expect(await artifactNames(transactionPaths.directory)).toEqual([])
    },
  )

  it('keeps secret stages, backups, and the journal at 0600', async () => {
    const root = await tempRoot()
    const transactionPaths = await interruptAt(root, 'journal-prepared')
    const names = await readdir(transactionPaths.directory)
    const secretArtifacts = names.filter(
      (name) => name.startsWith('.secrets.json.') || name.includes('settings-transaction'),
    )

    expect(secretArtifacts.length).toBeGreaterThanOrEqual(3)
    for (const name of secretArtifacts) {
      expect((await stat(path.join(transactionPaths.directory, name))).mode & 0o777).toBe(0o600)
    }
  })

  it('preserves the existing settings mode through recovery', async () => {
    const root = await tempRoot()
    await seedTransactionFiles(root)
    await chmod(paths(root).settings, 0o640)
    let interrupted = false
    const store = createStore(root, {
      transactionHooks: {
        afterBoundary(boundary) {
          if (boundary !== 'journal-prepared') return
          interrupted = true
          throw injectedFailure('mode crash')
        },
      },
    })

    await expect(
      store.writeRaw({
        baseRevision: store.rawLayer('user').revision,
        target: 'user',
        text: providerDocument(NEW_SECRET, 30, RAW_MARKER),
        writeId: 'mode-write',
      }),
    ).rejects.toThrow('mode crash')
    expect(interrupted).toBe(true)
    store.close()

    createStore(root)
    expect((await stat(paths(root).settings)).mode & 0o777).toBe(0o640)
  })

  it('blocks later live writes once a durable journal needs recovery', async () => {
    const root = await tempRoot()
    await seedTransactionFiles(root)
    const store = createStore(root, {
      transactionHooks: {
        afterBoundary(boundary) {
          if (boundary !== 'settings-directory-synced') return
          throw injectedFailure('live store interrupted after settings fsync')
        },
      },
    })

    const managementRef = 'usage.cliproxy.management' as const
    await store.ensureSecret(managementRef, () => 'synthetic-management-key')
    expect(store.hasServerSecret(managementRef)).toBe(true)
    await expect(
      store.writeRaw({
        baseRevision: store.rawLayer('user').revision,
        target: 'user',
        text: providerDocument(NEW_SECRET, 30, RAW_MARKER),
        writeId: 'poison-live-store',
      }),
    ).rejects.toThrow('live store interrupted after settings fsync')
    await expect(
      store.write({
        mutationId: 'must-not-cross-pending-journal',
        operations: [{ key: 'editor.lineHeight', kind: 'set', value: 44 }],
        target: 'user',
      }),
    ).rejects.toMatchObject({ code: 'settings.TRANSACTION_RECOVERY_REQUIRED' })
    expect(store.hasServerSecret(managementRef)).toBe(true)
    store.close()
    expect(store.hasServerSecret(managementRef)).toBe(true)

    const recovered = createStore(root)
    expect(recovered.hasServerSecret(managementRef)).toBe(true)
    expect(recovered.snapshot().values['editor.fontSize']).toBe(30)
    expect(recovered.snapshot().values['editor.lineHeight']).not.toBe(44)
    expect(providerSecret(recovered)).toBe(NEW_SECRET)
  })
})

describe('transaction recovery refusal', () => {
  it('never overwrites an unrelated destination and restores only the committed side', async () => {
    const root = await tempRoot()
    const transactionPaths = await interruptAt(root, 'settings-renamed')
    const unrelatedSecrets = '{ "unrelated": "external-secret-state" }\n'
    await writeFile(transactionPaths.secrets, unrelatedSecrets, { mode: 0o600 })

    expect(() => createStore(root)).toThrowError(
      expect.objectContaining({ code: 'settings.TRANSACTION_RECOVERY_CONFLICT' }),
    )
    expect(await readFile(transactionPaths.settings, 'utf8')).toContain('old-marker')
    expect(await readFile(transactionPaths.secrets, 'utf8')).toBe(unrelatedSecrets)
  })

  it('refuses a missing stage required to roll an old destination forward', async () => {
    const root = await tempRoot()
    const transactionPaths = await interruptAt(root, 'journal-prepared')
    const names = await readdir(transactionPaths.directory)
    const settingsStage = names.find(
      (name) => name.startsWith('.settings.json.') && name.endsWith('.stage'),
    )
    expect(settingsStage).toBeDefined()
    await rm(path.join(transactionPaths.directory, settingsStage!))

    expect(() => createStore(root)).toThrowError(
      expect.objectContaining({ code: 'settings.TRANSACTION_RECOVERY_INVALID' }),
    )
  })

  it('requires every old backup even after both destinations were renamed', async () => {
    const root = await tempRoot()
    const transactionPaths = await interruptAt(root, 'secrets-renamed')
    const names = await readdir(transactionPaths.directory)
    const secretsBackup = names.find(
      (name) => name.startsWith('.secrets.json.') && name.endsWith('.backup'),
    )
    expect(secretsBackup).toBeDefined()
    await rm(path.join(transactionPaths.directory, secretsBackup!))

    expect(() => createStore(root)).toThrowError(
      expect.objectContaining({ code: 'settings.TRANSACTION_RECOVERY_INVALID' }),
    )
  })
})

describe('shared secret transaction ownership', () => {
  it('recovers a workspace journal before a same-process user transaction', async () => {
    const root = await tempRoot()
    const transactionPaths = paths(root)
    const workspaceSettings = path.join(root, 'workspace', '.platform', 'settings.json')
    await mkdir(transactionPaths.directory, { recursive: true })
    await mkdir(path.dirname(workspaceSettings), { recursive: true })
    await writeFile(transactionPaths.settings, '{}\n', 'utf8')
    await writeFile(transactionPaths.secrets, '{}\n', { mode: 0o600 })
    await writeFile(workspaceSettings, '{}\n', 'utf8')
    const allowedSettingsPaths = [transactionPaths.settings, workspaceSettings]
    const workspaceText = '{ "editor.fontSize": 27 }\n'
    const workspaceSecrets = '{ "provider.workspace.env.TOKEN": "workspace" }\n'

    await expect(
      withSettingsSecretTransactionOwner(transactionPaths.secrets, () =>
        commitSettingsSecretTransactionOwned(
          {
            allowedSettingsPaths,
            expectedSecretsRevision: textFileVersion('{}\n'),
            expectedSettingsRevision: textFileVersion('{}\n'),
            id: 'workspace-interrupted',
            secretsPath: transactionPaths.secrets,
            secretsText: workspaceSecrets,
            settingsPath: workspaceSettings,
            settingsText: workspaceText,
          },
          {
            afterBoundary(boundary) {
              if (boundary === 'journal-prepared') {
                throw injectedFailure('workspace transaction interrupted')
              }
            },
          },
        ),
      ),
    ).rejects.toThrow('workspace transaction interrupted')

    const userText = '{ "editor.lineHeight": 34 }\n'
    const userSecrets =
      '{ "provider.user.env.TOKEN": "user", "provider.workspace.env.TOKEN": "workspace" }\n'
    const result = await withSettingsSecretTransactionOwner(transactionPaths.secrets, () =>
      commitSettingsSecretTransactionOwned({
        allowedSettingsPaths,
        expectedSecretsRevision: textFileVersion(workspaceSecrets),
        expectedSettingsRevision: textFileVersion('{}\n'),
        id: 'user-after-workspace',
        secretsPath: transactionPaths.secrets,
        secretsText: userSecrets,
        settingsPath: transactionPaths.settings,
        settingsText: userText,
      }),
    )

    expect(result.kind).toBe('committed')
    expect(await readFile(workspaceSettings, 'utf8')).toBe(workspaceText)
    expect(await readFile(transactionPaths.settings, 'utf8')).toBe(userText)
    expect(await readFile(transactionPaths.secrets, 'utf8')).toBe(userSecrets)
    expect(await artifactNames(transactionPaths.directory)).toEqual([])
  })
})

describe('transaction source revisions', () => {
  it('cleans staged artifacts when settings move before journal creation', async () => {
    const root = await tempRoot()
    await seedTransactionFiles(root)
    const transactionPaths = paths(root)
    const externalText = '{ "editor.fontSize": 44, "external": true }\n'
    const store = createStore(root, {
      transactionHooks: {
        async afterBoundary(boundary) {
          if (boundary !== 'settings-backed-up') return
          await writeFile(transactionPaths.settings, externalText, 'utf8')
        },
      },
    })

    await expect(
      store.writeRaw({
        baseRevision: store.rawLayer('user').revision,
        target: 'user',
        text: providerDocument(NEW_SECRET, 31, RAW_MARKER),
        writeId: 'settings-source-race',
      }),
    ).rejects.toMatchObject({ code: 'settings.RAW_REVISION_STALE' })

    expect(await readFile(transactionPaths.settings, 'utf8')).toBe(externalText)
    expect(await artifactNames(transactionPaths.directory)).toEqual([])
  })

  it('binds complete secret text to the revision used to prepare it', async () => {
    const root = await tempRoot()
    await seedTransactionFiles(root)
    const transactionPaths = paths(root)
    const externalSecrets = '{ "external.ref": "external-secret-state" }\n'
    const store = createStore(root, {
      transactionHooks: {
        async afterBoundary(boundary) {
          if (boundary !== 'settings-backed-up') return
          await writeFile(transactionPaths.secrets, externalSecrets, { mode: 0o600 })
        },
      },
    })

    await expect(
      store.writeRaw({
        baseRevision: store.rawLayer('user').revision,
        target: 'user',
        text: providerDocument(NEW_SECRET, 32, RAW_MARKER),
        writeId: 'secrets-source-race',
      }),
    ).rejects.toMatchObject({ code: 'settings.WRITE_CONTENDED' })

    expect(await readFile(transactionPaths.secrets, 'utf8')).toBe(externalSecrets)
    expect(await artifactNames(transactionPaths.directory)).toEqual([])
  })

  it('refuses recovery if an external settings edit lands after journaling', async () => {
    const root = await tempRoot()
    await seedTransactionFiles(root)
    const transactionPaths = paths(root)
    const externalText = '{ "editor.fontSize": 47, "external": true }\n'
    const store = createStore(root, {
      transactionHooks: {
        async afterBoundary(boundary) {
          if (boundary !== 'journal-prepared') return
          await writeFile(transactionPaths.settings, externalText, 'utf8')
          throw injectedFailure('crash after external edit')
        },
      },
    })

    await expect(
      store.writeRaw({
        baseRevision: store.rawLayer('user').revision,
        target: 'user',
        text: providerDocument(NEW_SECRET, 33, RAW_MARKER),
        writeId: 'post-journal-race',
      }),
    ).rejects.toThrow('crash after external edit')
    store.close()

    expect(() => createStore(root)).toThrowError(
      expect.objectContaining({ code: 'settings.TRANSACTION_RECOVERY_CONFLICT' }),
    )
    expect(await readFile(transactionPaths.settings, 'utf8')).toBe(externalText)
  })

  it('rejects malformed raw input before creating transaction artifacts', async () => {
    const root = await tempRoot()
    await seedTransactionFiles(root)
    const transactionPaths = paths(root)
    const beforeSettings = await readFile(transactionPaths.settings, 'utf8')
    const beforeSecrets = await readFile(transactionPaths.secrets, 'utf8')
    const store = createStore(root)

    await expect(
      store.writeRaw({
        baseRevision: store.rawLayer('user').revision,
        target: 'user',
        text: `{ "providers.instances": [${NEW_SECRET}`,
        writeId: 'malformed-before-transaction',
      }),
    ).rejects.toMatchObject({ code: 'settings.FILE_MALFORMED' })

    expect(await readFile(transactionPaths.settings, 'utf8')).toBe(beforeSettings)
    expect(await readFile(transactionPaths.secrets, 'utf8')).toBe(beforeSecrets)
    expect(await artifactNames(transactionPaths.directory)).toEqual([])
  })
})

function injectedFailure(detail: string) {
  return settingsErrors.TRANSACTION_RECOVERY_INVALID({ detail })
}
