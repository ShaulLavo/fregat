import { mkdir, mkdtemp, readFile, rename, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { SettingsSnapshot } from '@workspace/contracts'
import type { WideEvent } from 'evlog'
import { readFsLogs } from 'evlog/fs'
import { afterEach, describe, expect, it } from 'vitest'
import {
  flushObservability,
  initializeObservability,
  resetObservabilityForTests,
} from '../../observability/runtime'
import { SettingsFileLayer, type SettingsLayerReader } from '../layer'
import { SettingsStore } from '../store'
import { settingsErrors } from '../structured-errors'

const stores: SettingsStore[] = []
const layers: SettingsFileLayer[] = []
const roots: string[] = []
let mutationSequence = 0

type Deferred = {
  readonly promise: Promise<void>
  readonly resolve: () => void
}

function deferred(): Deferred {
  let resolve = () => {}
  const promise = new Promise<void>((done) => {
    resolve = done
  })

  return { promise, resolve }
}

function setKeybinding(store: SettingsStore, command: string, keys: string | null) {
  mutationSequence += 1
  return store.write({
    mutationId: `store-watch-${mutationSequence}`,
    operations: [{ command, keys: keys === null ? null : [keys], kind: 'keybinding.set' }],
    target: 'user',
  })
}

function setModelOrderEmpty(store: SettingsStore) {
  mutationSequence += 1
  return store.write({
    mutationId: `store-watch-${mutationSequence}`,
    operations: [{ kind: 'model.setOrder', order: [] }],
    target: 'user',
  })
}

async function tempRoot() {
  const root = await mkdtemp(path.join(tmpdir(), 'settings-watch-'))
  roots.push(root)

  return root
}

function createStore(
  root: string,
  options: {
    layerReader?: SettingsLayerReader
    watch?: boolean
    policy?: Record<string, unknown>
  } = {},
) {
  const store = new SettingsStore({
    layerReader: options.layerReader,
    policy: options.policy,
    userFilePath: path.join(root, 'settings.json'),
    watch: options.watch ?? true,
  })
  stores.push(store)

  return store
}

/**
 * Resolves on the store's next change event, or rejects if it never comes.
 *
 * The ceiling is not a latency budget — it is the point past which a watch event
 * is not late but lost, which is a bug in the layer rather than a slow machine.
 * A tight one made this suite flaky on CI for a different case each run, and
 * raising it only converted lost events into slower failures; the layer's
 * arming catch-up is what actually fixed them. Kept well under the project's
 * 30s `testTimeout` so the failure still names what did not happen.
 */
function nextChange(store: SettingsStore, timeoutMs = 10_000): Promise<SettingsSnapshot> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      stop()
      reject(new Error('settings store never reported a change'))
    }, timeoutMs)
    const stop = store.onChange((event) => {
      clearTimeout(timer)
      stop()
      resolve(event.snapshot)
    })
  })
}

afterEach(async () => {
  for (const store of stores.splice(0)) store.close()
  for (const layer of layers.splice(0)) layer.close()
  await resetObservabilityForTests()
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

/**
 * A hand-edit is not atomic. Between the first keystroke and a valid document the
 * file spends most of its time unparseable, and every key absent from a parse
 * resolves to its registry default rather than to its previous value — so without
 * retention the app does not degrade while you type, it resets: theme, fonts,
 * wallpaper and the whole keymap, on every intermediate save.
 */
describe('a broken file does not change what is in force', () => {
  it('holds the last good values while the document is unparseable', async () => {
    const root = await tempRoot()
    const file = path.join(root, 'settings.json')
    await writeFile(
      file,
      '{\n  "workbench.colorTheme": "dark",\n  "editor.fontSize": 18\n}\n',
      'utf8',
    )

    const store = createStore(root)
    expect(store.snapshot().values['workbench.colorTheme']).toBe('dark')

    // One unterminated quote in a key name, which recovers zero keys.
    const broken = nextChange(store)
    await writeFile(
      file,
      '{\n  "workbench.colorThem: "dark",\n  "editor.fontSize": 18\n}\n',
      'utf8',
    )
    const snapshot = await broken

    expect(snapshot.values['workbench.colorTheme']).toBe('dark')
    expect(snapshot.values['editor.fontSize']).toBe(18)
  })

  // The bytes are always news even when their meaning is not: this is what lets
  // the page say the document is broken, and the JSON view show what to fix.
  it('still reports the broken bytes and where they broke', async () => {
    const root = await tempRoot()
    const file = path.join(root, 'settings.json')
    await writeFile(file, '{ "editor.fontSize": 18 }\n', 'utf8')

    const store = createStore(root)
    const broken = nextChange(store)
    // The partial parse recovers `99` here, so this fails if `raw` follows the
    // recovery rather than the last document that parsed cleanly.
    await writeFile(file, '{ "editor.fontSize": 99, "oops" }\n', 'utf8')
    const snapshot = await broken

    const layer = snapshot.layers.find((entry) => entry.id === 'user')
    expect(layer?.file?.text).toBe('{ "editor.fontSize": 99, "oops" }\n')
    expect(layer?.file?.parseErrors.length).toBeGreaterThan(0)
    // Disagreeing with `text` is the point: `raw` is the last parse that worked.
    expect(layer?.raw).toEqual({ 'editor.fontSize': 18 })
    expect(snapshot.values['editor.fontSize']).toBe(18)
  })

  it('takes the repaired document as soon as it parses again', async () => {
    const root = await tempRoot()
    const file = path.join(root, 'settings.json')
    await writeFile(file, '{ "workbench.colorTheme": "dark" }\n', 'utf8')

    const store = createStore(root)
    const broken = nextChange(store)
    await writeFile(file, '{ "workbench.colorTheme": "dar }\n', 'utf8')
    await broken

    const repaired = nextChange(store)
    await writeFile(file, '{ "workbench.colorTheme": "light" }\n', 'utf8')
    const snapshot = await repaired

    expect(snapshot.values['workbench.colorTheme']).toBe('light')
    expect(snapshot.layers.find((entry) => entry.id === 'user')?.file?.parseErrors).toEqual([])
  })

  // Retention holds the *previous* values, and on the first read of a process
  // there are none. Publishing an empty document there would be a worse version
  // of the bug this branch exists to fix — a stray BOM never stops being a parse
  // error, so the drop would be permanent rather than mid-edit.
  it('falls back to what the parser recovered when it boots onto a broken file', async () => {
    const root = await tempRoot()
    await writeFile(
      path.join(root, 'settings.json'),
      '\ufeff{\n  "editor.fontSize": 21\n}\n',
      'utf8',
    )

    const store = createStore(root, { watch: false })
    const snapshot = store.snapshot()

    expect(snapshot.values['editor.fontSize']).toBe(21)
    expect(
      snapshot.layers.find((entry) => entry.id === 'user')?.file?.parseErrors.length,
    ).toBeGreaterThan(0)
  })

  // Deleting the file is a decision, not a syntax error. Holding the old values
  // through a delete would make the delete look ignored.
  it('does not hold values through a deleted file', async () => {
    const root = await tempRoot()
    const file = path.join(root, 'settings.json')
    await writeFile(file, '{ "editor.fontSize": 21 }\n', 'utf8')

    const store = createStore(root)
    expect(store.snapshot().values['editor.fontSize']).toBe(21)

    const removed = nextChange(store)
    await rm(file)
    const snapshot = await removed

    expect(snapshot.values['editor.fontSize']).toBe(13)
  })
})

describe('external edits', () => {
  it('picks up a hand-edited file the store never wrote', async () => {
    const root = await tempRoot()
    const store = createStore(root)
    const changed = nextChange(store)

    await writeFile(
      path.join(root, 'settings.json'),
      '{\n  "keybindings.overrides": { "workspace.saveFile": ["Mod+Alt+S"] }\n}\n',
      'utf8',
    )

    const snapshot = await changed
    expect(snapshot.values['keybindings.overrides']).toEqual({
      'workspace.saveFile': ['Mod+Alt+S'],
    })
    expect(snapshot.serverVersion.sequence).toBe(1)
  })

  it('queues a newer watcher read behind an older read already in flight', async () => {
    const root = await tempRoot()
    const file = path.join(root, 'settings.json')
    await writeFile(file, '{ "editor.fontSize": 18 }\n', 'utf8')
    const firstStarted = deferred()
    const releaseFirst = deferred()
    const secondStarted = deferred()
    const releaseSecond = deferred()
    let reads = 0
    const store = createStore(root, {
      layerReader: async (_context, read) => {
        reads += 1
        const captured = await read()
        if (reads === 1) {
          firstStarted.resolve()
          await releaseFirst.promise
        }
        if (reads === 2) {
          secondStarted.resolve()
          await releaseSecond.promise
        }

        return captured
      },
    })
    const seen: number[] = []
    store.onChange((event) => seen.push(event.snapshot.values['editor.fontSize']))

    await writeFile(file, '{ "editor.fontSize": 19 }\n', 'utf8')
    await firstStarted.promise
    await writeFile(file, '{ "editor.fontSize": 20 }\n', 'utf8')
    await new Promise((resolve) => setTimeout(resolve, 300))
    releaseFirst.resolve()
    await secondStarted.promise
    const changed = nextChange(store)
    releaseSecond.resolve()
    const snapshot = await changed

    expect(snapshot.values['editor.fontSize']).toBe(20)
    expect(seen).toEqual([20])
  })

  it('delivers an edit that landed between the read and the watcher', async () => {
    const root = await tempRoot()
    const filePath = path.join(root, 'settings.json')
    await writeFile(filePath, '{ "keybindings.overrides": { "a.one": ["Mod+1"] } }', 'utf8')

    // Driven through the layer because `SettingsStore`'s constructor reads and
    // arms in one synchronous breath, so this window cannot be opened from
    // outside it — but every boot has it, and `fs.watch` under Bun widens it by
    // returning before its watcher is live: measured, up to 7.5% of writes in
    // the first millisecond after arming are never reported, and the layer then
    // serves the old file for the life of the process.
    const layer = new SettingsFileLayer('user', filePath)
    layer.loadSync()
    layers.push(layer)

    // Finished before the watcher exists, so no filesystem event can carry it.
    // The change below is the arming catch-up or it is nothing.
    await writeFile(filePath, '{ "keybindings.overrides": { "a.two": ["Mod+2"] } }', 'utf8')
    // Bun's watcher is fuzzy at both ends of its arming window: it drops events
    // that land just after, and sometimes replays ones from just before. This
    // wait is the second of those, and it only ever makes the test stricter —
    // long enough and the edit above is unambiguously history no event will
    // mention.
    await new Promise((resolve) => setTimeout(resolve, 250))

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error('settings layer never reported a change')),
        10_000,
      )
      layer.watch(() => {
        clearTimeout(timer)
        resolve()
      })
    })

    expect(layer.snapshot().raw).toEqual({ 'keybindings.overrides': { 'a.two': ['Mod+2'] } })
  })

  it('survives the file being replaced rather than modified in place', async () => {
    const root = await tempRoot()
    const filePath = path.join(root, 'settings.json')
    await writeFile(filePath, '{ "keybindings.overrides": { "a.one": ["Mod+1"] } }', 'utf8')
    const store = createStore(root)

    const changed = nextChange(store)
    // An atomic save replaces the inode, which detaches a plain file watcher.
    // The directory watcher is what keeps this working.
    await rm(filePath)
    await writeFile(filePath, '{ "keybindings.overrides": { "a.two": ["Mod+2"] } }', 'utf8')

    const snapshot = await changed
    expect(snapshot.values['keybindings.overrides']).toEqual({ 'a.two': ['Mod+2'] })
  })

  it('reports a change again after the file returns to content it once wrote', async () => {
    const root = await tempRoot()
    const filePath = path.join(root, 'settings.json')
    const store = createStore(root)

    await setKeybinding(store, 'a.one', 'Mod+1')
    const written = await readFile(filePath, 'utf8')

    const away = nextChange(store)
    await writeFile(filePath, '{ "keybindings.overrides": { "a.one": ["Mod+9"] } }', 'utf8')
    expect((await away).values['keybindings.overrides']).toEqual({ 'a.one': ['Mod+9'] })

    // Undo in the user's editor, restoring the exact bytes the store wrote. If
    // the echo-suppression hash is not cleared on every applied reload, this
    // event is swallowed forever and the store serves a value the file does not
    // hold — with `echoSuppressed` in the log making it look deliberate.
    const back = nextChange(store)
    await writeFile(filePath, written, 'utf8')

    expect((await back).values['keybindings.overrides']).toEqual({ 'a.one': ['Mod+1'] })
  })

  it('does not report the echo of its own write', async () => {
    const root = await tempRoot()
    const store = createStore(root)
    const seen: number[] = []
    store.onChange((event) => seen.push(event.snapshot.serverVersion.sequence))

    await setKeybinding(store, 'a.one', 'Mod+1')
    await new Promise((resolve) => setTimeout(resolve, 400))

    // Exactly one: the write itself. The watch event its own rename produced
    // must not arrive as a second, spurious change.
    expect(seen).toEqual([1])
  })

  it('rearms a leaf symlink watcher after a canonical write replaces its target', async () => {
    const root = await tempRoot()
    const real = path.join(root, 'real.json')
    const alias = path.join(root, 'alias.json')
    await writeFile(real, '{ "editor.fontSize": 18 }\n', 'utf8')
    await symlink('real.json', alias, 'file')
    const store = new SettingsStore({
      secretsFilePath: path.join(root, 'secrets.json'),
      userFilePath: alias,
    })
    stores.push(store)

    await store.write({
      mutationId: 'leaf-symlink-watcher-write',
      operations: [{ key: 'editor.lineHeight', kind: 'set', value: 30 }],
      target: 'user',
    })
    await new Promise((resolve) => setTimeout(resolve, 400))
    const seen: number[] = []
    store.onChange((event) => seen.push(event.snapshot.values['editor.fontSize']))
    const changed = nextChange(store)

    const externalStage = path.join(root, 'external-settings.stage')
    await writeFile(externalStage, '{ "editor.fontSize": 27 }\n', 'utf8')
    await rename(externalStage, real)

    expect((await changed).values['editor.fontSize']).toBe(27)
    await new Promise((resolve) => setTimeout(resolve, 400))
    expect(seen).toEqual([27])
  })
})

describe('watcher read failures', () => {
  it('records one warning and retries a transient read through to an update', async () => {
    const root = await tempRoot()
    const logDir = await tempRoot()
    const file = path.join(root, 'settings.json')
    await writeFile(file, '{ "editor.fontSize": 18 }\n', 'utf8')
    let readAttempts = 0
    initializeObservability({
      OBSERVABILITY_CONSOLE: 'false',
      OBSERVABILITY_DIR: logDir,
      OBSERVABILITY_ENABLED: 'true',
      OBSERVABILITY_INFO_SAMPLE_RATE: '100',
      NODE_ENV: 'production',
    })
    const store = createStore(root, {
      layerReader: async (_context, read) => {
        readAttempts += 1
        if (readAttempts === 1) throw settingsErrors.WRITE_CONTENDED({})

        return read()
      },
    })
    const changed = nextChange(store)
    await writeFile(file, '{ "editor.fontSize": 24 }\n', 'utf8')

    expect((await changed).values['editor.fontSize']).toBe(24)
    expect(readAttempts).toBeGreaterThanOrEqual(2)
    await flushObservability()
    const warnings: WideEvent[] = []
    for await (const event of readFsLogs({ dir: logDir })) {
      if (event.action === 'settings.layer.reload_failed') warnings.push(event)
    }

    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toMatchObject({
      area: 'settings',
      error: { code: expect.any(String), name: expect.any(String) },
      level: 'warn',
      operation: 'watcher-read',
      settings: { layer: 'user' },
    })
    expect(JSON.stringify(warnings)).not.toContain(root)
  })
})

describe('a malformed file', () => {
  it('serves defaults and refuses to write, naming the file', async () => {
    const root = await tempRoot()
    await writeFile(path.join(root, 'settings.json'), '{ "keybindings.overrides": ', 'utf8')
    const store = createStore(root, { watch: false })

    // One bad file must not take the document down: the running app still needs
    // whatever keybindings it can get.
    expect(store.snapshot().values['keybindings.overrides']).toEqual({})

    await expect(setModelOrderEmpty(store)).rejects.toMatchObject({
      code: 'settings.FILE_MALFORMED',
    })
  })

  it('treats an empty file as an empty document and still writes', async () => {
    const root = await tempRoot()
    await writeFile(path.join(root, 'settings.json'), '', 'utf8')
    const store = createStore(root, { watch: false })

    // The most common outcome of a crashed editor save. Treating it as a parse
    // error would deadlock every write with no way back from inside the app.
    await expect(setModelOrderEmpty(store)).resolves.toBeDefined()
  })
})

describe('the policy layer', () => {
  it('wins over the file and refuses a write to the key it owns', async () => {
    const root = await tempRoot()
    const store = createStore(root, {
      policy: { 'keybindings.overrides': { 'a.locked': ['Mod+L'] } },
      watch: false,
    })

    expect(store.snapshot().values['keybindings.overrides']).toEqual({ 'a.locked': ['Mod+L'] })
    // Accepting the write and then resolving back to the policy value would look
    // like a silent failure, which is worse than a refusal.
    await expect(setKeybinding(store, 'a.locked', 'Mod+L')).rejects.toMatchObject({
      code: 'settings.POLICY_CONTROLLED',
    })
  })
})

describe('the settings file itself', () => {
  it('is human-readable and holds only what was changed', async () => {
    const root = await tempRoot()
    const store = createStore(root, { watch: false })

    await setKeybinding(store, 'a.one', 'Mod+1')

    const text = await readFile(path.join(root, 'settings.json'), 'utf8')
    expect(text).toContain('"keybindings.overrides"')
    // Untouched keys stay out of the file, which is what keeps a default live:
    // it comes from the running build rather than a copy frozen at write time.
    expect(text).not.toContain('models.hidden')
    expect(text).not.toContain('providers.instances')
  })
})

describe('a secrets file that cannot be read', () => {
  it('still delivers the change that was in flight during a watch-driven reload', async () => {
    const root = await tempRoot()
    // Construct the store *before* the bad directory exists: `SettingsStore`'s
    // constructor also calls `secretStore.readSync()`, and that one refuses to
    // start rather than degrading — so creating the directory first would throw
    // there instead of on the reload path under test.
    const store = createStore(root)
    const secretsPath = path.join(root, 'secrets.json')
    // A directory where the file should be: `readFileSync` throws EISDIR, which
    // is not ENOENT, so `readSettingsFileSync` rethrows out of `invalidate()` —
    // straight into the detached reload. Before `runDetached` this killed Bun.
    await mkdir(secretsPath)
    // Assert on what a listener *receives*, not on `store.snapshot()`. The
    // cached snapshot is cleared before the failing read, so a later
    // `snapshot()` call recomputes from the layer and reports the new value
    // whether or not the notification ever happened — it cannot tell a
    // delivered change from a dropped one. `nextChange` is a listener, so it
    // makes the same distinction while waiting for the event instead of
    // guessing at how long it takes.
    const degraded = nextChange(store)

    await writeFile(
      path.join(root, 'settings.json'),
      '{ "keybindings.overrides": { "a.one": ["Mod+1"] } }',
      'utf8',
    )

    expect((await degraded).values['keybindings.overrides']).toEqual({ 'a.one': ['Mod+1'] })

    // And the store recovers on its own once the file is readable again.
    await rm(secretsPath, { recursive: true })
    const recovered = nextChange(store)
    await writeFile(
      path.join(root, 'settings.json'),
      '{ "keybindings.overrides": { "a.two": ["Mod+2"] } }',
      'utf8',
    )

    expect((await recovered).values['keybindings.overrides']).toEqual({ 'a.two': ['Mod+2'] })
  })
})
