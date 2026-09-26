import { mkdir, mkdtemp, rename, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { REDACTED_SETTINGS_VALUE } from '@workspace/contracts'
import type { WideEvent } from 'evlog'
import { readFsLogs } from 'evlog/fs'
import { afterEach, describe, expect, it } from 'vitest'
import {
  flushObservability,
  initializeObservability,
  resetObservabilityForTests,
} from '../../observability/runtime'
import { SettingsStore } from '../store'

const API_KEY = 'OPENAI_API_KEY'
const PROXY = 'HTTP_PROXY'
const SECRET = 'sk-live-abc123'

const stores: SettingsStore[] = []
const roots: string[] = []
let writeSequence = 0

async function tempRoot() {
  const root = await mkdtemp(path.join(tmpdir(), 'settings-stale-'))
  roots.push(root)

  return root
}

function createStore(root: string) {
  const store = new SettingsStore({ userFilePath: path.join(root, 'settings.json'), watch: false })
  stores.push(store)

  return store
}

/** One instance with a variable that has a secret and one that does not. */
function writeProviderWithSecret(store: SettingsStore) {
  writeSequence += 1
  const text = `${JSON.stringify({
    'providers.instances': [
      {
        providerInstanceId: 'codex-work',
        driverKind: 'codex',
        environment: [
          { name: API_KEY, value: SECRET },
          { name: PROXY, value: '' },
        ],
      },
    ],
  })}\n`
  return store.writeRaw({
    baseRevision: store.rawLayer('user').revision,
    target: 'user',
    text,
    writeId: `secret-ref-${writeSequence}`,
  })
}

function environmentOf(store: SettingsStore) {
  const [instance] = store.snapshot().values['providers.instances']
  const entries = instance.environment.map((variable) => [variable.name, variable.value] as const)

  return Object.fromEntries(entries)
}

/** Makes the secret store unreadable without losing what it holds. */
async function breakSecretStore(root: string) {
  const secretsPath = path.join(root, 'secrets.json')
  await rename(secretsPath, path.join(root, 'secrets.saved'))
  // A directory where the file should be: `readFileSync` throws EISDIR, which is
  // not ENOENT, so it is a genuine read failure rather than the empty case.
  await mkdir(secretsPath)
}

async function repairSecretStore(root: string) {
  const secretsPath = path.join(root, 'secrets.json')
  await rm(secretsPath, { recursive: true })
  await rename(path.join(root, 'secrets.saved'), secretsPath)
}

/** A settings write that touches no secret, purely to drive `invalidate()`. */
function touchSettings(store: SettingsStore, binding: string) {
  writeSequence += 1
  return store.write({
    mutationId: `touch-${writeSequence}`,
    operations: [{ command: 'a.one', keys: [binding], kind: 'keybinding.set' }],
    target: 'user',
  })
}

afterEach(async () => {
  for (const store of stores.splice(0)) store.close()
  await resetObservabilityForTests()
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('masking a provider environment', () => {
  it('marks a set variable and leaves an unset one empty', async () => {
    const root = await tempRoot()
    const store = createStore(root)

    await writeProviderWithSecret(store)

    // The normal path, pinned: without this a branch that masked *everything*
    // forever would satisfy every other test in this file.
    expect(environmentOf(store)).toEqual({ [API_KEY]: REDACTED_SETTINGS_VALUE, [PROXY]: '' })
  })

  it('masks everything while the secret store cannot be read', async () => {
    const root = await tempRoot()
    const store = createStore(root)
    await writeProviderWithSecret(store)

    await breakSecretStore(root)
    await touchSettings(store, 'Mod+1')

    // An unreadable ref set cannot distinguish unset values from credentials
    // held in the secret store, so the safe projection masks every variable.
    expect(environmentOf(store)).toEqual({
      [API_KEY]: REDACTED_SETTINGS_VALUE,
      [PROXY]: REDACTED_SETTINGS_VALUE,
    })
    expect(Object.values(environmentOf(store))).not.toContain('')
  })

  it('returns to ordinary masking once the secret store is readable again', async () => {
    const root = await tempRoot()
    const store = createStore(root)
    await writeProviderWithSecret(store)
    await breakSecretStore(root)
    await touchSettings(store, 'Mod+1')

    await repairSecretStore(root)
    await touchSettings(store, 'Mod+2')

    expect(environmentOf(store)).toEqual({ [API_KEY]: REDACTED_SETTINGS_VALUE, [PROXY]: '' })
  })

  it('records one wide event without the file contents or absolute path', async () => {
    const root = await tempRoot()
    const logDir = await tempRoot()
    const store = createStore(root)
    await writeProviderWithSecret(store)
    initializeObservability({
      OBSERVABILITY_CONSOLE: 'false',
      OBSERVABILITY_DIR: logDir,
      OBSERVABILITY_ENABLED: 'true',
      OBSERVABILITY_INFO_SAMPLE_RATE: '100',
      NODE_ENV: 'production',
    })

    await breakSecretStore(root)
    await touchSettings(store, 'Mod+1')

    const events = await flushedEvents(logDir)
    const warning = events.find((event) => event.action === 'settings.secrets.unreadable')
    expect(warning).toMatchObject({
      area: 'settings',
      level: 'warn',
      operation: 'invalidate',
      settings: { secretRefsStale: true },
    })
    expect(JSON.stringify(warning)).not.toContain(SECRET)
    expect(JSON.stringify(warning)).not.toContain(path.join(root, 'secrets.json'))
  })
})

describe('a secret store that cannot be read at construction', () => {
  it('refuses to start, naming the file rather than raising EISDIR', async () => {
    const root = await tempRoot()
    await mkdir(path.join(root, 'secrets.json'))

    // Starting anyway would hand every provider spawn an empty credential — a
    // failure that surfaces far from this cause. A reload has a running app to
    // keep serving and degrades instead; construction has nothing yet.
    expect(() => createStore(root)).toThrowError(
      expect.objectContaining({
        code: 'settings.SECRETS_UNREADABLE',
        message: expect.stringContaining(path.join(root, 'secrets.json')),
      }),
    )
  })
})

async function flushedEvents(logDir: string): Promise<WideEvent[]> {
  await new Promise((resolve) => setTimeout(resolve, 0))
  await flushObservability()
  const events: WideEvent[] = []
  for await (const event of readFsLogs({ dir: logDir })) events.push(event)

  return events
}
