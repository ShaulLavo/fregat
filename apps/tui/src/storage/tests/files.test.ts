import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { environmentIdSchema, healthDescriptorSchema } from '@workspace/contracts'
import * as v from 'valibot'
import { Database } from 'bun:sqlite'

import { openFileStorage, type FileStorage } from '@/storage/files'
import { readRecentCommands, recordRecentCommand, RECENT_COMMANDS } from '@/storage/recents'
import { createTestSettingsSession } from '../../../test/factories/session'
import { test, expect } from '../../../test/fixtures'
import { startStorageWriter } from '../../../test/factories/storage-writer'

const firstEnvironment = v.parse(environmentIdSchema, '11111111-1111-4111-8111-111111111111')
const secondEnvironment = v.parse(environmentIdSchema, '22222222-2222-4222-8222-222222222222')

test('two live instances preserve separate keys and both command histories', async ({ server }) => {
  const directory = `${server.root}/cache`
  const first = await openFileStorage(directory, firstEnvironment)
  const second = await openFileStorage(directory, firstEnvironment)
  first.setItem('file-picker-directory', 'first/project')
  recordRecentCommand(first, 'first.command')
  await first.flush()
  second.setItem('another-key', 'second value')
  recordRecentCommand(second, 'second.command')
  await second.flush()

  const reopened = await openFileStorage(directory, firstEnvironment)
  expect(reopened.getItem('file-picker-directory')).toBe('first/project')
  expect(reopened.getItem('another-key')).toBe('second value')
  expect(readRecentCommands(reopened)).toEqual(['second.command', 'first.command'])
  expect(first.getItem('another-key')).toBe('second value')
  first.removeItem('another-key')
  await first.flush()
  recordRecentCommand(second, 'third.command')
  await second.flush()
  expect(second.getItem('another-key')).toBeNull()
  first.close()
  second.close()
  reopened.close()
})

test('simultaneous processes preserve every key and atomically merge recent commands', async ({
  server,
}) => {
  const directory = `${server.root}/cache`
  const first = startStorageWriter(directory, firstEnvironment, 'first')
  const second = startStorageWriter(directory, firstEnvironment, 'second')
  try {
    await Promise.all([first.ready, second.ready])
    first.run()
    second.run()
    expect(await first.result()).toEqual({ code: 0, error: '' })
    expect(await second.result()).toEqual({ code: 0, error: '' })
    const storage = await openFileStorage(directory, firstEnvironment)
    try {
      expectConcurrentValues(storage)
    } finally {
      storage.close()
    }
  } finally {
    first.child.kill()
    second.child.kill()
    await Promise.all([first.child.exited, second.child.exited])
  }
})

function expectConcurrentValues(storage: FileStorage) {
  const recents = readRecentCommands(storage)
  expect(recents).toHaveLength(30)
  for (let index = 0; index < 15; index += 1) {
    expect(storage.getItem(`first.${index}`)).toBe(String(index))
    expect(storage.getItem(`second.${index}`)).toBe(String(index))
    expect(recents).toContain(`first.command.${index}`)
    expect(recents).toContain(`second.command.${index}`)
  }
}

test('environment caches keep values and command history separate on disk', async ({ server }) => {
  const directory = `${server.root}/cache`
  const first = await openFileStorage(directory, firstEnvironment)
  const second = await openFileStorage(directory, secondEnvironment)
  first.setItem('file-picker-directory', 'first/project')
  second.setItem('file-picker-directory', 'second/project')
  first.setItem('discarded', 'temporary')
  first.removeItem('discarded')
  for (let index = 0; index < 55; index += 1) recordRecentCommand(first, `command.${index}`)
  recordRecentCommand(first, 'command.20')
  recordRecentCommand(second, 'second.command')
  await Promise.all([first.flush(), second.flush()])

  const reopenedFirst = await openFileStorage(directory, firstEnvironment)
  const reopenedSecond = await openFileStorage(directory, secondEnvironment)
  expect(reopenedFirst.getItem('file-picker-directory')).toBe('first/project')
  expect(reopenedSecond.getItem('file-picker-directory')).toBe('second/project')
  expect(reopenedFirst.getItem('discarded')).toBeNull()
  expect(readRecentCommands(reopenedFirst)).toHaveLength(50)
  expect(readRecentCommands(reopenedFirst).slice(0, 3)).toEqual([
    'command.20',
    'command.54',
    'command.53',
  ])
  expect(readRecentCommands(reopenedFirst).filter((id) => id === 'command.20')).toHaveLength(1)
  expect(readRecentCommands(reopenedSecond)).toEqual(['second.command'])
  expect((await stat(`${directory}/${firstEnvironment}.sqlite`)).mode & 0o777).toBe(0o600)
  first.close()
  second.close()
  reopenedFirst.close()
  reopenedSecond.close()
})

test('corrupt cache files are diagnosed without changing their bytes', async ({ server }) => {
  const directory = `${server.root}/cache`
  const filename = `${directory}/${firstEnvironment}.sqlite`
  await mkdir(directory)
  const invalid = ['{', 'not a database']
  for (const contents of invalid) {
    await writeFile(filename, contents)
    await expect(openFileStorage(directory, firstEnvironment)).rejects.toMatchObject({
      message: 'Could not read saved TUI state.',
    })
    expect(await readFile(filename, 'utf8')).toBe(contents)
  }
})

test.for(['{', '[3]', ''])(
  'opens corrupt recent history, deletes it on read, and warns once: %s',
  async (value, { server, storageWarnings }) => {
    const directory = `${server.root}/cache`
    const storage = await openFileStorage(directory, firstEnvironment)
    recordRecentCommand(storage, 'original.command')
    storage.setItem('unrelated', 'preserve this')
    storage.close()
    const database = new Database(`${directory}/${firstEnvironment}.sqlite`)
    database.query('UPDATE state SET value = ? WHERE key = ?').run(value, RECENT_COMMANDS)
    database.close()
    const reopened = await openFileStorage(directory, firstEnvironment)
    try {
      expect(readRecentCommands(reopened)).toEqual([])
      expect(reopened.getItem(RECENT_COMMANDS)).toBeNull()
      expect(reopened.getItem('unrelated')).toBe('preserve this')
      expect(readRecentCommands(reopened)).toEqual([])
      expect(storageWarnings).toMatchObject([{ level: 'warn', storageKey: RECENT_COMMANDS }])
    } finally {
      reopened.close()
    }
  },
)

test.for(['{', '[3]', ''])(
  'records a new command after discarding corrupt history: %s',
  async (value, { server, storageWarnings }) => {
    const directory = `${server.root}/cache`
    const storage = await openFileStorage(directory, firstEnvironment)
    const database = new Database(`${directory}/${firstEnvironment}.sqlite`)
    database.query('INSERT INTO state (key, value) VALUES (?, ?)').run(RECENT_COMMANDS, value)
    database.close()
    try {
      recordRecentCommand(storage, 'new.command')
      expect(readRecentCommands(storage)).toEqual(['new.command'])
      expect(storageWarnings).toMatchObject([{ level: 'warn', storageKey: RECENT_COMMANDS }])
    } finally {
      storage.close()
    }
  },
)

test('absent recent commands return an empty history without warning', ({
  storage,
  storageWarnings,
}) => {
  expect(readRecentCommands(storage)).toEqual([])
  expect(storageWarnings).toEqual([])
})

test('invalid recent-command writes are rejected before they can poison a running cache', async ({
  server,
}) => {
  const storage = await openFileStorage(`${server.root}/cache`, firstEnvironment)
  recordRecentCommand(storage, 'workspace.showSettings')
  for (const invalid of ['{', '[3]', '']) {
    expect(() => storage.setItem(RECENT_COMMANDS, invalid)).toThrow()
    expect(() => storage.updateItem(RECENT_COMMANDS, () => invalid)).toThrow()
  }
  expect(readRecentCommands(storage)).toEqual(['workspace.showSettings'])
  await storage.flush()
  storage.close()
})

test('the same session retries storage after an invalid cache is removed', async ({
  server,
  client,
}) => {
  const descriptor = v.parse(healthDescriptorSchema, (await client.health.get()).data)
  const directory = `${server.root}/tui`
  const filename = `${directory}/${descriptor.environmentId}.sqlite`
  await mkdir(directory)
  await writeFile(filename, JSON.stringify({ [RECENT_COMMANDS]: 'not json' }))
  const session = createTestSettingsSession(server)
  try {
    await session.refresh()
    expect(session.getSnapshot()).toMatchObject({
      kind: 'failed',
      failure: {
        message: 'Could not read saved TUI state.',
        fix: expect.stringContaining(filename),
      },
    })
    await rm(filename)
    await session.refresh()
    expect(session.getSnapshot()).toMatchObject({ kind: 'ready', connection: { kind: 'live' } })
  } finally {
    session.dispose()
    await session.flush()
  }
})
