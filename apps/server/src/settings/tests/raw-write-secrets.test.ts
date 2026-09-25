import { existsSync } from 'node:fs'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { SettingsEvent } from '@workspace/contracts'
import { afterEach, describe, expect, it } from 'vitest'
import { SettingsStore } from '../store'

const stores: SettingsStore[] = []
const roots: string[] = []
let writeSequence = 0

/** A sentinel, not a credential: what matters is only that it is non-empty. */
const TYPED_BY_HAND = 'value-typed-into-the-raw-editor'

async function createSettings(options: { workspace?: boolean } = {}) {
  const root = await mkdtemp(path.join(tmpdir(), 'settings-raw-'))
  roots.push(root)
  const store = new SettingsStore({
    userFilePath: path.join(root, 'settings.json'),
    watch: false,
    workspaceRoot: options.workspace ? path.join(root, 'repo') : null,
  })
  stores.push(store)

  return { root, store }
}

function instances(value: string) {
  return [
    {
      driverKind: 'codex',
      environment: [{ name: 'CODEX_TOKEN', value }],
      providerInstanceId: 'codex-work',
    },
  ]
}

function documentWith(value: string) {
  return `${JSON.stringify({ 'providers.instances': instances(value) }, null, 2)}\n`
}

function writeRaw(store: SettingsStore, text: string, target: 'user' | 'workspace' = 'user') {
  writeSequence += 1
  return store.writeRaw({
    baseRevision: store.rawLayer(target).revision,
    target,
    text,
    writeId: `raw-secret-${writeSequence}`,
  })
}

/** The one variable `instances` sets, out of whatever list it is handed. */
function environmentValue(list: unknown): unknown {
  const first = Array.isArray(list) ? list[0] : undefined

  return first?.environment?.[0]?.value
}

afterEach(async () => {
  for (const store of stores.splice(0)) store.close()
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('raw settings writes', () => {
  it('keeps a value typed into the raw document out of the file', async () => {
    const { root, store } = await createSettings()

    await writeRaw(store, documentWith(TYPED_BY_HAND))

    // The file `GET /settings/raw`, the JSON tab and export all serve.
    expect(await readFile(path.join(root, 'settings.json'), 'utf8')).not.toContain(TYPED_BY_HAND)
    expect(store.rawLayer('user').text).not.toContain(TYPED_BY_HAND)
    // Not merely dropped, either: the provider actually starts with it. Storing
    // it in the document instead left it blanked at spawn and unexplained.
    expect(environmentValue(await store.providerInstancesForSpawn())).toBe(TYPED_BY_HAND)
  })

  it('keeps a stored secret when the raw document round-trips unchanged', async () => {
    const { store } = await createSettings()
    await writeRaw(store, documentWith(TYPED_BY_HAND))

    // Exactly what the hatch does: read the file, change nothing about the
    // provider rows, save it back. The document holds '' for every variable,
    // which says nothing about whether one is set — reading that as "cleared"
    // would delete every credential on the first save after every read.
    const before = store.rawLayer('user').text
    await writeRaw(store, before)

    expect(environmentValue(await store.providerInstancesForSpawn())).toBe(TYPED_BY_HAND)
    // Byte-for-byte: with nothing to absorb the hatch must not reformat the
    // document it was handed.
    expect(store.rawLayer('user').text).toBe(before)
  })

  it('marks providers changed when only the separately stored secret changes', async () => {
    const { store } = await createSettings()
    const events: SettingsEvent[] = []
    store.onChange((event) => events.push(event))
    await writeRaw(store, documentWith(TYPED_BY_HAND))

    const result = await writeRaw(store, documentWith('replacement-credential'))

    expect(result.changedSettingIds).toEqual(['providers.instances'])
    expect(events.at(-1)?.changedSettingIds).toEqual(['providers.instances'])
    expect(environmentValue(await store.providerInstancesForSpawn())).toBe('replacement-credential')
  })

  it('still saves a workspace raw document that carries no value', async () => {
    const { store } = await createSettings({ workspace: true })

    // The scope guard must fire on a *value*, not on the key. Refusing the key
    // outright would break "set here, not applied", which the page is built to
    // show, and would make the workspace hatch unusable.
    await writeRaw(store, documentWith(''), 'workspace')

    expect(store.rawLayer('workspace').text).toContain('providers.instances')
    expect(store.snapshot().diagnostics.map((entry) => entry.kind)).toContain('scope-not-allowed')
  })

  it('refuses a value in a workspace raw document rather than committing it', async () => {
    const { root, store } = await createSettings({ workspace: true })

    // `providers.instances` is application-scoped because it reaches spawn, and
    // a workspace file ships inside a cloned repository.
    await expect(writeRaw(store, documentWith(TYPED_BY_HAND), 'workspace')).rejects.toThrow(
      /application-scoped/,
    )
    expect(store.rawLayer('workspace').text).toBe('')
    expect(existsSync(path.join(root, 'secrets.json'))).toBe(false)
  })

  it('stores nothing when the incoming document is malformed', async () => {
    const { root, store } = await createSettings()

    // Refused by `writeText`. Absorbing the secret first would leave a value
    // with nothing on disk referencing it.
    await expect(
      writeRaw(
        store,
        `{ "providers.instances": [{ "environment": [{ "name": "CODEX_TOKEN", "value": "${TYPED_BY_HAND}" }] }`,
      ),
    ).rejects.toThrow(/syntax errors/)
    expect(existsSync(path.join(root, 'secrets.json'))).toBe(false)
    expect(existsSync(path.join(root, 'settings.json'))).toBe(false)
  })

  it('keeps a key this build does not register', async () => {
    const { store } = await createSettings()

    // The hatch's job. An unknown-key refusal here would delete another build's
    // settings on the first save, so the guard is deliberately not ported.
    await writeRaw(store, '{ "editor.fromANewerBuild": true }\n')

    expect(store.rawLayer('user').text).toContain('editor.fromANewerBuild')
    expect(store.snapshot().diagnostics.map((entry) => entry.id)).toContain(
      'editor.fromANewerBuild',
    )
  })

  it('preserves comments and unrelated keys while it strips the value', async () => {
    const { store } = await createSettings()
    const text = `{
  // kept across the strip
  "workbench.colorTheme": "light",
  "providers.instances": ${JSON.stringify(instances(TYPED_BY_HAND), null, 2)}
}
`

    await writeRaw(store, text)

    const saved = store.rawLayer('user').text
    expect(saved).toContain('// kept across the strip')
    expect(saved).toContain('"workbench.colorTheme": "light"')
    expect(saved).not.toContain(TYPED_BY_HAND)
  })
})
