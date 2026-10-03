import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { settingsPaths } from '../paths'
import { SettingsStore } from '../store'
import { testSettingsOptions } from '../testing'
import { settingsTransactionJournalPath } from '../transaction'
import {
  activeSettingsWriteCoordinatorCount,
  withSettingsWriteCoordinator,
} from '../write-coordinator'

const roots: string[] = []
const stores: SettingsStore[] = []

async function tempRoot() {
  const root = await mkdtemp(path.join(tmpdir(), 'settings-prune-lifecycle-'))
  roots.push(root)
  return root
}

afterEach(async () => {
  for (const store of stores.splice(0)) store.close()
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('explicit application settings cleanup', () => {
  it('keeps construction read-only and invalidates a cached snapshot only after explicit cleanup', async () => {
    const root = await tempRoot()
    const options = testSettingsOptions(root)
    const paths = settingsPaths(options)
    const text = '{ "editor.fontSize": 18, "obsolete": true }\n'
    await mkdir(path.dirname(paths.user), { recursive: true })
    await writeFile(paths.user, text)
    const store = new SettingsStore(options)
    stores.push(store)
    const before = store.snapshot()
    expect(await readFile(paths.user, 'utf8')).toBe(text)
    expect(store.rawLayer('user').text).toBe(text)

    store.pruneUnknownUserSettingsSync()
    expect(store.snapshot()).not.toBe(before)
    expect(store.snapshot().values['editor.fontSize']).toBe(18)
    expect(await readFile(paths.user, 'utf8')).toBe('{ "editor.fontSize": 18 }\n')
    expect(store.snapshotForClient().diagnostics).toContainEqual(
      expect.objectContaining({ kind: 'removed-key', id: 'obsolete' }),
    )
    expect(
      store.snapshotForClient().diagnostics.some((diagnostic) => diagnostic.kind === 'removed-key'),
    ).toBe(false)
  })

  it('leaves settings untouched when secret initialization refuses application startup', async () => {
    const root = await tempRoot()
    const options = testSettingsOptions(root)
    const paths = settingsPaths(options)
    const text = '{ "editor.fontSize": 18, "obsolete": true }\n'
    await mkdir(path.dirname(paths.user), { recursive: true })
    await writeFile(paths.user, text)
    await mkdir(paths.secrets)
    expect(() => new SettingsStore(options)).toThrowError(
      expect.objectContaining({ code: 'settings.SECRETS_UNREADABLE' }),
    )
    expect(await readFile(paths.user, 'utf8')).toBe(text)
  })

  it.each([
    'user-stage',
    'user-backup',
    'secrets-stage',
    'secrets-backup',
    'workspace-stage',
    'journal',
    'journal-stage',
  ] as const)(
    'preserves file bytes, recovery artifacts, cache and notice state while %s exists',
    async (kind) => {
      const root = await tempRoot()
      const options = testSettingsOptions(root, { workspaceRoot: path.join(root, 'workspace') })
      const paths = settingsPaths(options)
      const text = '{ "editor.fontSize": 18, "obsolete": true }\n'
      await mkdir(path.dirname(paths.user), { recursive: true })
      await writeFile(paths.user, text)
      const store = new SettingsStore(options)
      stores.push(store)
      const before = store.snapshot()
      const workspaceFile = path.join(root, 'workspace', '.platform', 'settings.json')
      const artifactFiles = {
        'user-stage': path.join(path.dirname(paths.user), '.settings.json.interrupted.stage'),
        'user-backup': path.join(path.dirname(paths.user), '.settings.json.interrupted.backup'),
        'secrets-stage': path.join(path.dirname(paths.secrets), '.secrets.json.interrupted.stage'),
        'secrets-backup': path.join(
          path.dirname(paths.secrets),
          '.secrets.json.interrupted.backup',
        ),
        'workspace-stage': path.join(
          path.dirname(workspaceFile),
          '.settings.json.interrupted.stage',
        ),
        journal: settingsTransactionJournalPath(paths.secrets),
        'journal-stage': `${settingsTransactionJournalPath(paths.secrets)}.interrupted.tmp`,
      }
      const artifact = artifactFiles[kind]
      await mkdir(path.dirname(artifact), { recursive: true })
      await writeFile(artifact, 'recovery artifact')

      store.pruneUnknownUserSettingsSync()
      expect(await readFile(paths.user, 'utf8')).toBe(text)
      expect(await readFile(artifact, 'utf8')).toBe('recovery artifact')
      expect(store.snapshot()).toBe(before)
      expect(
        store
          .snapshotForClient()
          .diagnostics.some((diagnostic) => diagnostic.kind === 'removed-key'),
      ).toBe(false)

      await rm(artifact)
      store.pruneUnknownUserSettingsSync()
      expect(await readFile(paths.user, 'utf8')).toBe('{ "editor.fontSize": 18 }\n')
      expect(store.snapshotForClient().diagnostics).toContainEqual(
        expect.objectContaining({ kind: 'removed-key', id: 'obsolete' }),
      )
    },
  )

  it('shares secret transaction ownership and leaves cached settings intact while that owner is busy', async () => {
    const root = await tempRoot()
    const options = testSettingsOptions(root)
    const paths = settingsPaths(options)
    const text = '{ "editor.fontSize": 18, "obsolete": true }\n'
    await mkdir(path.dirname(paths.user), { recursive: true })
    await writeFile(paths.user, text)
    const store = new SettingsStore(options)
    stores.push(store)
    const before = store.snapshot()
    let ready = () => {}
    const admitted = new Promise<void>((resolve) => {
      ready = resolve
    })
    let release = () => {}
    const held = new Promise<void>((resolve) => {
      release = resolve
    })
    const owner = withSettingsWriteCoordinator(paths.secrets, async () => {
      ready()
      await held
    })
    await admitted
    try {
      expect(() => store.pruneUnknownUserSettingsSync()).not.toThrow()
      expect(await readFile(paths.user, 'utf8')).toBe(text)
      expect(store.snapshot()).toBe(before)
      expect(
        store
          .snapshotForClient()
          .diagnostics.some((diagnostic) => diagnostic.kind === 'removed-key'),
      ).toBe(false)
    } finally {
      release()
      await owner
    }
    expect(activeSettingsWriteCoordinatorCount()).toBe(0)
    store.pruneUnknownUserSettingsSync()
    expect(await readFile(paths.user, 'utf8')).toBe('{ "editor.fontSize": 18 }\n')
  })

  it('reloads external settings without pruning through artifacts, then cleans an eligible later edit', async () => {
    const root = await tempRoot()
    const options = testSettingsOptions(root, { watch: true })
    const paths = settingsPaths(options)
    await mkdir(path.dirname(paths.user), { recursive: true })
    await writeFile(paths.user, '{ "editor.fontSize": 18 }\n')
    const store = new SettingsStore(options)
    stores.push(store)
    store.pruneUnknownUserSettingsSync()
    const artifact = path.join(path.dirname(paths.user), '.settings.json.interrupted.stage')
    await writeFile(artifact, 'recovery artifact')
    const external = '{ "editor.fontSize": 19, "obsolete": true }\n'
    await writeFile(paths.user, external)
    await expect.poll(() => store.snapshot().values['editor.fontSize']).toBe(19)
    expect(await readFile(paths.user, 'utf8')).toBe(external)
    expect(
      store.snapshotForClient().diagnostics.some((diagnostic) => diagnostic.kind === 'removed-key'),
    ).toBe(false)

    await rm(artifact)
    await writeFile(paths.user, '{ "editor.fontSize": 20, "obsolete": true }\n')
    await expect.poll(() => store.rawLayer('user').text.includes('obsolete')).toBe(false)
    expect(store.snapshot().values['editor.fontSize']).toBe(20)
    expect(store.snapshotForClient().diagnostics).toContainEqual(
      expect.objectContaining({ kind: 'removed-key', id: 'obsolete' }),
    )
  })
})
