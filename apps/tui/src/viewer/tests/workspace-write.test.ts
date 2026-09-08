import { readFile, readdir, writeFile } from 'node:fs/promises'
import { createEnvironmentClient } from '@workspace/client-core/transport/client'
import { commitWorkspaceEdits } from '@workspace/client-core/files/write'
import { createViewerDocument } from '@/viewer/state/document'
import { test, expect } from '../../../test/workspace-edit-fixtures'
import { createTestSettingsSession } from '../../../test/factories/session'
import {
  loseNextWorkspaceEditResponse,
  rollbackBeforeFinalize,
} from '../../../test/factories/workspace-edit'

test('a rolled-back external edit retains its durable draft and releases the failed transaction', async ({
  server,
  editFaults,
}) => {
  await writeFile(`${server.root}/sample.ts`, 'original')
  const session = createTestSettingsSession(server)
  await session.refresh()
  const document = createViewerDocument({
    session,
    rootPath: '',
    path: 'sample.ts',
    editText: async () => 'edited',
  })
  try {
    await document.open()
    editFaults.failNextWrite('sample.ts')
    await document.edit()
    expect(await readFile(`${server.root}/sample.ts`, 'utf8')).toBe('original')
    expect(document.getSnapshot()).toMatchObject({
      draft: { text: 'edited' },
      error: expect.stringContaining('rolled-back'),
    })
    const ready = session.getSnapshot()
    if (ready.kind !== 'ready') return expect.unreachable('Expected connected storage')
    expect(ready.storage.keys('viewer:draft:')).toHaveLength(1)
    expect(await readdir(server.workspaceEditJournalRoot)).toEqual([])
    await document.edit()
    expect(await readFile(`${server.root}/sample.ts`, 'utf8')).toBe('edited')
    expect(document.getSnapshot()).toMatchObject({ draft: null, error: null })
  } finally {
    document.dispose()
    session.dispose()
  }
})

for (const transition of ['commit', 'release'])
  test(`a lost ${transition} response recovers a successful save`, async ({ server }) => {
    await writeFile(`${server.root}/sample.ts`, 'original')
    const client = createEnvironmentClient({
      origin: server.origin,
      headers: () => ({ origin: server.clientOrigin }),
      fetcher: loseNextWorkspaceEditResponse(server, `/fs/workspace-edit/${transition}`),
    })
    const read = await client.fs.read.get({ query: { path: 'sample.ts' } })
    if (!read.data) return expect.unreachable('Expected readable file')
    const result = await commitWorkspaceEdits({
      client,
      rootPath: '',
      operations: [
        {
          kind: 'write',
          index: 0,
          path: 'sample.ts',
          text: 'edited',
          expected: { kind: 'snapshot', mtimeMs: read.data.mtimeMs, version: read.data.version },
        },
      ],
      signal: new AbortController().signal,
    })
    expect(result).toMatchObject({ state: 'released', rolledBackPaths: [] })
    expect(await readFile(`${server.root}/sample.ts`, 'utf8')).toBe('edited')
    expect(await readdir(server.workspaceEditJournalRoot)).toEqual([])
  })

test('a lost rolled-back commit response cannot turn failure into a successful save', async ({
  server,
  editFaults,
}) => {
  await writeFile(`${server.root}/sample.ts`, 'original')
  const client = createEnvironmentClient({
    origin: server.origin,
    headers: () => ({ origin: server.clientOrigin }),
    fetcher: loseNextWorkspaceEditResponse(server, '/fs/workspace-edit/commit'),
  })
  const read = await client.fs.read.get({ query: { path: 'sample.ts' } })
  if (!read.data) return expect.unreachable('Expected readable file')
  editFaults.failNextWrite('sample.ts')
  await expect(
    commitWorkspaceEdits({
      client,
      rootPath: '',
      operations: [
        {
          kind: 'write',
          index: 0,
          path: 'sample.ts',
          text: 'edited',
          expected: { kind: 'snapshot', mtimeMs: read.data.mtimeMs, version: read.data.version },
        },
      ],
      signal: new AbortController().signal,
    }),
  ).rejects.toThrow()
  expect(await readFile(`${server.root}/sample.ts`, 'utf8')).toBe('original')
  expect(await readdir(server.workspaceEditJournalRoot)).toEqual([])
})

test('a lost prepare response aborts and releases the pending transaction', async ({ server }) => {
  await writeFile(`${server.root}/sample.ts`, 'original')
  const client = createEnvironmentClient({
    origin: server.origin,
    headers: () => ({ origin: server.clientOrigin }),
    fetcher: loseNextWorkspaceEditResponse(server, '/fs/workspace-edit/prepare'),
  })
  const read = await client.fs.read.get({ query: { path: 'sample.ts' } })
  if (!read.data) return expect.unreachable('Expected readable file')
  await expect(
    commitWorkspaceEdits({
      client,
      rootPath: '',
      operations: [
        {
          kind: 'write',
          index: 0,
          path: 'sample.ts',
          text: 'edited',
          expected: { kind: 'snapshot', mtimeMs: read.data.mtimeMs, version: read.data.version },
        },
      ],
      signal: new AbortController().signal,
    }),
  ).rejects.toThrow()
  expect(await readFile(`${server.root}/sample.ts`, 'utf8')).toBe('original')
  expect(await readdir(server.workspaceEditJournalRoot)).toEqual([])
})

test('a released rollback overrides an earlier commit acknowledgement and preserves the draft', async ({
  server,
}) => {
  await writeFile(`${server.root}/sample.ts`, 'original')
  const client = createEnvironmentClient({
    origin: server.origin,
    headers: () => ({ origin: server.clientOrigin }),
    fetcher: rollbackBeforeFinalize(server),
  })
  const session = createTestSettingsSession(server, { client })
  await session.refresh()
  const document = createViewerDocument({
    session,
    rootPath: '',
    path: 'sample.ts',
    editText: async () => 'edited',
  })
  try {
    await document.open()
    await document.edit()
    expect(await readFile(`${server.root}/sample.ts`, 'utf8')).toBe('original')
    expect(document.getSnapshot()).toMatchObject({
      draft: { text: 'edited' },
      error: expect.stringContaining('Draft kept'),
    })
    expect(await readdir(server.workspaceEditJournalRoot)).toEqual([])
  } finally {
    document.dispose()
    session.dispose()
  }
})
