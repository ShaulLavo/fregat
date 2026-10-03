import { chmod, mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { expect, test } from '../../../../test/fixtures'
import { fetchSettings } from '../utils/api'

test('boot removes retired user keys while preserving known settings and workspace bytes', async ({
  server,
  client,
}) => {
  const userFile = path.join(server.root, '.platform-test', 'settings.json')
  const workspaceFile = path.join(server.root, '.platform', 'settings.json')
  await mkdir(path.dirname(userFile), { recursive: true })
  await mkdir(path.dirname(workspaceFile), { recursive: true })
  await writeFile(
    userFile,
    '{\n  // Keep my settings\n  "editor.fontSize": 18,\n  "window.frost": true,\n  "window.material": "glass",\n  "retired.example": "private-value"\n}\n',
  )
  await chmod(userFile, 0o600)
  const workspaceText = '{\n  "window.frost": true,\n  "editor.fontSize": 20\n}\n'
  await writeFile(workspaceFile, workspaceText)
  await server.restart()

  const snapshot = await fetchSettings(undefined, client)
  const cleaned = await readFile(userFile, 'utf8')
  expect(cleaned).not.toContain('window.frost')
  expect(cleaned).not.toContain('retired.example')
  expect(cleaned).toContain('// Keep my settings')
  expect(cleaned.indexOf('editor.fontSize')).toBeLessThan(cleaned.indexOf('window.material'))
  expect(JSON.parse(cleaned.replace('// Keep my settings', ''))).toEqual({
    'editor.fontSize': 18,
    'window.material': 'glass',
  })
  expect((await stat(userFile)).mode & 0o777).toBe(0o600)
  expect(
    snapshot.diagnostics.filter((item) => item.kind === 'unknown-key' && item.layer === 'user'),
  ).toEqual([])
  expect(snapshot.diagnostics).toContainEqual(
    expect.objectContaining({ id: 'window.frost', kind: 'unknown-key', layer: 'workspace' }),
  )
  expect(await readFile(workspaceFile, 'utf8')).toBe(workspaceText)
  expect(snapshot.values['editor.fontSize']).toBe(20)
  expect(snapshot.diagnostics.filter((item) => item.kind === 'removed-key')).toEqual([
    {
      id: 'window.frost',
      kind: 'removed-key',
      layer: 'user',
      detail: 'Window frost was replaced by Window material.',
    },
    {
      id: 'retired.example',
      kind: 'removed-key',
      layer: 'user',
      detail: 'Removed setting from an older version: retired.example.',
    },
  ])
  expect(
    (await fetchSettings(undefined, client)).diagnostics.some(
      (item) => item.kind === 'removed-key',
    ),
  ).toBe(false)
  await server.restart()
  expect(
    (await fetchSettings(undefined, client)).diagnostics.some(
      (item) => item.kind === 'removed-key',
    ),
  ).toBe(false)
})

test('file changes prune removed keys and deliver one notice', async ({ server, client }) => {
  const userFile = path.join(server.root, '.platform-test', 'settings.json')
  await mkdir(path.dirname(userFile), { recursive: true })
  await writeFile(userFile, '{ "editor.fontSize": 18 }\n')
  await server.restart({ settingsWatch: true })
  await writeFile(userFile, '{ "editor.fontSize": 21, "window.frost": false }\n')
  // The rename is visible before the layer publishes; each GET consumes its pending notice.
  await expect
    .poll(
      async () => {
        const snapshot = await fetchSettings(undefined, client)
        return {
          fontSize: snapshot.values['editor.fontSize'],
          removedKeys: snapshot.diagnostics
            .filter((item) => item.kind === 'removed-key')
            .map((item) => item.id),
        }
      },
      { timeout: 10_000 },
    )
    .toEqual({ fontSize: 21, removedKeys: ['window.frost'] })
  expect(JSON.parse(await readFile(userFile, 'utf8'))).toEqual({ 'editor.fontSize': 21 })
  expect(
    (await fetchSettings(undefined, client)).diagnostics.some(
      (item) => item.kind === 'removed-key',
    ),
  ).toBe(false)
})

test('malformed user files retain their bytes', async ({ server, client }) => {
  const userFile = path.join(server.root, '.platform-test', 'settings.json')
  await mkdir(path.dirname(userFile), { recursive: true })
  const text = '{ "window.frost": true, "editor.fontSize": 18, "unfinished }\n'
  await writeFile(userFile, text)
  await server.restart()
  await fetchSettings(undefined, client)
  expect(await readFile(userFile, 'utf8')).toBe(text)
})

test('duplicate retired properties are all removed', async ({ server, client }) => {
  const userFile = path.join(server.root, '.platform-test', 'settings.json')
  await mkdir(path.dirname(userFile), { recursive: true })
  await writeFile(
    userFile,
    '{ "window.frost": true, "editor.fontSize": 18, "window.frost": false }\n',
  )
  await server.restart()
  const snapshot = await fetchSettings(undefined, client)
  expect(await readFile(userFile, 'utf8')).not.toContain('window.frost')
  expect(snapshot.values['editor.fontSize']).toBe(18)
  expect(snapshot.diagnostics.filter((item) => item.kind === 'removed-key')).toHaveLength(1)
})

test('known user settings are not rewritten on load', async ({ server, client }) => {
  const userFile = path.join(server.root, '.platform-test', 'settings.json')
  await mkdir(path.dirname(userFile), { recursive: true })
  const text = '{\n\t// My layout\n\t"editor.fontSize": 18,\n}\n'
  await writeFile(userFile, text)
  await server.restart()
  expect((await fetchSettings(undefined, client)).values['editor.fontSize']).toBe(18)
  expect(await readFile(userFile, 'utf8')).toBe(text)
})
