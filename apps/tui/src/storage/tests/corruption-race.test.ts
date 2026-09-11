import assert from 'node:assert/strict'
import { Database } from 'bun:sqlite'
import * as v from 'valibot'
import { worktreeIdSchema } from '@workspace/contracts'
import { createAgentRailState } from '@/agent-rail/state/rail'
import { readInbox } from '@/agent-stage/state/inbox'
import type { SettingsSession } from '@/connection/state/session'
import { openFileStorage, type FileStorage } from '@/storage/files'
import { readRecentCommands, RECENT_COMMANDS } from '@/storage/recents'
import { readTerminalTabs } from '@/terminal/utils/tabs'
import { openTestChat } from '../../../test/factories/chat'
import { interleaveStorageRead } from '../../../test/factories/storage-read'
import { test, expect } from '../../../test/fixtures'

const worktreeId = v.parse(worktreeIdSchema, 'aaaa1111-bbbb-4ccc-8ddd-eeeeffff2222')
const terminalRoot = '/race-workspace'
const readers = [
  { kind: 'recents', key: RECENT_COMMANDS, valid: ['new.command'] },
  {
    kind: 'inbox',
    key: `agent.inbox.worktree:${worktreeId}`,
    valid: [{ source: 'terminal', lineStart: 1, lineEnd: 1, text: 'New context' }],
  },
  {
    kind: 'collapsed',
    key: 'agent:rail:collapsed',
    valid: ['aaaa1111-bbbb-4ccc-8ddd-eeeeffff3333'],
  },
  { kind: 'seen', key: 'agent:rail:seen', valid: { session: '2026-07-01T12:00:00.000Z' } },
  { kind: 'tabs', key: `terminal-tabs:${terminalRoot}`, valid: { ids: ['new'], selected: 'new' } },
] satisfies { kind: Reader; key: string; valid: unknown }[]

type Reader = 'recents' | 'inbox' | 'collapsed' | 'seen' | 'tabs'

test.for(readers)(
  'stale $kind cleanup preserves a competing SQLite write without warning',
  async ({ kind, key, valid }, { server, storageWarnings }) => {
    const { session } = await openTestChat(server)
    const ready = session.getSnapshot()
    assert(ready.kind === 'ready')
    const directory = `${server.root}/tui`
    const second = await openFileStorage(directory, ready.storage.environmentId)
    const database = new Database(`${directory}/${ready.storage.environmentId}.sqlite`)
    try {
      database.query('INSERT INTO state (key, value) VALUES (?, ?)').run(key, '{')
      const replacement = JSON.stringify(valid)
      const interleaved = interleaveStorageRead(ready.storage, key, () => {
        second.setItem(key, replacement)
      })
      expect(readState(kind, interleaved, session)).toEqual(valid)
      expect(second.getItem(key)).toBe(replacement)
      expect(readState(kind, second, session)).toEqual(valid)
      expect(storageWarnings).toEqual([])
    } finally {
      database.close()
      second.close()
      session.dispose()
    }
  },
)

test.for(readers)(
  'stale $kind cleanup does not warn for a key another SQLite connection removed',
  async ({ kind, key }, { server, storageWarnings }) => {
    const { session } = await openTestChat(server)
    const ready = session.getSnapshot()
    assert(ready.kind === 'ready')
    const directory = `${server.root}/tui`
    const second = await openFileStorage(directory, ready.storage.environmentId)
    const database = new Database(`${directory}/${ready.storage.environmentId}.sqlite`)
    try {
      database.query('INSERT INTO state (key, value) VALUES (?, ?)').run(key, '{')
      const interleaved = interleaveStorageRead(ready.storage, key, () => second.removeItem(key))
      readState(kind, interleaved, session)
      expect(second.getItem(key)).toBeNull()
      expect(storageWarnings).toEqual([])
    } finally {
      database.close()
      second.close()
      session.dispose()
    }
  },
)

function readState(kind: Reader, storage: FileStorage, session: SettingsSession) {
  if (kind === 'recents') return readRecentCommands(storage)
  if (kind === 'inbox') return readInbox(storage, worktreeId)
  if (kind === 'tabs') return readTerminalTabs(storage, terminalRoot)
  const ready = session.getSnapshot()
  assert(ready.kind === 'ready')
  const rail = createAgentRailState(session, { ...ready, storage })
  const value = rail.getSnapshot()[kind]
  rail.dispose()
  return value
}
