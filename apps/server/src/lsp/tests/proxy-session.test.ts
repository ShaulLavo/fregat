import { EventEmitter } from 'node:events'
import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { PassThrough } from 'node:stream'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ChildProcessWithoutNullStreams } from 'node:child_process'

import type { LspServerHandle, LspServerMatch } from '../registry'
import { encodeLspStdioMessage, LspStdioMessageReader } from '../stdio-rpc'
import { LspSessionPool } from '../proxy-session'
import { closeApp, createApp } from '../../app'
import { createMetadataDatabase } from '../../db/client'
import { testSettingsOptions } from '../../settings/testing'
import { createWorkspacePaths } from '../../fs/path'
import { treeWatchSource, type TreeWatchSource } from '../../fs/tree-watch'
import { FileChangeHub } from '../../fs/watch'
import { fileUriForPath } from '../language'

const databases: { close: () => void }[] = []
const pools: LspSessionPool[] = []
const roots: string[] = []
const hubs: FileChangeHub[] = []

it('review: kills the child after a framing allocation failure', async () => {
  const fixture = await lspFixture()
  await fixture.pool.acquire(fixture.firstSocket, fixture.match, '')
  const bytes = Buffer.from('Content-Length: 1\r\n\r\nx')
  const allocation = vi.spyOn(Buffer, 'allocUnsafe').mockImplementationOnce(() => {
    throw new RangeError('review: allocation failed')
  })
  try {
    fixture.process.stdout.emit('data', bytes)
  } finally {
    allocation.mockRestore()
  }

  expect(fixture.firstSocket.closed).toBe(true)
  fixture.pool.disposeAll()
  expect(fixture.kill).toHaveBeenCalledTimes(1)
})

afterEach(async () => {
  for (const pool of pools.splice(0)) pool.disposeAll()
  // Same reason `appCleanup` closes the settings store: an unclosed SQLite
  // handle per app the file builds is a leaked native handle per test run.
  for (const database of databases.splice(0)) database.close()
  await Promise.all(hubs.splice(0).map((hub) => hub.close()))
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('LspSessionPool pooling', () => {
  it('replays diagnostics when another browser opens the same document', async () => {
    const fixture = await initializedFixture()
    const uri = 'file:///repo/a.ts'
    const text = 'const value = missing'
    await fixture.first.handleClientMessage(json(didOpen(uri, text, 40)))
    const diagnostics = {
      jsonrpc: '2.0',
      method: 'textDocument/publishDiagnostics',
      params: {
        uri,
        version: 40,
        diagnostics: [{ message: 'Cannot find name missing', severity: 1 }],
      },
    }
    fixture.respond(diagnostics)
    fixture.secondSocket.sent.length = 0
    await fixture.second.handleClientMessage(json(initializeRequest(2)))
    await fixture.second.handleClientMessage(json(didOpen(uri, text, 0)))

    expect(fixture.secondSocket.sent.at(-1)).toEqual({
      ...diagnostics,
      params: { uri, diagnostics: diagnostics.params.diagnostics },
    })
    expect(
      fixture.serverMessages.filter((message) => message.method === 'textDocument/didOpen'),
    ).toHaveLength(1)

    fixture.respond({ ...diagnostics, params: { uri, version: 40, diagnostics: [] } })
    await fixture.second.handleClientMessage(json(didClose(uri)))
    await fixture.second.handleClientMessage(json(didOpen(uri, text, 1)))
    expect(fixture.secondSocket.sent.at(-1)).toEqual({
      ...diagnostics,
      params: { uri, diagnostics: [] },
    })
  })

  it('replays the newest result when a dependency changed and the text did not', async () => {
    const fixture = await initializedFixture()
    const uri = 'file:///repo/a.ts'
    await fixture.first.handleClientMessage(json(didOpen(uri, 'import { v } from "./dep"', 40)))
    const publish = (message: string) =>
      fixture.respond({
        jsonrpc: '2.0',
        method: 'textDocument/publishDiagnostics',
        params: { uri, version: 40, diagnostics: [{ message, severity: 1 }] },
      })
    publish('Before the dependency changed')
    publish('After the dependency changed')
    fixture.secondSocket.sent.length = 0
    await fixture.second.handleClientMessage(json(initializeRequest(2)))
    await fixture.second.handleClientMessage(json(didOpen(uri, 'import { v } from "./dep"', 0)))

    const published = () =>
      fixture.secondSocket.sent
        .filter((message) => message.method === 'textDocument/publishDiagnostics')
        .map((message) => (message.params as { diagnostics: { message: string }[] }).diagnostics)
    expect(published()).toEqual([[{ message: 'After the dependency changed', severity: 1 }]])

    // A publication that lands after the join reaches the joined browser like any other.
    publish('Later still')
    await waitFor(() => published().length === 2, 'the late publication was not forwarded')
    expect(published().at(-1)).toEqual([{ message: 'Later still', severity: 1 }])
  })

  it.each(['change', 'open', 'close', 'old-version'])(
    'does not replay diagnostics after %s invalidates their document',
    async (invalidation) => {
      const fixture = await initializedFixture()
      const uri = 'file:///repo/a.ts'
      await fixture.first.handleClientMessage(json(didOpen(uri, 'old', 40)))
      const publication = {
        jsonrpc: '2.0',
        method: 'textDocument/publishDiagnostics',
        params: { uri, version: 40, diagnostics: [{ message: 'Old error', severity: 1 }] },
      }
      fixture.respond(publication)
      if (invalidation === 'change' || invalidation === 'old-version')
        await fixture.first.handleClientMessage(json(didChange(uri, 41, [{ text: 'new' }])))
      if (invalidation === 'old-version') fixture.respond(publication)
      if (invalidation === 'close') await fixture.first.handleClientMessage(json(didClose(uri)))
      fixture.secondSocket.sent.length = 0
      await fixture.second.handleClientMessage(json(initializeRequest(2)))
      await fixture.second.handleClientMessage(json(didOpen(uri, 'new', 0)))
      expect(
        fixture.secondSocket.sent.filter(
          (message) => message.method === 'textDocument/publishDiagnostics',
        ),
      ).toEqual([])
    },
  )

  it('initializes the spawned runtime with machine settings taking precedence', async () => {
    const fixture = await lspFixture(
      { initializationOptions: async () => ({ preference: 'machine' }) },
      {
        tsserver: { path: '/workspace/node_modules/typescript/lib/tsserver.js' },
        preference: 'runtime',
      },
    )
    const session = await fixture.pool.acquire(fixture.firstSocket, fixture.match, '')
    expect(session).not.toBeNull()
    if (!session) return

    const initializing = session.handleClientMessage(
      json(initializeRequest(1, { initializationOptions: { preference: 'client', locale: 'en' } })),
    )
    await fixture.waitForServerMessageCount(1)
    expect(fixture.initializeMessages()[0]).toMatchObject({
      params: {
        initializationOptions: {
          locale: 'en',
          preference: 'machine',
          tsserver: { path: '/workspace/node_modules/typescript/lib/tsserver.js' },
        },
      },
    })
    fixture.respond({
      id: fixture.serverMessages[0].id,
      jsonrpc: '2.0',
      result: initializeResult(),
    })
    await initializing
  })

  it('reuses one backend process and synthesizes later initialize responses', async () => {
    const fixture = await lspFixture()
    const first = await fixture.pool.acquire(fixture.firstSocket, fixture.match, '')
    const second = await fixture.pool.acquire(fixture.secondSocket, fixture.match, '')

    expect(fixture.spawn).toHaveBeenCalledTimes(1)
    expect(first).not.toBeNull()
    expect(second).not.toBeNull()

    const firstInitialize = first!.handleClientMessage(json(initializeRequest(1)))
    await fixture.waitForServerMessageCount(1)
    fixture.respond({
      id: fixture.serverMessages[0].id,
      jsonrpc: '2.0',
      result: initializeResult(),
    })
    await firstInitialize

    await second!.handleClientMessage(json(initializeRequest(2)))

    expect(fixture.initializeMessages()).toHaveLength(1)
    expect(fixture.firstSocket.sent[0]).toMatchObject({ id: 1, result: initializeResult() })
    expect(fixture.secondSocket.sent[0]).toMatchObject({ id: 2, result: initializeResult() })
  })

  it('routes pooled backend responses back to the originating socket', async () => {
    const fixture = await initializedFixture()
    await fixture.second!.handleClientMessage(json(initializeRequest(2)))

    await fixture.first!.handleClientMessage(json(hoverRequest(10, 'file:///repo/a.ts')))
    await fixture.second!.handleClientMessage(json(hoverRequest(10, 'file:///repo/b.ts')))
    const firstHover = fixture.serverMessages.at(-2)
    const secondHover = fixture.serverMessages.at(-1)
    if (!firstHover || !secondHover) throw new Error('expected hover requests')

    fixture.respond({ id: secondHover.id, jsonrpc: '2.0', result: hoverResult('second') })
    fixture.respond({ id: firstHover.id, jsonrpc: '2.0', result: hoverResult('first') })

    expect(fixture.firstSocket.sent.at(-1)).toMatchObject({
      id: 10,
      result: hoverResult('first'),
    })
    expect(fixture.secondSocket.sent.at(-1)).toMatchObject({
      id: 10,
      result: hoverResult('second'),
    })
  })

  it('opens a shared document once and closes it after the last owner disconnects', async () => {
    const fixture = await initializedFixture()
    await fixture.second!.handleClientMessage(json(initializeRequest(2)))

    const open = didOpen('file:///repo/a.ts', 'const value = 1')
    await fixture.first!.handleClientMessage(json(open))
    await fixture.second!.handleClientMessage(json(open))

    expect(
      fixture.serverMessages.filter((message) => message.method === 'textDocument/didOpen'),
    ).toHaveLength(1)

    await fixture.first!.handleClientMessage(json(didClose('file:///repo/a.ts')))
    expect(
      fixture.serverMessages.filter((message) => message.method === 'textDocument/didClose'),
    ).toHaveLength(0)

    await fixture.second!.handleClientMessage(json(didClose('file:///repo/a.ts')))
    expect(
      fixture.serverMessages.filter((message) => message.method === 'textDocument/didClose'),
    ).toHaveLength(1)
  })
})

describe('LspSessionPool WorkspaceEdit provenance', () => {
  const URI = 'file:///repo/a.ts'
  const OTHER_URI = 'file:///repo/b.ts'

  type InitializedFixture = Awaited<ReturnType<typeof initializedFixture>>

  function lastServerMethod(fixture: InitializedFixture, method: string) {
    const message = fixture.serverMessages.filter((entry) => entry.method === method).at(-1)
    if (!message) throw new Error(`expected ${method} request`)

    return message
  }

  async function sharedDocumentFixture(backendVersion = 40, browserVersion = 7, text = 'abc\n') {
    const fixture = await initializedFixture()
    await fixture.first.handleClientMessage(json(didOpen(URI, text, backendVersion)))
    await fixture.second.handleClientMessage(json(didOpen(URI, text, browserVersion)))
    return fixture
  }

  async function requestWorkspaceEdit(
    fixture: InitializedFixture,
    connection: InitializedFixture['first'],
    id: number,
    method: string,
  ) {
    await connection.handleClientMessage(json(workspaceEditRequest(id, method, URI)))
    return lastServerMethod(fixture, method)
  }

  it('rewrites a rename WorkspaceEdit backend version to the originating browser version', async () => {
    const fixture = await sharedDocumentFixture()
    const request = await requestWorkspaceEdit(fixture, fixture.second, 10, 'textDocument/rename')

    fixture.respond({
      id: request.id,
      jsonrpc: '2.0',
      result: workspaceEdit(textDocumentEdit(URI, 40)),
    })

    expect(fixture.secondSocket.sent.at(-1)).toEqual({
      id: 10,
      jsonrpc: '2.0',
      result: workspaceEdit(textDocumentEdit(URI, 7)),
    })
  })

  it('rewrites code-action edits and preserves unopened null versions', async () => {
    const fixture = await sharedDocumentFixture()
    const request = await requestWorkspaceEdit(
      fixture,
      fixture.second,
      11,
      'textDocument/codeAction',
    )

    fixture.respond({
      id: request.id,
      jsonrpc: '2.0',
      result: [
        {
          edit: workspaceEdit(
            textDocumentEdit(URI, 40, 'owned'),
            textDocumentEdit(OTHER_URI, null, 'unopened'),
          ),
          title: 'Fix both',
        },
      ],
    })

    expect(fixture.secondSocket.sent.at(-1)).toEqual({
      id: 11,
      jsonrpc: '2.0',
      result: [
        {
          edit: workspaceEdit(
            textDocumentEdit(URI, 7, 'owned'),
            textDocumentEdit(OTHER_URI, null, 'unopened'),
          ),
          title: 'Fix both',
        },
      ],
    })
  })

  it('rejects a versioned target not owned by the requesting connection', async () => {
    const fixture = await initializedFixture()
    await fixture.first.handleClientMessage(json(didOpen(URI, 'abc\n', 40)))
    const request = await requestWorkspaceEdit(fixture, fixture.second, 12, 'textDocument/rename')

    fixture.respond({
      id: request.id,
      jsonrpc: '2.0',
      result: workspaceEdit(textDocumentEdit(URI, 40)),
    })

    expect(fixture.secondSocket.sent.at(-1)).toMatchObject({
      error: { code: -32801, message: 'Content modified' },
      id: 12,
    })
  })

  it('rejects a response after backend or browser document drift', async () => {
    const backendDrift = await sharedDocumentFixture()
    const backendRequest = await requestWorkspaceEdit(
      backendDrift,
      backendDrift.second,
      13,
      'textDocument/rename',
    )
    await backendDrift.second.handleClientMessage(json(didChange(URI, 8, [{ text: 'changed\n' }])))
    backendDrift.respond({
      id: backendRequest.id,
      jsonrpc: '2.0',
      result: workspaceEdit(textDocumentEdit(URI, 41)),
    })

    expect(backendDrift.secondSocket.sent.at(-1)).toMatchObject({
      error: { code: -32801 },
      id: 13,
    })

    const browserDrift = await sharedDocumentFixture()
    const browserRequest = await requestWorkspaceEdit(
      browserDrift,
      browserDrift.second,
      14,
      'textDocument/rename',
    )
    await browserDrift.second.handleClientMessage(json(didClose(URI)))
    await browserDrift.second.handleClientMessage(json(didOpen(URI, 'abc\n', 9)))
    browserDrift.respond({
      id: browserRequest.id,
      jsonrpc: '2.0',
      result: workspaceEdit(textDocumentEdit(URI, 40)),
    })

    expect(browserDrift.secondSocket.sent.at(-1)).toMatchObject({
      error: { code: -32801 },
      id: 14,
    })
  })

  it('rejects two owners with divergent text before the request', async () => {
    const fixture = await initializedFixture()
    await fixture.first.handleClientMessage(json(didOpen(URI, 'abc\n', 40)))
    await fixture.second.handleClientMessage(json(didOpen(URI, 'axbc\n', 7)))
    const request = await requestWorkspaceEdit(fixture, fixture.first, 15, 'textDocument/rename')

    fixture.respond({
      id: request.id,
      jsonrpc: '2.0',
      result: workspaceEdit(textDocumentEdit(URI, 41)),
    })

    expect(fixture.firstSocket.sent.at(-1)).toMatchObject({ error: { code: -32801 }, id: 15 })
  })

  it('rejects other-owner replacement after the request even when requester still owns the URI', async () => {
    const fixture = await sharedDocumentFixture()
    const request = await requestWorkspaceEdit(fixture, fixture.first, 16, 'textDocument/rename')
    await fixture.second.handleClientMessage(json(didChange(URI, 8, [{ text: 'other\n' }])))
    fixture.respond({
      id: request.id,
      jsonrpc: '2.0',
      result: workspaceEdit(textDocumentEdit(URI, 41)),
    })

    expect(fixture.firstSocket.sent.at(-1)).toMatchObject({ error: { code: -32801 }, id: 16 })
  })

  it('applies divergent owner incremental ranges to owner text then forwards one safe full replacement', async () => {
    const fixture = await initializedFixture()
    await fixture.first.handleClientMessage(json(didOpen(URI, 'abc\n', 40)))
    await fixture.second.handleClientMessage(json(didOpen(URI, 'axbc\n', 7)))
    await fixture.first.handleClientMessage(
      json(
        didChange(URI, 43, [
          {
            range: {
              end: { character: 1, line: 0 },
              start: { character: 1, line: 0 },
            },
            text: 'X',
          },
        ]),
      ),
    )

    const forwarded = lastServerMethod(fixture, 'textDocument/didChange')
    expect(forwarded.params).toEqual({
      contentChanges: [{ text: 'aXbc\n' }],
      textDocument: { uri: URI, version: 44 },
    })

    const firstRequest = await requestWorkspaceEdit(
      fixture,
      fixture.first,
      17,
      'textDocument/rename',
    )
    fixture.respond({
      id: firstRequest.id,
      jsonrpc: '2.0',
      result: workspaceEdit(textDocumentEdit(URI, 44)),
    })
    expect(fixture.firstSocket.sent.at(-1)).toMatchObject({
      id: 17,
      result: workspaceEdit(textDocumentEdit(URI, 43)),
    })

    const staleRequest = await requestWorkspaceEdit(
      fixture,
      fixture.second,
      18,
      'textDocument/rename',
    )
    fixture.respond({
      id: staleRequest.id,
      jsonrpc: '2.0',
      result: workspaceEdit(textDocumentEdit(URI, 44)),
    })
    expect(fixture.secondSocket.sent.at(-1)).toMatchObject({ error: { code: -32801 }, id: 18 })
  })

  it("never applies a stale owner incremental range to another owner's backend text", async () => {
    const fixture = await initializedFixture()
    await fixture.first.handleClientMessage(json(didOpen(URI, 'cat\n', 20)))
    await fixture.second.handleClientMessage(json(didOpen(URI, 'cart\n', 3)))
    await fixture.first.handleClientMessage(
      json(
        didChange(URI, 21, [
          {
            range: {
              end: { character: 2, line: 0 },
              start: { character: 1, line: 0 },
            },
            text: 'O',
          },
        ]),
      ),
    )

    expect(lastServerMethod(fixture, 'textDocument/didChange').params).toEqual({
      contentChanges: [{ text: 'cOt\n' }],
      textDocument: { uri: URI, version: 22 },
    })
  })

  it('closes a non-monotonic or invalid-range owner without backend mutation', async () => {
    const nonMonotonic = await sharedDocumentFixture()
    const nonMonotonicCount = nonMonotonic.serverMessages.filter(
      (message) => message.method === 'textDocument/didChange',
    ).length
    await nonMonotonic.second.handleClientMessage(json(didChange(URI, 7, [{ text: 'bad\n' }])))

    expect(nonMonotonic.secondSocket.closed).toBe(true)
    expect(
      nonMonotonic.serverMessages.filter((message) => message.method === 'textDocument/didChange'),
    ).toHaveLength(nonMonotonicCount)

    const invalidRange = await sharedDocumentFixture()
    const invalidRangeCount = invalidRange.serverMessages.filter(
      (message) => message.method === 'textDocument/didChange',
    ).length
    await invalidRange.second.handleClientMessage(
      json(
        didChange(URI, 8, [
          {
            range: {
              end: { character: 5, line: 0 },
              start: { character: 4, line: 0 },
            },
            text: 'bad',
          },
        ]),
      ),
    )

    expect(invalidRange.secondSocket.closed).toBe(true)
    expect(
      invalidRange.serverMessages.filter((message) => message.method === 'textDocument/didChange'),
    ).toHaveLength(invalidRangeCount)
  })

  it('preserves a positive multi-step client version delta in one collapsed backend didChange', async () => {
    const fixture = await sharedDocumentFixture()
    await fixture.second.handleClientMessage(json(didChange(URI, 10, [{ text: 'next\n' }])))

    expect(lastServerMethod(fixture, 'textDocument/didChange').params).toEqual({
      contentChanges: [{ text: 'next\n' }],
      textDocument: { uri: URI, version: 43 },
    })
  })

  it('maps skipped and nonzero browser versions without equating them to backend counters', async () => {
    const fixture = await sharedDocumentFixture(100, 7)
    const request = await requestWorkspaceEdit(fixture, fixture.second, 19, 'textDocument/rename')
    fixture.respond({
      id: request.id,
      jsonrpc: '2.0',
      result: workspaceEdit(textDocumentEdit(URI, 102)),
    })

    expect(fixture.secondSocket.sent.at(-1)).toMatchObject({
      id: 19,
      result: workspaceEdit(textDocumentEdit(URI, 9)),
    })
  })

  it('maps repeated backend B then B-plus-one to browser C then C-plus-one', async () => {
    const fixture = await sharedDocumentFixture()
    const request = await requestWorkspaceEdit(fixture, fixture.second, 20, 'textDocument/rename')
    fixture.respond({
      id: request.id,
      jsonrpc: '2.0',
      result: workspaceEdit(
        textDocumentEdit(URI, 40, 'first'),
        textDocumentEdit(URI, 41, 'second'),
      ),
    })

    expect(fixture.secondSocket.sent.at(-1)).toMatchObject({
      id: 20,
      result: workspaceEdit(textDocumentEdit(URI, 7, 'first'), textDocumentEdit(URI, 8, 'second')),
    })
  })

  it('preserves repeated backend B then B for Editor no-op or mismatch validation', async () => {
    const fixture = await sharedDocumentFixture()
    const request = await requestWorkspaceEdit(fixture, fixture.second, 21, 'textDocument/rename')
    fixture.respond({
      id: request.id,
      jsonrpc: '2.0',
      result: workspaceEdit(
        textDocumentEdit(URI, 40, 'first'),
        textDocumentEdit(URI, 40, 'second'),
      ),
    })

    expect(fixture.secondSocket.sent.at(-1)).toMatchObject({
      id: 21,
      result: workspaceEdit(textDocumentEdit(URI, 7, 'first'), textDocumentEdit(URI, 7, 'second')),
    })
  })

  it('preserves null and maps the following numeric version by backend delta not array position', async () => {
    const fixture = await sharedDocumentFixture()
    const request = await requestWorkspaceEdit(fixture, fixture.second, 22, 'textDocument/rename')
    fixture.respond({
      id: request.id,
      jsonrpc: '2.0',
      result: workspaceEdit(
        textDocumentEdit(URI, null, 'unversioned'),
        textDocumentEdit(URI, 41, 'versioned'),
      ),
    })

    expect(fixture.secondSocket.sent.at(-1)).toMatchObject({
      id: 22,
      result: workspaceEdit(
        textDocumentEdit(URI, null, 'unversioned'),
        textDocumentEdit(URI, 8, 'versioned'),
      ),
    })
  })

  it('rejects affine version underflow and overflow without rewriting the response', async () => {
    const underflow = await sharedDocumentFixture(40, 100)
    const underflowRequest = await requestWorkspaceEdit(
      underflow,
      underflow.second,
      23,
      'textDocument/rename',
    )
    const underflowEdit = workspaceEdit(textDocumentEdit(URI, 39))
    underflow.respond({
      id: underflowRequest.id,
      jsonrpc: '2.0',
      result: underflowEdit,
    })
    expect(underflow.secondSocket.sent.at(-1)).toMatchObject({
      error: { code: -32801 },
      id: 23,
    })
    expect(underflowEdit).toEqual(workspaceEdit(textDocumentEdit(URI, 39)))

    const overflow = await sharedDocumentFixture(0, Number.MAX_SAFE_INTEGER)
    const overflowRequest = await requestWorkspaceEdit(
      overflow,
      overflow.second,
      24,
      'textDocument/rename',
    )
    const overflowEdit = workspaceEdit(textDocumentEdit(URI, 1))
    overflow.respond({
      id: overflowRequest.id,
      jsonrpc: '2.0',
      result: overflowEdit,
    })
    expect(overflow.secondSocket.sent.at(-1)).toMatchObject({
      error: { code: -32801 },
      id: 24,
    })
    expect(overflowEdit).toEqual(workspaceEdit(textDocumentEdit(URI, 1)))
  })

  it('maps codeAction resolve and every WorkspaceEdit in a multi-action response', async () => {
    const fixture = await sharedDocumentFixture()
    const listRequest = await requestWorkspaceEdit(
      fixture,
      fixture.second,
      25,
      'textDocument/codeAction',
    )
    fixture.respond({
      id: listRequest.id,
      jsonrpc: '2.0',
      result: [
        { edit: workspaceEdit(textDocumentEdit(URI, 40, 'one')), title: 'One' },
        { edit: workspaceEdit(textDocumentEdit(URI, 41, 'two')), title: 'Two' },
        { command: { command: 'noop', title: 'No edit' }, title: 'Command' },
      ],
    })

    expect(fixture.secondSocket.sent.at(-1)).toMatchObject({
      id: 25,
      result: [
        { edit: workspaceEdit(textDocumentEdit(URI, 7, 'one')), title: 'One' },
        { edit: workspaceEdit(textDocumentEdit(URI, 8, 'two')), title: 'Two' },
        { command: { command: 'noop', title: 'No edit' }, title: 'Command' },
      ],
    })

    const resolveRequest = await requestWorkspaceEdit(
      fixture,
      fixture.second,
      26,
      'codeAction/resolve',
    )
    fixture.respond({
      id: resolveRequest.id,
      jsonrpc: '2.0',
      result: { edit: workspaceEdit(textDocumentEdit(URI, 40, 'resolved')), title: 'Resolve' },
    })

    expect(fixture.secondSocket.sent.at(-1)).toMatchObject({
      id: 26,
      result: { edit: workspaceEdit(textDocumentEdit(URI, 7, 'resolved')), title: 'Resolve' },
    })
  })

  it('preserves legacy changes as unversioned', async () => {
    const fixture = await sharedDocumentFixture()
    const request = await requestWorkspaceEdit(fixture, fixture.second, 27, 'textDocument/rename')
    const result = {
      changeAnnotations: { rename: { label: 'Rename' } },
      changes: { [URI]: textDocumentEdit(URI, null).edits },
    }
    fixture.respond({ id: request.id, jsonrpc: '2.0', result })

    expect(fixture.secondSocket.sent.at(-1)).toEqual({ id: 27, jsonrpc: '2.0', result })
  })

  it('does not rewrite unrelated numeric fields', async () => {
    const fixture = await sharedDocumentFixture()
    const request = await requestWorkspaceEdit(fixture, fixture.second, 28, 'textDocument/rename')
    fixture.respond({
      id: request.id,
      jsonrpc: '2.0',
      result: {
        changeAnnotations: { rename: { customVersion: 999, label: 'Rename' } },
        documentChanges: [
          {
            ...textDocumentEdit(URI, 40),
            customVersion: 123,
            edits: [
              {
                newText: 'next',
                range: {
                  end: { character: 11, line: 12 },
                  start: { character: 9, line: 10 },
                },
              },
            ],
          },
        ],
      },
    })

    expect(fixture.secondSocket.sent.at(-1)).toMatchObject({
      id: 28,
      result: {
        changeAnnotations: { rename: { customVersion: 999 } },
        documentChanges: [
          {
            customVersion: 123,
            edits: [
              {
                range: {
                  end: { character: 11, line: 12 },
                  start: { character: 9, line: 10 },
                },
              },
            ],
            textDocument: { version: 7 },
          },
        ],
      },
    })
  })

  it('normal-first and diff-first owners negotiate the same backend capability fingerprint', async () => {
    const capabilities = {
      workspace: {
        workspaceEdit: {
          changeAnnotationSupport: { groupsOnLabel: true },
          documentChanges: true,
          resourceOperations: ['create', 'rename', 'delete'],
        },
      },
    }

    for (const roots of [
      ['', 'diff:session-one'],
      ['diff:session-two', ''],
    ] as const) {
      const fixture = await lspFixture()
      const first = await fixture.pool.acquire(fixture.firstSocket, fixture.match, roots[0])
      const second = await fixture.pool.acquire(fixture.secondSocket, fixture.match, roots[1])
      if (!first || !second) throw new Error('expected pooled LSP sessions')

      const firstInitialize = first.handleClientMessage(
        json(initializeRequest(30, { capabilities })),
      )
      await fixture.waitForServerMessageCount(1)
      const secondInitialize = second.handleClientMessage(
        json(initializeRequest(31, { capabilities })),
      )
      await Bun.sleep(1)

      expect(fixture.initializeMessages()).toHaveLength(1)
      expect(fixture.initializeMessages()[0]?.params).toMatchObject({ capabilities })

      fixture.respond({
        id: fixture.initializeMessages()[0]?.id,
        jsonrpc: '2.0',
        result: initializeResult(),
      })
      await Promise.all([firstInitialize, secondInitialize])
      expect(fixture.firstSocket.sent.at(-1)).toMatchObject({ id: 30 })
      expect(fixture.secondSocket.sent.at(-1)).toMatchObject({ id: 31 })
    }
  })

  it('replays one initialize for equal normalized params while pending and after settlement', async () => {
    const fixture = await lspFixture()
    const thirdSocket = new FakeSocket()
    const first = await fixture.pool.acquire(fixture.firstSocket, fixture.match, '')
    const second = await fixture.pool.acquire(fixture.secondSocket, fixture.match, 'diff:one')
    const third = await fixture.pool.acquire(thirdSocket, fixture.match, 'diff:two')
    if (!first || !second || !third) throw new Error('expected pooled LSP sessions')

    const firstInitialize = first.handleClientMessage(json(initializeRequest(32)))
    await fixture.waitForServerMessageCount(1)
    const secondInitialize = second.handleClientMessage(json(initializeRequest(33)))
    await Bun.sleep(1)
    expect(fixture.initializeMessages()).toHaveLength(1)

    fixture.respond({
      id: fixture.initializeMessages()[0]?.id,
      jsonrpc: '2.0',
      result: initializeResult(),
    })
    await Promise.all([firstInitialize, secondInitialize])
    await third.handleClientMessage(json(initializeRequest(34)))

    expect(fixture.initializeMessages()).toHaveLength(1)
    expect(fixture.firstSocket.sent.at(-1)).toMatchObject({ id: 32 })
    expect(fixture.secondSocket.sent.at(-1)).toMatchObject({ id: 33 })
    expect(thirdSocket.sent.at(-1)).toMatchObject({ id: 34 })
  })

  it('accepts equal initialize params with different object key order', async () => {
    const fixture = await lspFixture()
    const first = await fixture.pool.acquire(fixture.firstSocket, fixture.match, '')
    const second = await fixture.pool.acquire(fixture.secondSocket, fixture.match, '')
    if (!first || !second) throw new Error('expected pooled LSP sessions')

    const firstInitialize = first.handleClientMessage(
      json(
        initializeRequest(35, {
          capabilities: { textDocument: { rename: { prepareSupport: true } }, workspace: {} },
          clientInfo: { name: 'Platform', version: '1' },
        }),
      ),
    )
    await fixture.waitForServerMessageCount(1)
    const secondInitialize = second.handleClientMessage(
      json(
        initializeRequest(36, {
          clientInfo: { version: '1', name: 'Platform' },
          capabilities: { workspace: {}, textDocument: { rename: { prepareSupport: true } } },
        }),
      ),
    )
    await Bun.sleep(1)
    expect(fixture.initializeMessages()).toHaveLength(1)

    fixture.respond({
      id: fixture.initializeMessages()[0]?.id,
      jsonrpc: '2.0',
      result: initializeResult(),
    })
    await Promise.all([firstInitialize, secondInitialize])
    expect(fixture.secondSocket.closed).toBe(false)
    expect(fixture.secondSocket.sent.at(-1)).toMatchObject({ id: 36 })
  })

  it('rejects a capability mismatch while first initialize is pending without forwarding it', async () => {
    const fixture = await lspFixture()
    const first = await fixture.pool.acquire(fixture.firstSocket, fixture.match, '')
    const second = await fixture.pool.acquire(fixture.secondSocket, fixture.match, '')
    if (!first || !second) throw new Error('expected pooled LSP sessions')

    const firstInitialize = first.handleClientMessage(
      json(initializeRequest(37, { capabilities: { workspace: { applyEdit: false } } })),
    )
    await fixture.waitForServerMessageCount(1)
    await second.handleClientMessage(
      json(initializeRequest(38, { capabilities: { workspace: { applyEdit: true } } })),
    )

    expect(fixture.initializeMessages()).toHaveLength(1)
    expect(fixture.secondSocket.sent.at(-1)).toEqual({
      error: {
        code: -32602,
        message: 'Initialize params do not match the pooled backend contract',
      },
      id: 38,
      jsonrpc: '2.0',
    })
    expect(fixture.secondSocket.closed).toBe(true)

    fixture.respond({
      id: fixture.initializeMessages()[0]?.id,
      jsonrpc: '2.0',
      result: initializeResult(),
    })
    await firstInitialize
    await first.handleClientMessage(json(hoverRequest(39, URI)))
    const hover = lastServerMethod({ ...fixture, first, second }, 'textDocument/hover')
    fixture.respond({ id: hover.id, jsonrpc: '2.0', result: hoverResult('still alive') })
    expect(fixture.firstSocket.sent.at(-1)).toMatchObject({
      id: 39,
      result: hoverResult('still alive'),
    })
  })

  it('rejects later initializationOptions mismatch with original client ID and closes only that owner', async () => {
    const fixture = await lspFixture()
    const first = await fixture.pool.acquire(fixture.firstSocket, fixture.match, '')
    const second = await fixture.pool.acquire(fixture.secondSocket, fixture.match, '')
    if (!first || !second) throw new Error('expected pooled LSP sessions')

    const initialized = first.handleClientMessage(
      json(initializeRequest(40, { initializationOptions: { mode: 'normal' } })),
    )
    await fixture.waitForServerMessageCount(1)
    fixture.respond({
      id: fixture.initializeMessages()[0]?.id,
      jsonrpc: '2.0',
      result: initializeResult(),
    })
    await initialized

    await second.handleClientMessage(
      json(initializeRequest(409, { initializationOptions: { mode: 'diff' } })),
    )
    expect(fixture.secondSocket.sent.at(-1)).toMatchObject({
      error: { code: -32602 },
      id: 409,
    })
    expect(fixture.secondSocket.closed).toBe(true)
    expect(fixture.firstSocket.closed).toBe(false)
    expect(fixture.initializeMessages()).toHaveLength(1)

    await first.handleClientMessage(json(hoverRequest(41, URI)))
    const hover = fixture.serverMessages
      .filter((message) => message.method === 'textDocument/hover')
      .at(-1)
    if (!hover) throw new Error('expected hover request')
    fixture.respond({ id: hover.id, jsonrpc: '2.0', result: hoverResult('first survives') })
    expect(fixture.firstSocket.sent.at(-1)).toMatchObject({ id: 41 })
  })

  it('does not create a pending initialize after the backend exits during normalization', async () => {
    let optionsStarted = false
    let releaseOptions = () => {}
    const optionsGate = new Promise<void>((resolve) => {
      releaseOptions = resolve
    })
    const fixture = await lspFixture({
      initializationOptions: async () => {
        optionsStarted = true
        await optionsGate
        return { mode: 'normal' }
      },
    })
    const first = await fixture.pool.acquire(fixture.firstSocket, fixture.match, '')
    if (!first) throw new Error('expected pooled LSP session')

    const initializing = first.handleClientMessage(json(initializeRequest(401)))
    await waitFor(() => optionsStarted, 'expected initialize normalization to start')
    fixture.process.process.emit('exit', 3, null)
    releaseOptions()
    await initializing

    expect(fixture.initializeMessages()).toEqual([])
    expect(fixture.pool.size).toBe(0)
    expect(fixture.firstSocket.closed).toBe(true)
  })

  it('preserves an existing server error and clears provenance on every terminal path', async () => {
    const serverError = await sharedDocumentFixture()
    const request = await requestWorkspaceEdit(
      serverError,
      serverError.second,
      42,
      'textDocument/rename',
    )
    await serverError.first.handleClientMessage(json(didChange(URI, 41, [{ text: 'drift\n' }])))
    const error = { code: -32001, data: { retry: 2 }, message: 'rename failed' }
    serverError.respond({ error, id: request.id, jsonrpc: '2.0' })
    expect(serverError.secondSocket.sent.at(-1)).toEqual({ error, id: 42, jsonrpc: '2.0' })

    const cancelled = await sharedDocumentFixture()
    const cancelledRequest = await requestWorkspaceEdit(
      cancelled,
      cancelled.second,
      43,
      'textDocument/rename',
    )
    await cancelled.second.handleClientMessage(
      json({ jsonrpc: '2.0', method: '$/cancelRequest', params: { id: 43 } }),
    )
    await cancelled.first.handleClientMessage(json(didChange(URI, 41, [{ text: 'drift\n' }])))
    cancelled.respond({
      error: { code: -32800, message: 'request cancelled' },
      id: cancelledRequest.id,
      jsonrpc: '2.0',
    })
    expect(cancelled.secondSocket.sent.at(-1)).toEqual({
      error: { code: -32800, message: 'request cancelled' },
      id: 43,
      jsonrpc: '2.0',
    })
  })

  it('keeps cancellation routed to the original backend request', async () => {
    const fixture = await sharedDocumentFixture()
    const request = await requestWorkspaceEdit(fixture, fixture.second, 44, 'textDocument/rename')
    await fixture.second.handleClientMessage(
      json({ jsonrpc: '2.0', method: '$/cancelRequest', params: { id: 44 } }),
    )

    expect(lastServerMethod(fixture, '$/cancelRequest')).toEqual({
      jsonrpc: '2.0',
      method: '$/cancelRequest',
      params: { id: request.id },
    })

    fixture.respond({
      id: request.id,
      jsonrpc: '2.0',
      result: workspaceEdit(textDocumentEdit(URI, 40)),
    })
    expect(fixture.secondSocket.sent.at(-1)).toEqual({
      error: { code: -32801, message: 'Content modified' },
      id: 44,
      jsonrpc: '2.0',
    })
  })

  it('after a two-step edit forwards one collapsed didChange at backend B-plus-two and maps the next response to browser C-plus-two', async () => {
    const fixture = await sharedDocumentFixture()
    await fixture.second.handleClientMessage(json(didChange(URI, 9, [{ text: 'two steps\n' }])))
    expect(lastServerMethod(fixture, 'textDocument/didChange').params).toEqual({
      contentChanges: [{ text: 'two steps\n' }],
      textDocument: { uri: URI, version: 42 },
    })

    const request = await requestWorkspaceEdit(fixture, fixture.second, 45, 'textDocument/rename')
    fixture.respond({
      id: request.id,
      jsonrpc: '2.0',
      result: workspaceEdit(textDocumentEdit(URI, 42)),
    })
    expect(fixture.secondSocket.sent.at(-1)).toMatchObject({
      id: 45,
      result: workspaceEdit(textDocumentEdit(URI, 9)),
    })
  })

  it('rejects backend workspace/applyEdit with -32601 and its backend request ID without forwarding a request ID or invoking a browser host callback', async () => {
    const fixture = await initializedFixture()
    const firstBefore = fixture.firstSocket.sent.length
    const secondBefore = fixture.secondSocket.sent.length
    const serverBefore = fixture.serverMessages.length

    fixture.respond({
      id: 'server-apply',
      jsonrpc: '2.0',
      method: 'workspace/applyEdit',
      params: { edit: workspaceEdit(textDocumentEdit(URI, null)) },
    })
    await fixture.waitForServerMessageCount(serverBefore + 1)

    expect(fixture.serverMessages.at(-1)).toEqual({
      error: {
        code: -32601,
        message: 'Method not implemented: workspace/applyEdit',
      },
      id: 'server-apply',
      jsonrpc: '2.0',
    })
    expect(fixture.firstSocket.sent.slice(firstBefore)).toEqual([])
    expect(fixture.secondSocket.sent.slice(secondBefore)).toEqual([])
  })
})

describe('LspSessionPool ownership', () => {
  it('kills the backend and closes client sockets on disposeAll', async () => {
    const fixture = await lspFixture()
    await fixture.pool.acquire(fixture.firstSocket, fixture.match, '')
    await fixture.pool.acquire(fixture.secondSocket, fixture.match, '')

    fixture.pool.disposeAll()

    expect(fixture.kill).toHaveBeenCalledTimes(1)
    expect(fixture.pool.size).toBe(0)
    expect(fixture.firstSocket.closed).toBe(true)
    expect(fixture.secondSocket.closed).toBe(true)
  })

  // A framing failure leaves the child running, so it has to go through the
  // disposal path that kills one. `closeFromProcess` is for a process that already
  // exited: it never kills, and it removes the session from the pool first, so
  // `disposeAll` could not reap it afterwards either.
  it('kills the backend when framing throws, and leaves nothing for disposeAll', async () => {
    const fixture = await lspFixture()
    await fixture.pool.acquire(fixture.firstSocket, fixture.match, '')

    const allocUnsafe = vi.spyOn(Buffer, 'allocUnsafe').mockImplementationOnce(() => {
      throw new RangeError('Array buffer allocation failed')
    })
    try {
      fixture.process.stdout.write(encodeLspStdioMessage(JSON.stringify({ id: 99, result: null })))
      await waitFor(() => fixture.kill.mock.calls.length > 0, 'framing failure to kill the backend')
    } finally {
      allocUnsafe.mockRestore()
    }

    expect(fixture.kill).toHaveBeenCalledTimes(1)
    expect(fixture.pool.size).toBe(0)
    expect(fixture.firstSocket.closed).toBe(true)

    fixture.pool.disposeAll()
    expect(fixture.kill).toHaveBeenCalledTimes(1)
  })

  it('is idempotent — a second disposeAll kills nothing twice', async () => {
    const fixture = await lspFixture()
    await fixture.pool.acquire(fixture.firstSocket, fixture.match, '')

    fixture.pool.disposeAll()
    fixture.pool.disposeAll()

    expect(fixture.kill).toHaveBeenCalledTimes(1)
    expect(fixture.pool.size).toBe(0)
  })

  it('leaves an in-flight request unanswered and closes the socket instead', async () => {
    const fixture = await initializedFixture()
    await fixture.first.handleClientMessage(json(hoverRequest(10, 'file:///repo/a.ts')))

    fixture.pool.disposeAll()

    // By id rather than by message count: the close is no longer silent — it
    // carries a reason — so counting messages would now pass for a socket that
    // answered the hover and fail for one that only said why it was closing.
    expect(fixture.firstSocket.sent.filter((message) => message.id === 10)).toEqual([])
    expect(fixture.firstSocket.closed).toBe(true)
  })

  it('says why before closing a client socket', async () => {
    const fixture = await initializedFixture()

    fixture.pool.disposeAll()

    expect(fixture.firstSocket.sent.at(-1)).toMatchObject({
      method: '$/platform/serverExited',
      params: { outcome: 'app_shutdown', serverId: 'typescript' },
    })
    expect(fixture.secondSocket.sent.at(-1)).toMatchObject({
      method: '$/platform/serverExited',
      params: { outcome: 'app_shutdown' },
    })
  })

  it('says why when the backend dies on its own', async () => {
    const fixture = await initializedFixture()

    // Not `disposeAll` — that is this app shutting down. This is the language
    // server exiting underneath a live tab, which is the failure §7.1 is about:
    // the socket used to close bare and the status indicator kept reading
    // `ready` over a process that was gone.
    fixture.process.process.emit('exit', 3, null)

    expect(fixture.firstSocket.sent.at(-1)).toMatchObject({
      method: '$/platform/serverExited',
      params: {
        error: {
          code: 'lsp.SERVER_EXITED',
          message: 'The typescript language server stopped',
          fix: expect.any(String),
        },
        exitCode: 3,
        outcome: 'process_exit',
        serverId: 'typescript',
      },
    })
    expect(fixture.firstSocket.closed).toBe(true)
  })

  it('carries no error when this app closed a healthy backend', async () => {
    const fixture = await initializedFixture()

    fixture.pool.disposeAll()
    fixture.process.process.emit('exit', 0, null)

    const exit = fixture.firstSocket.sent.at(-1) as { params?: Record<string, unknown> }
    expect(exit.params).toMatchObject({ outcome: 'app_shutdown' })
    expect(exit.params?.error).toBeUndefined()
  })

  it('refuses to spawn a backend after disposeAll', async () => {
    const fixture = await lspFixture()
    fixture.pool.disposeAll()

    const session = await fixture.pool.acquire(fixture.firstSocket, fixture.match, '')

    expect(session).toBeNull()
    expect(fixture.spawn).not.toHaveBeenCalled()
  })

  it('kills a backend whose spawn lands after disposeAll', async () => {
    const fixture = await lspFixture()
    fixture.holdSpawn()
    const acquired = fixture.pool.acquire(fixture.firstSocket, fixture.match, '')

    fixture.pool.disposeAll()
    fixture.releaseSpawn()

    expect(await acquired).toBeNull()
    expect(fixture.kill).toHaveBeenCalledTimes(1)
    expect(fixture.pool.size).toBe(0)
  })

  // The negative case for step 1d. `disposeAll` shuts the pool for good, but a
  // backend that dies on its own must NOT shut the pool — it must be evicted so
  // the next client spawns a fresh one. Without this, tightening disposal could
  // silently wedge a live pool on the first language-server crash.
  it('evicts a backend that exits on its own and respawns for the next client', async () => {
    const fixture = await lspFixture()
    await fixture.pool.acquire(fixture.firstSocket, fixture.match, '')

    fixture.process.process.emit('exit', 0, null)

    expect(fixture.pool.size).toBe(0)
    expect(fixture.firstSocket.closed).toBe(true)

    const next = await fixture.pool.acquire(fixture.secondSocket, fixture.match, '')

    expect(next).not.toBeNull()
    expect(fixture.spawn).toHaveBeenCalledTimes(2)
    expect(fixture.pool.size).toBe(1)
  })

  it('closeApp disposes the pooled LSP sessions', async () => {
    const fixture = await lspFixture()
    const app = lspTestApp(await fixtureRoot('platform-lsp-app-'), fixture.pool)
    await fixture.pool.acquire(fixture.firstSocket, fixture.match, '')

    await closeApp(app)

    expect(fixture.kill).toHaveBeenCalledTimes(1)
    expect(fixture.pool.size).toBe(0)
  })
})

describe('LspSessionPool server requests', () => {
  it('pushes configured settings once after the initialized notification', async () => {
    const settings = {
      json: {
        jsonFoldingLimit: 5000,
        jsoncFoldingLimit: 5000,
        resultLimit: 5000,
        validate: { enable: true },
      },
    }
    const fixture = await initializedFixture({ didChangeConfiguration: settings })
    const initialized = { jsonrpc: '2.0', method: 'initialized', params: {} }

    await fixture.first.handleClientMessage(json(initialized))
    await fixture.second.handleClientMessage(json(initialized))

    expect(fixture.serverMessages.slice(1)).toEqual([
      initialized,
      {
        jsonrpc: '2.0',
        method: 'workspace/didChangeConfiguration',
        params: { settings },
      },
    ])
  })

  it('answers each configuration item by its own section', async () => {
    const fixture = await initializedFixture({
      configuration: () => ({ gopls: { semanticTokens: true }, other: { verbose: 1 } }),
    })

    fixture.respond({
      id: 'server-1',
      jsonrpc: '2.0',
      method: 'workspace/configuration',
      params: {
        items: [{ section: 'gopls' }, { section: 'other.verbose' }, { section: 'absent' }],
      },
    })
    await fixture.waitForServerMessageCount(2)

    // One value per item, in the order asked. The old blanket reply was a single
    // `[{}]` however many sections a server named, so a server asking for three
    // had to guess which one it got.
    expect(fixture.serverMessages.at(-1)).toMatchObject({ id: 'server-1' })
    expect((fixture.serverMessages.at(-1) as { result: unknown }).result).toEqual([
      { semanticTokens: true },
      1,
      {},
    ])
  })

  it('answers a configuration request that names no section with the whole tree', async () => {
    const fixture = await initializedFixture({
      configuration: () => ({ gopls: { semanticTokens: true } }),
    })

    fixture.respond({
      id: 'server-1',
      jsonrpc: '2.0',
      method: 'workspace/configuration',
      params: { items: [{}] },
    })
    await fixture.waitForServerMessageCount(2)

    expect(fixture.serverMessages.at(-1)).toMatchObject({
      id: 'server-1',
      result: [{ gopls: { semanticTokens: true } }],
    })
  })

  it('answers a server with no configuration entry the way it always did', async () => {
    const fixture = await initializedFixture()

    fixture.respond({
      id: 'server-1',
      jsonrpc: '2.0',
      method: 'workspace/configuration',
      params: { items: [{ section: 'anything' }] },
    })
    await fixture.waitForServerMessageCount(2)

    // `toEqual`, not `toMatchObject`: `{}` as an expected array element matches
    // *any* object, so a `toMatchObject` here would pass for a reply carrying a
    // whole settings tree — which is the exact regression this pins.
    expect(fixture.serverMessages.at(-1)).toMatchObject({ id: 'server-1' })
    expect((fixture.serverMessages.at(-1) as { result: unknown }).result).toEqual([{}])
  })

  it('downgrades a semantic-token refresh request into one notification per connection', async () => {
    const fixture = await initializedFixture()
    await fixture.second.handleClientMessage(json(initializeRequest(2)))
    const firstBefore = fixture.firstSocket.sent.length
    const secondBefore = fixture.secondSocket.sent.length

    fixture.respond({ id: 'server-1', jsonrpc: '2.0', method: 'workspace/semanticTokens/refresh' })
    await fixture.waitForServerMessageCount(2)

    // The proxy answers the server itself, because N pooled clients cannot
    // answer one request id.
    expect(fixture.serverMessages.at(-1)).toMatchObject({ id: 'server-1', result: null })

    const forEachConnection = [
      fixture.firstSocket.sent.slice(firstBefore),
      fixture.secondSocket.sent.slice(secondBefore),
    ]
    for (const sent of forEachConnection) {
      expect(sent).toHaveLength(1)
      expect(sent[0]).toEqual({ jsonrpc: '2.0', method: 'workspace/semanticTokens/refresh' })
      // No `id`: a notification draws no response, which is what keeps
      // `routeClientMessage`'s unremapped-response fall-through dead.
      expect(sent[0]).not.toHaveProperty('id')
    }
  })

  it('downgrades a diagnostic refresh request into one notification per connection', async () => {
    const fixture = await initializedFixture()
    await fixture.second.handleClientMessage(json(initializeRequest(2)))
    const firstBefore = fixture.firstSocket.sent.length
    const secondBefore = fixture.secondSocket.sent.length

    fixture.respond({ id: 'server-1', jsonrpc: '2.0', method: 'workspace/diagnostic/refresh' })
    await fixture.waitForServerMessageCount(2)

    expect(fixture.serverMessages.at(-1)).toMatchObject({ id: 'server-1', result: null })
    for (const sent of [
      fixture.firstSocket.sent.slice(firstBefore),
      fixture.secondSocket.sent.slice(secondBefore),
    ]) {
      expect(sent).toEqual([{ jsonrpc: '2.0', method: 'workspace/diagnostic/refresh' }])
    }
  })

  it('forwards no inbound server request to any connection', async () => {
    const fixture = await initializedFixture()
    await fixture.second.handleClientMessage(json(initializeRequest(2)))
    const before = fixture.firstSocket.sent.length

    for (const method of [
      'workspace/configuration',
      'workspace/workspaceFolders',
      'client/registerCapability',
      'window/workDoneProgress/create',
      'workspace/semanticTokens/refresh',
      'workspace/diagnostic/refresh',
      'window/showMessageRequest',
    ]) {
      fixture.respond({ id: `server-${method}`, jsonrpc: '2.0', method, params: {} })
    }
    await fixture.waitForServerMessageCount(2)

    // Every one of them is answered by the proxy. Anything that reached a
    // browser carrying an `id` would draw a response the proxy forwards to the
    // backend verbatim, with a client-space id the backend never issued.
    const withIds = fixture.firstSocket.sent.slice(before).filter((message) => 'id' in message)
    expect(withIds).toEqual([])
  })
})

describe('LspSessionPool watched files', () => {
  it('advertises watched files only when the pool can watch', async () => {
    const capability = 'params.capabilities.workspace.didChangeWatchedFiles'
    const unwatched = await initializedFixture()
    expect(unwatched.initializeMessages()[0]).not.toHaveProperty(capability)

    const watched = await initializedFixture({}, hubWatch)
    expect(watched.initializeMessages()[0]).toHaveProperty(capability, {
      dynamicRegistration: true,
      relativePatternSupport: true,
    })
  })

  it('answers a registration once its watch is attached and forwards matching changes', async () => {
    const fixture = await initializedFixture({}, hubWatch)
    const source = path.join(fixture.match.root, 'a.ts')
    await writeFile(source, 'export const a = 1\n')
    await writeFile(path.join(fixture.match.root, 'notes.md'), 'ignored\n')
    fixture.respond(watchRegistration('watch-1', `${fixture.match.root}/**/*.ts`))
    await expect
      .poll(() => fixture.serverResponse('watch-1'))
      .toEqual({
        id: 'watch-1',
        jsonrpc: '2.0',
        result: null,
      })
    expect(fixture.hub().info().nativeWatcherCount).toBe(1)

    await writeFile(path.join(fixture.match.root, 'notes.md'), 'still ignored\n')
    await writeFile(source, 'export const a = 2\n')
    await expect
      .poll(() => fixture.watchedChanges(), { timeout: 3000 })
      .toEqual([{ uri: fileUriForPath(source), type: 2 }])

    // Watches belong to the backend: another browser joining it adds none.
    await fixture.second.handleClientMessage(json(initializeRequest(2)))
    expect(fixture.hub().info().nativeWatcherCount).toBe(1)
  })

  it('reports a registration it cannot honour instead of acknowledging it', async () => {
    const fixture = await initializedFixture({}, hubWatch)
    fixture.respond({
      id: 'watch-bad',
      jsonrpc: '2.0',
      method: 'client/registerCapability',
      params: {
        registrations: [
          { id: 'bad', method: 'workspace/didChangeWatchedFiles', registerOptions: {} },
        ],
      },
    })

    await expect
      .poll(() => fixture.serverResponse('watch-bad'))
      .toMatchObject({
        error: { code: -32603 },
      })
  })

  it('releases watches on unregistration and when the backend goes away', async () => {
    const fixture = await initializedFixture({}, hubWatch)
    fixture.respond(watchRegistration('watch-1', `${fixture.match.root}/**/*`))
    await expect.poll(() => fixture.serverResponse('watch-1')).toBeDefined()
    expect(fixture.hub().info().nativeWatcherCount).toBe(1)

    fixture.respond({
      id: 'unwatch-1',
      jsonrpc: '2.0',
      method: 'client/unregisterCapability',
      params: { unregisterations: [{ id: 'watch-1', method: 'workspace/didChangeWatchedFiles' }] },
    })
    await expect.poll(() => fixture.serverResponse('unwatch-1')).toBeDefined()
    await expect.poll(() => fixture.hub().info().nativeWatcherCount).toBe(0)

    fixture.respond(watchRegistration('watch-2', `${fixture.match.root}/**/*`))
    await expect.poll(() => fixture.serverResponse('watch-2')).toBeDefined()
    fixture.pool.disposeAll()
    await expect.poll(() => fixture.hub().info().nativeWatcherCount).toBe(0)
  })
})

const watchHubs = new Map<string, FileChangeHub>()

function hubWatch(root: string) {
  const paths = createWorkspacePaths(root)
  const hub = new FileChangeHub(paths, { enabled: true })
  hubs.push(hub)
  watchHubs.set(root, hub)
  return treeWatchSource(hub, paths)
}

function watchRegistration(id: string, globPattern: string) {
  return {
    id,
    jsonrpc: '2.0',
    method: 'client/registerCapability',
    params: {
      registrations: [
        {
          id,
          method: 'workspace/didChangeWatchedFiles',
          registerOptions: { watchers: [{ globPattern }] },
        },
      ],
    },
  }
}

describe('LspSessionPool semantic token delta', () => {
  const DELTA_CAPABLE = {
    capabilities: {
      semanticTokensProvider: {
        full: { delta: true },
        legend: { tokenModifiers: [], tokenTypes: ['variable'] },
        range: true,
      },
    },
  }

  async function deltaFixture() {
    const fixture = await lspFixture()
    fixture.delta.enabled = true
    const first = await fixture.pool.acquire(fixture.firstSocket, fixture.match, '')
    const second = await fixture.pool.acquire(fixture.secondSocket, fixture.match, '')
    if (!first || !second) throw new Error('expected pooled LSP sessions')

    const initialize = first.handleClientMessage(json(initializeRequest(1)))
    await fixture.waitForServerMessageCount(1)
    fixture.respond({ id: fixture.serverMessages[0].id, jsonrpc: '2.0', result: DELTA_CAPABLE })
    await initialize
    await second.handleClientMessage(json(initializeRequest(2)))
    // Ten lines, because the reassembled streams below address line 1 and up:
    // the proxy refuses a token stream that walks past the last line, and a
    // one-line fixture would trip that check rather than the branch under test.
    await first.handleClientMessage(json(didOpen(URI, DOCUMENT_TEXT)))
    // Both tabs own the document, which is what a tab asking for its tokens
    // always is: the request comes from a view that has the file open. A waiter
    // that never opened it would be released the moment the *other* tab closed,
    // because the document would have no owners left.
    await second.handleClientMessage(json(didOpen(URI, DOCUMENT_TEXT)))

    return { ...fixture, first, second }
  }

  const URI = 'file:///repo/a.ts'
  const DOCUMENT_TEXT = Array.from(
    { length: 10 },
    (_, line) => `const value${line} = ${line}`,
  ).join('\n')
  const tokensRequest = (id: number) => ({
    id,
    jsonrpc: '2.0',
    method: 'textDocument/semanticTokens/full',
    params: { textDocument: { uri: URI } },
  })
  const lastServerRequest = (fixture: Awaited<ReturnType<typeof deltaFixture>>) =>
    fixture.serverMessages
      .filter(
        (message) =>
          typeof message.method === 'string' &&
          (message.method as string).startsWith('textDocument/semanticTokens'),
      )
      .at(-1)

  it('asks for a whole file first, and a delta once it holds a baseline', async () => {
    const fixture = await deltaFixture()

    await fixture.first.handleClientMessage(json(tokensRequest(10)))
    const first = lastServerRequest(fixture)
    expect(first?.method).toBe('textDocument/semanticTokens/full')
    fixture.respond({
      id: first?.id,
      jsonrpc: '2.0',
      result: { data: [0, 0, 5, 0, 0, 1, 0, 3, 0, 0], resultId: 'r1' },
    })

    await fixture.first.handleClientMessage(json(tokensRequest(11)))
    const second = lastServerRequest(fixture)

    expect(second?.method).toBe('textDocument/semanticTokens/full/delta')
    expect(second?.params).toMatchObject({ previousResultId: 'r1' })
  })

  it('reassembles a delta into the whole array the client expects', async () => {
    const fixture = await deltaFixture()
    await fixture.first.handleClientMessage(json(tokensRequest(10)))
    fixture.respond({
      id: lastServerRequest(fixture)?.id,
      jsonrpc: '2.0',
      result: { data: [0, 0, 5, 0, 0, 1, 0, 3, 0, 0], resultId: 'r1' },
    })

    await fixture.first.handleClientMessage(json(tokensRequest(11)))
    fixture.respond({
      id: lastServerRequest(fixture)?.id,
      jsonrpc: '2.0',
      // Replace the second tuple's length, the way a real edit reads.
      result: { edits: [{ data: [7], deleteCount: 1, start: 7 }], resultId: 'r2' },
    })

    expect(fixture.firstSocket.sent.at(-1)).toMatchObject({
      id: 11,
      result: { data: [0, 0, 5, 0, 0, 1, 0, 7, 0, 0], resultId: 'r2' },
    })
  })

  it('never lets a delta reach the browser', async () => {
    const fixture = await deltaFixture()
    await fixture.first.handleClientMessage(json(tokensRequest(10)))
    fixture.respond({
      id: lastServerRequest(fixture)?.id,
      jsonrpc: '2.0',
      result: { data: [0, 0, 5, 0, 0], resultId: 'r1' },
    })
    await fixture.first.handleClientMessage(json(tokensRequest(11)))
    fixture.respond({
      id: lastServerRequest(fixture)?.id,
      jsonrpc: '2.0',
      result: { edits: [{ data: [0, 0, 9, 0, 0], deleteCount: 5, start: 0 }], resultId: 'r2' },
    })

    // The transport boundary, asserted rather than reasoned about: nothing the
    // browser ever receives carries `edits`, and nothing it ever sends is a
    // `full/delta`.
    for (const sent of fixture.firstSocket.sent) {
      expect(JSON.stringify(sent)).not.toContain('"edits"')
      expect(JSON.stringify(sent)).not.toContain('full/delta')
    }
  })

  it('drops the baseline and retries once when the server refuses the resultId', async () => {
    const fixture = await deltaFixture()
    await fixture.first.handleClientMessage(json(tokensRequest(10)))
    fixture.respond({
      id: lastServerRequest(fixture)?.id,
      jsonrpc: '2.0',
      result: { data: [0, 0, 5, 0, 0], resultId: 'r1' },
    })

    await fixture.first.handleClientMessage(json(tokensRequest(11)))
    const deltaAsk = lastServerRequest(fixture)
    expect(deltaAsk?.method).toBe('textDocument/semanticTokens/full/delta')
    fixture.respond({
      error: { code: -32602, message: 'unknown previousResultId' },
      id: deltaAsk?.id,
      jsonrpc: '2.0',
    })

    // Retried as a plain `full`, not surfaced to the client as an error.
    const retry = lastServerRequest(fixture)
    expect(retry?.method).toBe('textDocument/semanticTokens/full')
    fixture.respond({
      id: retry?.id,
      jsonrpc: '2.0',
      result: { data: [0, 0, 8, 0, 0], resultId: 'r2' },
    })

    expect(fixture.firstSocket.sent.at(-1)).toMatchObject({
      id: 11,
      result: { data: [0, 0, 8, 0, 0] },
    })
  })

  it('asks the backend once when two tabs want the same file at the same time', async () => {
    const fixture = await deltaFixture()
    const before = fixture.serverMessages.length

    await fixture.first.handleClientMessage(json(tokensRequest(10)))
    await fixture.second.handleClientMessage(json(tokensRequest(20)))

    const asks = fixture.serverMessages
      .slice(before)
      .filter((message) => String(message.method).startsWith('textDocument/semanticTokens'))
    expect(asks).toHaveLength(1)

    fixture.respond({
      id: asks[0]?.id,
      jsonrpc: '2.0',
      result: { data: [0, 0, 4, 0, 0], resultId: 'r1' },
    })

    // Both clients get the same answer, each under its own request id.
    expect(fixture.firstSocket.sent.at(-1)).toMatchObject({
      id: 10,
      result: { data: [0, 0, 4, 0, 0] },
    })
    expect(fixture.secondSocket.sent.at(-1)).toMatchObject({
      id: 20,
      result: { data: [0, 0, 4, 0, 0] },
    })
  })

  it('refuses a reassembled array that walks off the end of the document', async () => {
    const fixture = await deltaFixture()
    await fixture.first.handleClientMessage(json(tokensRequest(10)))
    fixture.respond({
      id: lastServerRequest(fixture)?.id,
      jsonrpc: '2.0',
      result: { data: [0, 0, 5, 0, 0], resultId: 'r1' },
    })

    await fixture.first.handleClientMessage(json(tokensRequest(11)))
    fixture.respond({
      id: lastServerRequest(fixture)?.id,
      jsonrpc: '2.0',
      // The document is one line. A tuple claiming line 40 describes text that is
      // not there, which is what a mis-spliced array looks like.
      result: { edits: [{ data: [40, 0, 5, 0, 0], deleteCount: 5, start: 0 }], resultId: 'r2' },
    })

    // Refused and retried as a whole file rather than answered. Painting spans
    // that match no version of the text is the one outcome worth any cost to
    // avoid.
    expect(lastServerRequest(fixture)?.method).toBe('textDocument/semanticTokens/full')
  })

  /**
   * The normal path while typing, not an exception: the browser cancels its
   * in-flight token request on every keystroke. Treating that as a rejected
   * baseline threw a good one away each time, counted it against the server, and
   * re-issued a whole-file request the client had just told us to abandon.
   */
  it('does not mistake a cancelled request for a rejected baseline', async () => {
    const fixture = await deltaFixture()
    await fixture.first.handleClientMessage(json(tokensRequest(10)))
    fixture.respond({
      id: lastServerRequest(fixture)?.id,
      jsonrpc: '2.0',
      result: { data: [0, 0, 5, 0, 0], resultId: 'r1' },
    })

    await fixture.first.handleClientMessage(json(tokensRequest(11)))
    const cancelled = lastServerRequest(fixture)
    expect(cancelled?.method).toBe('textDocument/semanticTokens/full/delta')
    await fixture.first.handleClientMessage(
      json({ jsonrpc: '2.0', method: '$/cancelRequest', params: { id: 11 } }),
    )
    fixture.respond({
      error: { code: -32800, message: 'request cancelled' },
      id: cancelled?.id,
      jsonrpc: '2.0',
    })

    // No retry was issued for a request the client abandoned...
    expect(lastServerRequest(fixture)?.id).toBe(cancelled?.id)

    // ...and the baseline survived, so the next ask is still a delta.
    await fixture.first.handleClientMessage(json(tokensRequest(12)))
    expect(lastServerRequest(fixture)?.method).toBe('textDocument/semanticTokens/full/delta')
    expect(lastServerRequest(fixture)?.params).toMatchObject({ previousResultId: 'r1' })
  })

  it('passes a content-modified error through without touching the baseline', async () => {
    const fixture = await deltaFixture()
    await fixture.first.handleClientMessage(json(tokensRequest(10)))
    fixture.respond({
      id: lastServerRequest(fixture)?.id,
      jsonrpc: '2.0',
      result: { data: [0, 0, 5, 0, 0], resultId: 'r1' },
    })

    await fixture.first.handleClientMessage(json(tokensRequest(11)))
    fixture.respond({
      error: { code: -32801, message: 'content modified' },
      id: lastServerRequest(fixture)?.id,
      jsonrpc: '2.0',
    })

    // The client is told what happened rather than being left waiting.
    expect(fixture.firstSocket.sent.at(-1)).toMatchObject({ id: 11, error: { code: -32801 } })

    await fixture.first.handleClientMessage(json(tokensRequest(12)))
    expect(lastServerRequest(fixture)?.method).toBe('textDocument/semanticTokens/full/delta')
  })

  it('cancels the shared request only when the last waiter gives up', async () => {
    const fixture = await deltaFixture()
    const before = fixture.serverMessages.length
    await fixture.first.handleClientMessage(json(tokensRequest(10)))
    await fixture.second.handleClientMessage(json(tokensRequest(20)))
    const ask = fixture.serverMessages
      .slice(before)
      .filter((message) => String(message.method).startsWith('textDocument/semanticTokens'))[0]

    // One of two waiters cancels. The backend must keep working for the other.
    await fixture.first.handleClientMessage(
      json({ jsonrpc: '2.0', method: '$/cancelRequest', params: { id: 10 } }),
    )
    expect(
      fixture.serverMessages.filter((message) => message.method === '$/cancelRequest'),
    ).toHaveLength(0)

    fixture.respond({
      id: ask?.id,
      jsonrpc: '2.0',
      result: { data: [0, 0, 4, 0, 0], resultId: 'r1' },
    })
    expect(fixture.secondSocket.sent.at(-1)).toMatchObject({
      id: 20,
      result: { data: [0, 0, 4, 0, 0] },
    })
  })

  it('starts a fresh request rather than coalescing across an edit', async () => {
    const fixture = await deltaFixture()
    const before = fixture.serverMessages.length
    await fixture.first.handleClientMessage(json(tokensRequest(10)))

    // The text moves while the first request is in flight, so the answer to it
    // describes a version the second asker never saw.
    await fixture.first.handleClientMessage(
      json({
        jsonrpc: '2.0',
        method: 'textDocument/didChange',
        params: {
          contentChanges: [{ text: `${DOCUMENT_TEXT}\nconst added = 1` }],
          textDocument: { uri: URI, version: 2 },
        },
      }),
    )
    await fixture.second.handleClientMessage(json(tokensRequest(20)))

    const asks = fixture.serverMessages
      .slice(before)
      .filter((message) => String(message.method).startsWith('textDocument/semanticTokens'))
    expect(asks).toHaveLength(2)
  })

  /**
   * Two token requests for one uri really can overlap: an edit while one is in
   * flight starts a second rather than coalescing onto an answer about replaced
   * text. So the second can land first and move the baseline out from under the
   * first — and splicing edits into an array the server never diffed against
   * produces a token stream describing no version of anything.
   */
  it('refuses a delta computed against a baseline it no longer holds', async () => {
    const fixture = await deltaFixture()
    await fixture.first.handleClientMessage(json(tokensRequest(10)))
    fixture.respond({
      id: lastServerRequest(fixture)?.id,
      jsonrpc: '2.0',
      result: { data: [0, 0, 5, 0, 0], resultId: 'r1' },
    })

    // Request A goes out as a delta against r1.
    await fixture.first.handleClientMessage(json(tokensRequest(11)))
    const requestA = lastServerRequest(fixture)
    expect(requestA?.method).toBe('textDocument/semanticTokens/full/delta')

    // The text moves, so the next ask starts request B instead of coalescing.
    await fixture.first.handleClientMessage(
      json({
        jsonrpc: '2.0',
        method: 'textDocument/didChange',
        params: {
          contentChanges: [{ text: `${DOCUMENT_TEXT}\nconst added = 1` }],
          textDocument: { uri: URI, version: 2 },
        },
      }),
    )
    await fixture.second.handleClientMessage(json(tokensRequest(20)))
    const requestB = lastServerRequest(fixture)
    expect(requestB?.id).not.toBe(requestA?.id)

    // B lands first and replaces the baseline.
    fixture.respond({
      id: requestB?.id,
      jsonrpc: '2.0',
      result: { data: [0, 0, 9, 0, 0], resultId: 'r2' },
    })

    // Now A's delta arrives, computed against r1, which is gone.
    fixture.respond({
      id: requestA?.id,
      jsonrpc: '2.0',
      result: { edits: [{ data: [7], deleteCount: 1, start: 2 }], resultId: 'r3' },
    })

    // Refused and re-asked as a whole file, rather than spliced into r2.
    expect(lastServerRequest(fixture)?.method).toBe('textDocument/semanticTokens/full')
  })

  it('refuses edits whose bounds only fit after an earlier edit grew the array', async () => {
    const fixture = await deltaFixture()
    await fixture.first.handleClientMessage(json(tokensRequest(10)))
    fixture.respond({
      id: lastServerRequest(fixture)?.id,
      jsonrpc: '2.0',
      result: { data: [0, 0, 5, 0, 0, 1, 0, 3, 0, 0], resultId: 'r1' },
    })

    await fixture.first.handleClientMessage(json(tokensRequest(11)))
    fixture.respond({
      id: lastServerRequest(fixture)?.id,
      jsonrpc: '2.0',
      result: {
        // Every offset indexes the baseline, which is 10 long. The second edit
        // reaches past it and only "fits" if the first one's growth is counted.
        edits: [
          { data: [0, 0, 1, 0, 0, 0, 0, 2, 0, 0], deleteCount: 0, start: 5 },
          { data: [], deleteCount: 8, start: 6 },
        ],
        resultId: 'r2',
      },
    })

    expect(lastServerRequest(fixture)?.method).toBe('textDocument/semanticTokens/full')
  })

  it('keeps the baseline while another tab still has the document open', async () => {
    const fixture = await deltaFixture()
    await fixture.first.handleClientMessage(json(tokensRequest(10)))
    fixture.respond({
      id: lastServerRequest(fixture)?.id,
      jsonrpc: '2.0',
      result: { data: [0, 0, 5, 0, 0], resultId: 'r1' },
    })

    // One of two owners leaves. The backend still has the document, so its own
    // token cache is still valid and so is ours.
    await fixture.first.handleClientMessage(json(didClose(URI)))
    await fixture.second.handleClientMessage(json(tokensRequest(21)))

    expect(lastServerRequest(fixture)?.method).toBe('textDocument/semanticTokens/full/delta')
  })

  it('keeps answering the other tabs when one waiting tab closes', async () => {
    const fixture = await deltaFixture()
    const before = fixture.serverMessages.length
    await fixture.first.handleClientMessage(json(tokensRequest(10)))
    await fixture.second.handleClientMessage(json(tokensRequest(20)))
    const ask = fixture.serverMessages
      .slice(before)
      .filter((message) => String(message.method).startsWith('textDocument/semanticTokens'))[0]

    // The tab that asked *first* goes away while the shared request is in flight.
    fixture.first.dispose()
    fixture.respond({
      id: ask?.id,
      jsonrpc: '2.0',
      result: { data: [0, 0, 6, 0, 0], resultId: 'r1' },
    })

    // The one still open must still get its answer.
    expect(fixture.secondSocket.sent.at(-1)).toMatchObject({
      id: 20,
      result: { data: [0, 0, 6, 0, 0] },
    })
    expect(
      fixture.serverMessages.filter((message) => message.method === '$/cancelRequest'),
    ).toHaveLength(0)
  })

  it('sends no delta at all while the setting is off', async () => {
    const fixture = await deltaFixture()
    await fixture.first.handleClientMessage(json(tokensRequest(10)))
    fixture.respond({
      id: lastServerRequest(fixture)?.id,
      jsonrpc: '2.0',
      result: { data: [0, 0, 5, 0, 0], resultId: 'r1' },
    })

    fixture.delta.enabled = false
    await fixture.first.handleClientMessage(json(tokensRequest(11)))

    expect(lastServerRequest(fixture)?.method).toBe('textDocument/semanticTokens/full')
  })

  it('forgets the baseline when the last owner closes the document', async () => {
    const fixture = await deltaFixture()
    await fixture.first.handleClientMessage(json(tokensRequest(10)))
    fixture.respond({
      id: lastServerRequest(fixture)?.id,
      jsonrpc: '2.0',
      result: { data: [0, 0, 5, 0, 0], resultId: 'r1' },
    })

    // Both owners, or the document survives and the baseline rightly survives
    // with it — the backend only forgets the document when the last one leaves.
    await fixture.first.handleClientMessage(json(didClose(URI)))
    await fixture.second.handleClientMessage(json(didClose(URI)))
    await fixture.first.handleClientMessage(json(didOpen(URI, DOCUMENT_TEXT)))
    await fixture.first.handleClientMessage(json(tokensRequest(12)))

    // The server's own cache died with the `didClose`, so a `previousResultId`
    // from before it is a baseline nothing can diff against.
    expect(lastServerRequest(fixture)?.method).toBe('textDocument/semanticTokens/full')
  })
})

// An in-memory database and a settings file inside the test's own temp root:
// `createApp` otherwise opens the developer's real ~/.platform SQLite and
// settings.json, and this repo keeps no healing code for either.
function lspTestApp(root: string, pool: LspSessionPool) {
  const database = createMetadataDatabase({ databasePath: ':memory:' })
  databases.push(database)
  return createApp({
    auth: { allowedOrigins: ['http://localhost:5173'] },
    lsp: { pool },
    metadataDatabase: database,
    orchestration: { database: database.db },
    settings: testSettingsOptions(root),
    watch: false,
    workspaceEditJournalRoot: path.join(root, '.workspace-edit-journals'),
    workspaceRoot: root,
  })
}

async function initializedFixture(
  server: Partial<LspServerMatch['server']> = {},
  watch?: (root: string) => TreeWatchSource | null,
) {
  const fixture = await lspFixture(server, undefined, watch)
  const first = await fixture.pool.acquire(fixture.firstSocket, fixture.match, '')
  const second = await fixture.pool.acquire(fixture.secondSocket, fixture.match, '')
  if (!first || !second) throw new Error('expected pooled LSP sessions')

  const initialize = first.handleClientMessage(json(initializeRequest(1)))
  await fixture.waitForServerMessageCount(1)
  fixture.respond({ id: fixture.serverMessages[0].id, jsonrpc: '2.0', result: initializeResult() })
  await initialize

  return { ...fixture, first, second }
}

async function lspFixture(
  server: Partial<LspServerMatch['server']> = {},
  initializationOptions?: LspServerHandle['initializationOptions'],
  watch: (root: string) => TreeWatchSource | null = () => null,
) {
  const root = await realpath(await fixtureRoot('platform-lsp-pool-'))
  // A flag the test flips rather than a setter on the pool: `deltaEnabled` is a
  // getter in production precisely so a settings write takes effect without a
  // restart, and reading it per request is the behaviour worth exercising.
  const delta = { enabled: false }
  const pool = new LspSessionPool(undefined, () => delta.enabled, watch(root))
  pools.push(pool)

  const process = fakeProcess()
  const serverMessages: Record<string, unknown>[] = []
  const reader = new LspStdioMessageReader((message) => {
    serverMessages.push(JSON.parse(message) as Record<string, unknown>)
  })
  process.stdin.on('data', (chunk) => reader.push(chunk))

  // A spawn the test can hold open, to exercise a backend that lands *after*
  // the pool was disposed.
  let spawnGate: Promise<void> | null = null
  let openSpawnGate: (() => void) | null = null
  const spawn = vi.fn(async () => {
    if (spawnGate) await spawnGate
    return { process: process.process, initializationOptions }
  })
  const match = {
    root,
    server: {
      extensions: ['.ts'],
      id: 'typescript',
      root: async () => root,
      spawn,
      ...server,
    },
  } satisfies LspServerMatch

  return {
    delta,
    firstSocket: new FakeSocket(),
    kill: process.kill,
    match,
    pool,
    process,
    secondSocket: new FakeSocket(),
    serverMessages,
    spawn,
    holdSpawn: () => {
      spawnGate = new Promise<void>((resolve) => {
        openSpawnGate = resolve
      })
    },
    initializeMessages: () => serverMessages.filter((message) => message.method === 'initialize'),
    hub: () => {
      const hub = watchHubs.get(root)
      if (!hub) throw new Error('fixture has no watch hub')
      return hub
    },
    serverResponse: (id: string) =>
      serverMessages.find((message) => message.id === id && !('method' in message)),
    watchedChanges: () =>
      serverMessages
        .filter((message) => message.method === 'workspace/didChangeWatchedFiles')
        .flatMap((message) => (message.params as { changes: unknown[] }).changes),
    releaseSpawn: () => openSpawnGate?.(),
    respond: (message: unknown) => {
      process.stdout.write(encodeLspStdioMessage(JSON.stringify(message)))
    },
    waitForServerMessageCount: (count: number) =>
      waitFor(() => serverMessages.length >= count, `expected ${count} server messages`),
  }
}

async function fixtureRoot(prefix: string) {
  const root = await mkdtemp(path.join(tmpdir(), prefix))
  roots.push(root)
  return root
}

class FakeSocket {
  closed = false
  readonly sent: Record<string, unknown>[] = []

  close(): void {
    this.closed = true
  }

  send(message: string): void {
    this.sent.push(JSON.parse(message) as Record<string, unknown>)
  }
}

function fakeProcess() {
  const stdout = new PassThrough()
  const stdin = new PassThrough()
  const stderr = new PassThrough()
  const events = new EventEmitter()
  const kill = vi.fn(() => {
    events.emit('exit', null, 'SIGTERM')
    return true
  })
  const process = Object.assign(events, {
    kill,
    pid: 1234,
    stderr,
    stdin,
    stdout,
  }) as unknown as ChildProcessWithoutNullStreams

  return { kill, process, stderr, stdin, stdout }
}

async function waitFor(predicate: () => boolean, message: string): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (predicate()) return

    await Bun.sleep(1)
  }

  throw new Error(message)
}

function json(value: unknown): string {
  return JSON.stringify(value)
}

function initializeRequest(id: number, params: Record<string, unknown> = {}) {
  return {
    id,
    jsonrpc: '2.0',
    method: 'initialize',
    params,
  }
}

function initializeResult() {
  return {
    capabilities: {
      textDocumentSync: {
        change: 2,
        openClose: true,
      },
    },
  }
}

function hoverRequest(id: number, uri: string) {
  return {
    id,
    jsonrpc: '2.0',
    method: 'textDocument/hover',
    params: {
      position: { character: 0, line: 0 },
      textDocument: { uri },
    },
  }
}

function hoverResult(value: string) {
  return { contents: { kind: 'plaintext', value } }
}

function didOpen(uri: string, text: string, version = 0) {
  return {
    jsonrpc: '2.0',
    method: 'textDocument/didOpen',
    params: {
      textDocument: {
        languageId: 'typescript',
        text,
        uri,
        version,
      },
    },
  }
}

function didChange(
  uri: string,
  version: number,
  contentChanges: readonly Record<string, unknown>[],
) {
  return {
    jsonrpc: '2.0',
    method: 'textDocument/didChange',
    params: {
      contentChanges,
      textDocument: { uri, version },
    },
  }
}

function workspaceEditRequest(id: number, method: string, uri = 'file:///repo/a.ts') {
  if (method === 'codeAction/resolve') {
    return { id, jsonrpc: '2.0', method, params: { title: 'Resolve fix' } }
  }
  if (method === 'textDocument/codeAction') {
    return {
      id,
      jsonrpc: '2.0',
      method,
      params: {
        context: { diagnostics: [] },
        range: {
          end: { character: 1, line: 0 },
          start: { character: 0, line: 0 },
        },
        textDocument: { uri },
      },
    }
  }

  return {
    id,
    jsonrpc: '2.0',
    method,
    params: {
      newName: 'next',
      position: { character: 0, line: 0 },
      textDocument: { uri },
    },
  }
}

function textDocumentEdit(uri: string, version: number | null, newText = 'next') {
  return {
    edits: [
      {
        newText,
        range: {
          end: { character: 1, line: 0 },
          start: { character: 0, line: 0 },
        },
      },
    ],
    textDocument: { uri, version },
  }
}

function workspaceEdit(...documentChanges: readonly unknown[]) {
  return { documentChanges }
}

function didClose(uri: string) {
  return {
    jsonrpc: '2.0',
    method: 'textDocument/didClose',
    params: { textDocument: { uri } },
  }
}
