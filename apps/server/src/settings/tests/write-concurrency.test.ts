import { lstat, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  DEFAULT_SETTING_VALUES,
  jsonEqual,
  providerDriverKindSchema,
  providerInstanceIdSchema,
  type ModelRef,
  type SettingsOperation,
} from '@workspace/contracts'
import * as v from 'valibot'
import { afterEach, describe, expect, it } from 'vitest'
import { SettingsStore, type SettingsStoreOptions } from '../store'
import { activeSettingsWriteCoordinatorCount } from '../write-coordinator'

const roots: string[] = []
const stores: SettingsStore[] = []

type Deferred = {
  readonly promise: Promise<void>
  readonly resolve: () => void
}

async function tempRoot() {
  const root = await mkdtemp(path.join(tmpdir(), 'settings-concurrency-'))
  roots.push(root)

  return root
}

function deferred(): Deferred {
  let resolve = () => {}
  const promise = new Promise<void>((done) => {
    resolve = done
  })

  return { promise, resolve }
}

function createStore(root: string, overrides: Partial<SettingsStoreOptions> = {}) {
  const store = new SettingsStore({
    secretsFilePath: path.join(root, 'secrets.json'),
    userFilePath: path.join(root, 'settings.json'),
    watch: false,
    ...overrides,
  })
  stores.push(store)

  return store
}

function setColorTheme(
  store: SettingsStore,
  mutationId: string,
  value: 'dark' | 'light' | 'system',
) {
  return store.write({
    mutationId,
    operations: [{ key: 'workbench.colorTheme', kind: 'set', value }],
    target: 'user',
  })
}

function userRaw(store: SettingsStore) {
  return store.snapshot().layers.find((layer) => layer.id === 'user')?.raw ?? {}
}

function modelRef(providerInstanceId: string, model: string): ModelRef {
  return { model, providerInstanceId: v.parse(providerInstanceIdSchema, providerInstanceId) }
}

afterEach(async () => {
  for (const store of stores.splice(0)) store.close()
  await Promise.all(roots.splice(0).map((root) => rm(root, { force: true, recursive: true })))
  expect(activeSettingsWriteCoordinatorCount()).toBe(0)
})

describe('semantic write coordination', () => {
  it('preserves 20 concurrent disjoint scalar writes', async () => {
    const root = await tempRoot()
    const store = createStore(root)
    const operations = [
      { key: 'workbench.colorTheme', kind: 'set', value: 'dark' },
      { key: 'workbench.palette', kind: 'set', value: 'sage' },
      { key: 'workbench.density', kind: 'set', value: 'cozy' },
      { key: 'workbench.surface.opacity', kind: 'set', value: 76 },
      { key: 'workbench.surface.contentOpacity', kind: 'set', value: 87 },
      { key: 'workbench.surface.blur', kind: 'set', value: 20 },
      { key: 'workbench.surface.saturation', kind: 'set', value: 200 },
      {
        key: 'workbench.wallpaper',
        kind: 'set',
        value: { enabled: false, source: { kind: 'desktop' } },
      },
      { key: 'workbench.tree.indentGuides', kind: 'set', value: 'always' },
      { key: 'editor.fontFamily', kind: 'set', value: 'nerd:FiraCode' },
      { key: 'editor.fontSize', kind: 'set', value: 18 },
      { key: 'editor.lineHeight', kind: 'set', value: 28 },
      { key: 'editor.tabSize', kind: 'set', value: 2 },
      { key: 'editor.diff.viewMode', kind: 'set', value: 'split' },
      { key: 'terminal.integrated.fontSize', kind: 'set', value: 14 },
      { key: 'terminal.integrated.scrollback', kind: 'set', value: 20_000 },
      { key: 'terminal.integrated.cursorBlinking', kind: 'set', value: false },
      { key: 'editor.minimap.enabled', kind: 'set', value: false },
      { key: 'editor.guides.indentation', kind: 'set', value: false },
      { key: 'editor.syntaxHighlighting.enabled', kind: 'set', value: false },
    ] as const satisfies readonly SettingsOperation[]

    await Promise.all(
      operations.map((operation, index) =>
        store.write({
          mutationId: `disjoint-${index}`,
          operations: [operation],
          target: 'user',
        }),
      ),
    )

    // A value equal to its registry default is pruned rather than written.
    const raw = userRaw(store)
    for (const operation of operations) {
      if (operation.kind !== 'set') continue
      const isDefault = jsonEqual(operation.value, DEFAULT_SETTING_VALUES[operation.key])
      expect(raw[operation.key], operation.key).toEqual(isDefault ? undefined : operation.value)
    }
  })

  it('settles dark to light to system in coordinator admission order', async () => {
    const root = await tempRoot()
    const darkStaged = deferred()
    const releaseDark = deferred()
    const lightStaged = deferred()
    const releaseLight = deferred()
    const store = createStore(root, {
      writeHooks: {
        async afterStage(context) {
          if (context.id === 'theme-dark') {
            darkStaged.resolve()
            await releaseDark.promise
          }
          if (context.id !== 'theme-light') return
          lightStaged.resolve()
          await releaseLight.promise
        },
      },
    })

    const dark = setColorTheme(store, 'theme-dark', 'dark')
    await darkStaged.promise
    const light = setColorTheme(store, 'theme-light', 'light')
    releaseDark.resolve()
    await lightStaged.promise
    const system = setColorTheme(store, 'theme-system', 'system')
    releaseLight.resolve()

    await expect(Promise.all([dark, light, system])).resolves.toHaveLength(3)
    expect(store.snapshot().values['workbench.colorTheme']).toBe('system')
  })

  it('rebases an idempotent semantic intent after an injected disk revision change', async () => {
    const root = await tempRoot()
    const attempts: number[] = []
    const store = createStore(root, {
      writeHooks: {
        async afterStage(context) {
          attempts.push(context.attempt)
          if (context.attempt !== 1) return
          await writeFile(
            context.staged.destination,
            '{\n  // external edit\n  "editor.lineHeight": 35,\n  "outside.key": true\n}\n',
            'utf8',
          )
        },
      },
    })

    const result = await store.write({
      mutationId: 'semantic-rebase',
      operations: [{ key: 'editor.fontSize', kind: 'set', value: 19 }],
      target: 'user',
    })

    expect(attempts).toEqual([1, 2])
    expect(result.snapshot.values['editor.fontSize']).toBe(19)
    expect(result.snapshot.values['editor.lineHeight']).toBe(35)
    expect(await readFile(path.join(root, 'settings.json'), 'utf8')).toContain('// external edit')
  })

  it('returns WRITE_CONTENDED and cleans stages after the bounded rebase budget', async () => {
    const root = await tempRoot()
    const store = createStore(root, {
      rebaseAttempts: 2,
      writeHooks: {
        async afterStage(context) {
          await writeFile(
            context.staged.destination,
            `{ "editor.lineHeight": ${30 + context.attempt} }\n`,
            'utf8',
          )
        },
      },
    })

    await expect(
      store.write({
        mutationId: 'never-settles',
        operations: [{ key: 'editor.fontSize', kind: 'set', value: 20 }],
        target: 'user',
      }),
    ).rejects.toMatchObject({
      attempts: 2,
      code: 'settings.WRITE_CONTENDED',
      coordinatorWaitMs: expect.any(Number),
    })

    expect((await readdir(root)).filter((name) => name.endsWith('.tmp'))).toEqual([])
  })

  it('coordinates two stores through canonical real and symlink paths', async () => {
    const root = await tempRoot()
    const real = path.join(root, 'real')
    const alias = path.join(root, 'alias')
    await mkdir(real)
    await symlink(real, alias, 'dir')
    const firstStaged = deferred()
    const releaseFirst = deferred()
    let secondStaged = false
    const first = createStore(root, {
      secretsFilePath: path.join(real, 'secrets.json'),
      userFilePath: path.join(real, 'settings.json'),
      writeHooks: {
        async afterStage() {
          firstStaged.resolve()
          await releaseFirst.promise
        },
      },
    })
    const second = createStore(root, {
      secretsFilePath: path.join(real, 'secrets.json'),
      userFilePath: path.join(alias, 'settings.json'),
      writeHooks: { afterStage: () => void (secondStaged = true) },
    })

    const fontSize = first.write({
      mutationId: 'canonical-first',
      operations: [{ key: 'editor.fontSize', kind: 'set', value: 21 }],
      target: 'user',
    })
    await firstStaged.promise
    const lineHeight = second.write({
      mutationId: 'canonical-second',
      operations: [{ key: 'editor.lineHeight', kind: 'set', value: 33 }],
      target: 'user',
    })
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(secondStaged).toBe(false)
    releaseFirst.resolve()

    await Promise.all([fontSize, lineHeight])
    const raw = JSON.parse(await readFile(path.join(real, 'settings.json'), 'utf8'))
    expect(raw).toMatchObject({ 'editor.fontSize': 21, 'editor.lineHeight': 33 })
  })

  it('writes through a leaf symlink without replacing it', async () => {
    const root = await tempRoot()
    const real = path.join(root, 'real.json')
    const alias = path.join(root, 'alias.json')
    const secrets = path.join(root, 'secrets.json')
    await writeFile(real, '{}\n', 'utf8')
    await symlink('real.json', alias, 'file')
    const first = createStore(root, { secretsFilePath: secrets, userFilePath: real })
    const second = createStore(root, { secretsFilePath: secrets, userFilePath: alias })

    await Promise.all([
      first.write({
        mutationId: 'leaf-real',
        operations: [{ key: 'editor.fontSize', kind: 'set', value: 22 }],
        target: 'user',
      }),
      second.write({
        mutationId: 'leaf-alias',
        operations: [{ key: 'editor.lineHeight', kind: 'set', value: 34 }],
        target: 'user',
      }),
    ])

    expect((await lstat(alias)).isSymbolicLink()).toBe(true)
    expect(JSON.parse(await readFile(real, 'utf8'))).toMatchObject({
      'editor.fontSize': 22,
      'editor.lineHeight': 34,
    })
  })
})

describe('collection intent', () => {
  it('preserves unrelated keybinding, model, and provider entries', async () => {
    const root = await tempRoot()
    const store = createStore(root)
    const alpha = modelRef('provider-one', 'alpha')
    const beta = modelRef('provider-two', 'beta')
    const providerOne = v.parse(providerInstanceIdSchema, 'provider-one')
    const providerTwo = v.parse(providerInstanceIdSchema, 'provider-two')
    const driverKind = v.parse(providerDriverKindSchema, 'codex')

    await Promise.all([
      store.write({
        mutationId: 'keybinding-one',
        operations: [{ command: 'command.one', keys: ['Mod+1'], kind: 'keybinding.set' }],
        target: 'user',
      }),
      store.write({
        mutationId: 'keybinding-two',
        operations: [{ command: 'command.two', keys: ['Mod+2'], kind: 'keybinding.set' }],
        target: 'user',
      }),
      store.write({
        mutationId: 'hidden-alpha',
        operations: [{ hidden: true, kind: 'model.setHidden', ref: alpha }],
        target: 'user',
      }),
      store.write({
        mutationId: 'hidden-beta',
        operations: [{ hidden: true, kind: 'model.setHidden', ref: beta }],
        target: 'user',
      }),
      store.write({
        mutationId: 'provider-one',
        operations: [
          {
            createIfMissing: { driverKind, environment: [{ name: 'TOKEN', value: '' }] },
            enabled: true,
            kind: 'provider.setEnabled',
            providerInstanceId: providerOne,
          },
        ],
        target: 'user',
      }),
      store.write({
        mutationId: 'provider-two',
        operations: [
          {
            createIfMissing: { driverKind },
            enabled: false,
            kind: 'provider.setEnabled',
            providerInstanceId: providerTwo,
          },
        ],
        target: 'user',
      }),
    ])

    const values = store.snapshot().values
    expect(values['keybindings.overrides']).toMatchObject({
      'command.one': ['Mod+1'],
      'command.two': ['Mod+2'],
    })
    expect(values['models.hidden']).toEqual(expect.arrayContaining([alpha, beta]))
    expect(values['providers.instances']).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ enabled: true, providerInstanceId: providerOne }),
        expect.objectContaining({ enabled: false, providerInstanceId: providerTwo }),
      ]),
    )
  })

  it('treats model order as one atomic last-writer-wins register', async () => {
    const root = await tempRoot()
    const firstStaged = deferred()
    const releaseFirst = deferred()
    const store = createStore(root, {
      writeHooks: {
        async afterStage(context) {
          if (context.id !== 'order-first') return
          firstStaged.resolve()
          await releaseFirst.promise
        },
      },
    })
    const alpha = modelRef('provider-one', 'alpha')
    const beta = modelRef('provider-two', 'beta')

    const first = store.write({
      mutationId: 'order-first',
      operations: [{ kind: 'model.setOrder', order: [alpha, beta] }],
      target: 'user',
    })
    await firstStaged.promise
    const second = store.write({
      mutationId: 'order-second',
      operations: [{ kind: 'model.setOrder', order: [beta, alpha] }],
      target: 'user',
    })
    releaseFirst.resolve()
    await Promise.all([first, second])

    expect(store.snapshot().values['models.order']).toEqual([beta, alpha])
  })
})

describe('raw and semantic ordering', () => {
  it('lets a semantic write apply over a raw write admitted first', async () => {
    const root = await tempRoot()
    const rawStaged = deferred()
    const releaseRaw = deferred()
    const store = createStore(root, {
      writeHooks: {
        async afterStage(context) {
          if (context.id !== 'raw-first') return
          rawStaged.resolve()
          await releaseRaw.promise
        },
      },
    })

    const raw = store.writeRaw({
      baseRevision: '',
      target: 'user',
      text: '{ "editor.fontSize": 24 }\n',
      writeId: 'raw-first',
    })
    await rawStaged.promise
    const semantic = store.write({
      mutationId: 'semantic-second',
      operations: [{ key: 'editor.lineHeight', kind: 'set', value: 36 }],
      target: 'user',
    })
    releaseRaw.resolve()
    await Promise.all([raw, semantic])

    expect(store.snapshot().values).toMatchObject({
      'editor.fontSize': 24,
      'editor.lineHeight': 36,
    })
  })

  it('conflicts a stale raw save after a semantic write admitted first', async () => {
    const root = await tempRoot()
    const semanticStaged = deferred()
    const releaseSemantic = deferred()
    const store = createStore(root, {
      writeHooks: {
        async afterStage(context) {
          if (context.id !== 'semantic-first') return
          semanticStaged.resolve()
          await releaseSemantic.promise
        },
      },
    })

    const semantic = store.write({
      mutationId: 'semantic-first',
      operations: [{ key: 'editor.fontSize', kind: 'set', value: 25 }],
      target: 'user',
    })
    await semanticStaged.promise
    const raw = store.writeRaw({
      baseRevision: '',
      target: 'user',
      text: '{ "editor.lineHeight": 37 }\n',
      writeId: 'raw-second',
    })
    releaseSemantic.resolve()

    await expect(semantic).resolves.toBeDefined()
    await expect(raw).rejects.toMatchObject({ code: 'settings.RAW_REVISION_STALE' })
    expect(store.snapshot().values['editor.fontSize']).toBe(25)
  })
})
