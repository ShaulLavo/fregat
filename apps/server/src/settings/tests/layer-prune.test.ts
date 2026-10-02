import { chmod, lstat, mkdtemp, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { SettingsFileLayer, type LayerChange } from '../layer'
import { settingsErrors } from '../structured-errors'
import {
  activeSettingsWriteCoordinatorCount,
  withSettingsWriteCoordinator,
} from '../write-coordinator'

const roots: string[] = []
const layers: SettingsFileLayer[] = []

async function tempFile() {
  const root = await mkdtemp(path.join(tmpdir(), 'settings-prune-'))
  roots.push(root)
  return path.join(root, 'settings.json')
}

function layer(
  file: string,
  id: 'user' | 'workspace',
  onPruned?: (keys: readonly string[]) => void,
) {
  const created = new SettingsFileLayer(id, file, undefined, onPruned)
  layers.push(created)
  return created
}

afterEach(async () => {
  for (const current of layers.splice(0)) current.close()
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('user settings pruning', () => {
  it('prunes all duplicate unknown properties at synchronous boot and preserves known invalid values', async () => {
    const file = await tempFile()
    await writeFile(
      file,
      `{
  // kept setting
  "editor.fontSize": "invalid",
  "editor.fontSize": 17,
  "removed.key": 1,
  "removed\\u002ekey": 2,
  "toString": "unknown",
  "__proto__": "unknown",
  "developer.devServerIdleMinutes": 5,
}`,
    )
    const notices: (readonly string[])[] = []
    const current = layer(file, 'user', (keys) => notices.push(keys))
    current.loadSync()

    const text = await readFile(file, 'utf8')
    expect(text).toContain('// kept setting')
    expect(text).toContain('"editor.fontSize": "invalid"')
    expect(text).toContain('"editor.fontSize": 17')
    expect(text).toContain('"developer.devServerIdleMinutes": 5')
    expect(text).not.toContain('removed')
    expect(text).not.toContain('toString')
    expect(text).not.toContain('__proto__')
    expect(notices).toEqual([['removed.key', 'toString', '__proto__']])
    expect(current.snapshot().text).toBe(text)
    expect(current.snapshot().raw['editor.fontSize']).toBe(17)
    current.loadSync()
    expect(notices).toHaveLength(1)
  })

  it('prunes on asynchronous load through a symlink and preserves target mode', async () => {
    const file = await tempFile()
    const alias = path.join(path.dirname(file), 'alias.json')
    await writeFile(file, '{ "editor.fontSize": 16, "obsolete": true }')
    await chmod(file, 0o640)
    await symlink(file, alias)
    const notices: (readonly string[])[] = []
    const current = layer(alias, 'user', (keys) => notices.push(keys))
    await current.load()

    expect((await lstat(alias)).isSymbolicLink()).toBe(true)
    expect((await stat(file)).mode & 0o777).toBe(0o640)
    expect(current.snapshot().raw).toEqual({ 'editor.fontSize': 16 })
    expect(notices).toEqual([['obsolete']])
  })

  it('leaves malformed documents, workspace files and missing files untouched', async () => {
    const file = await tempFile()
    const malformed = '{ "obsolete": true, "editor.fontSize": '
    await writeFile(file, malformed)
    const notices: (readonly string[])[] = []
    const user = layer(file, 'user', (keys) => notices.push(keys))
    user.loadSync()
    await user.load()
    expect(await readFile(file, 'utf8')).toBe(malformed)
    expect(user.snapshot().parseErrors.length).toBeGreaterThan(0)

    const workspaceText = '{ "obsolete": true }'
    await writeFile(file, workspaceText)
    const workspace = layer(file, 'workspace', (keys) => notices.push(keys))
    workspace.loadSync()
    await workspace.load()
    expect(await readFile(file, 'utf8')).toBe(workspaceText)

    await rm(file)
    user.loadSync()
    await user.load()
    expect(user.snapshot().present).toBe(false)
    await expect(stat(file)).rejects.toMatchObject({ code: 'ENOENT' })
    expect(notices).toEqual([])
  })

  it('keeps readable settings when boot pruning cannot acquire an async writer’s lease', async () => {
    const file = await tempFile()
    const alias = path.join(path.dirname(file), 'alias.json')
    await writeFile(file, '{ "editor.fontSize": 17, "obsolete": true }')
    await symlink(file, alias)
    let signalReady = () => {}
    const ready = new Promise<void>((resolve) => {
      signalReady = resolve
    })
    let release = () => {}
    const held = new Promise<void>((resolve) => {
      release = resolve
    })
    const writer = withSettingsWriteCoordinator(file, async () => {
      signalReady()
      await held
    })
    await ready
    const notices: (readonly string[])[] = []
    const current = layer(alias, 'user', (keys) => notices.push(keys))
    try {
      expect(() => current.loadSync()).not.toThrow()
      expect(current.snapshot().raw).toEqual({ 'editor.fontSize': 17, obsolete: true })
      expect(notices).toEqual([])
      expect(await readFile(file, 'utf8')).toContain('obsolete')
      await writeFile(file, '{ "editor.fontSize": 18 }')
      current.loadSync()
      expect(current.snapshot().raw).toEqual({ 'editor.fontSize': 18 })
      await writeFile(file, '{ "obsolete": true }')
    } finally {
      release()
      await writer
    }
    expect(activeSettingsWriteCoordinatorCount()).toBe(0)
    current.loadSync()
    expect(current.snapshot().raw).toEqual({})
  })

  it.skipIf(process.platform === 'win32' || process.getuid?.() === 0)(
    'keeps readable settings when the directory cannot accept a staged prune',
    async () => {
      const file = await tempFile()
      const directory = path.dirname(file)
      const text = '{ "editor.fontSize": 17, "obsolete": true }'
      await writeFile(file, text)
      const notices: (readonly string[])[] = []
      const current = layer(file, 'user', (keys) => notices.push(keys))
      await chmod(directory, 0o500)
      try {
        expect(() => current.loadSync()).not.toThrow()
        expect(current.snapshot().raw).toEqual({ 'editor.fontSize': 17, obsolete: true })
        expect(await readFile(file, 'utf8')).toBe(text)
        expect(notices).toEqual([])
      } finally {
        await chmod(directory, 0o700)
      }
      current.loadSync()
      expect(current.snapshot().raw).toEqual({ 'editor.fontSize': 17 })
      expect(notices).toEqual([['obsolete']])
    },
  )

  it('preserves initial read failures at synchronous boot', async () => {
    const file = await tempFile()
    const current = layer(path.dirname(file), 'user')
    expect(() => current.loadSync()).toThrow()
  })

  it('preserves a concurrent external edit and sends no notice when pruning loses its revision', async () => {
    const file = await tempFile()
    await writeFile(file, '{ "editor.fontSize": 14, "obsolete": true }')
    const externalText = '{ "editor.fontSize": 19 }'
    let reads = 0
    const notices: (readonly string[])[] = []
    const current = new SettingsFileLayer(
      'user',
      file,
      async (_context, read) => {
        const stale = await read()
        reads += 1
        if (reads === 2) await writeFile(file, externalText)
        return stale
      },
      (keys) => notices.push(keys),
    )
    layers.push(current)

    await expect(current.load()).rejects.toMatchObject({
      message: settingsErrors.WRITE_CONTENDED({}).message,
    })
    expect(await readFile(file, 'utf8')).toBe(externalText)
    expect(notices).toEqual([])
    expect(current.snapshot().present).toBe(false)
    expect(activeSettingsWriteCoordinatorCount()).toBe(0)
  })

  it('publishes a watcher prune once and settles its own rename echo', async () => {
    const file = await tempFile()
    await writeFile(file, '{ "editor.fontSize": 14 }')
    const notices: (readonly string[])[] = []
    const changes: LayerChange[] = []
    const current = layer(file, 'user', (keys) => notices.push(keys))
    current.loadSync()
    current.watch((change) => changes.push(change))
    await writeFile(file, '{ "editor.fontSize": 18, "obsolete": true }')

    await expect.poll(() => notices, { timeout: 5_000 }).toEqual([['obsolete']])
    await expect
      .poll(() => changes.map((change) => change.next.raw), { timeout: 5_000 })
      .toEqual([{ 'editor.fontSize': 18 }])
    expect(await readFile(file, 'utf8')).not.toContain('obsolete')
    // An explicit second read exercises the same bytes after the rename echo.
    await current.load()
    expect(notices).toHaveLength(1)
    expect(changes).toHaveLength(1)
  })
})
