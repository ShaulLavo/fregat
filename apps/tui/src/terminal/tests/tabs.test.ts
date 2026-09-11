import { readTerminalTabs, saveTerminalTabs } from '@/terminal/utils/tabs'
import { openFileStorage } from '@/storage/files'
import { interleaveStorageRead } from '../../../test/factories/storage-read'
import { test, expect } from '../../../test/fixtures'

test('reading and saving tabs after a competing repair preserves the winning tabs', async ({
  server,
  storage,
  storageWarnings,
}) => {
  const key = `terminal-tabs:${server.root}`
  const second = await openFileStorage(`${server.root}/storage`, storage.environmentId)
  const winner = { ids: ['new'], selected: 'new' }
  try {
    storage.setItem(key, '{')
    const interleaved = interleaveStorageRead(storage, key, () => {
      saveTerminalTabs(second, server.root, winner)
    })
    const tabs = readTerminalTabs(interleaved, server.root)
    saveTerminalTabs(interleaved, server.root, tabs)
    expect(readTerminalTabs(second, server.root)).toEqual(winner)
    expect(storageWarnings).toEqual([])
  } finally {
    second.close()
  }
})

test.for(['{', '[]', '', '{"ids":[3],"selected":null}'])(
  'deletes corrupt terminal tabs and warns once: %s',
  async (raw, { server, storage, storageWarnings }) => {
    const key = `terminal-tabs:${server.root}`
    storage.setItem(key, raw)
    const tabs = readTerminalTabs(storage, server.root)
    expect(tabs.ids).toEqual([expect.any(String)])
    expect(tabs.selected).toBe(tabs.ids[0])
    expect(storage.getItem(key)).toBeNull()
    const next = readTerminalTabs(storage, server.root)
    expect(next.selected).not.toBe(tabs.selected)
    expect(storageWarnings).toMatchObject([{ level: 'warn', storageKey: key }])
  },
)

test('absent terminal tabs get fresh ids without warning', ({
  server,
  storage,
  storageWarnings,
}) => {
  const first = readTerminalTabs(storage, server.root)
  const second = readTerminalTabs(storage, server.root)
  expect(first.ids).toEqual([first.selected])
  expect(first.selected).toEqual(expect.any(String))
  expect(second.selected).not.toBe(first.selected)
  expect(storageWarnings).toEqual([])
})

test('valid terminal tabs retain ids and select an existing tab', ({
  server,
  storage,
  storageWarnings,
}) => {
  saveTerminalTabs(storage, server.root, { ids: ['first', 'second'], selected: 'second' })
  expect(readTerminalTabs(storage, server.root)).toEqual({
    ids: ['first', 'second'],
    selected: 'second',
  })
  saveTerminalTabs(storage, server.root, { ids: ['first', 'second'], selected: 'missing' })
  expect(readTerminalTabs(storage, server.root).selected).toBe('first')
  saveTerminalTabs(storage, server.root, { ids: [], selected: null })
  expect(readTerminalTabs(storage, server.root)).toEqual({ ids: [], selected: null })
  expect(storageWarnings).toEqual([])
})
