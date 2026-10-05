import {
  defaultClientCapabilities,
  mergeClientCapabilities,
  composeWorkspaceEditClientCapabilities,
} from '@singapore-editor/lsp'

import { fetchDocumentSymbolTree } from '@/lib/document-symbols'
import {
  clientCapabilitiesForServer,
  LANGUAGE_SERVER_CLIENT_INFO,
} from '@/lib/language-server-capabilities'
import { test, expect } from '../../../test/fixtures'
import { createLanguageServerSocket } from '../../../test/factories/language-server-socket'
import {
  createEditorTextBuffer,
  createEditorBufferSession,
  pieceTableDocumentText,
} from '@singapore-editor/core/document'
import { createWorkspaceTextChanges } from '../../../test/factories/workspace-text-changes'

const request = {
  path: '/repo/main.ts',
  rootPath: '/repo',
  serverId: 'typescript',
}

test('live symbols preserve the real workspace host initialize contract', async ({ client }) => {
  const connection = createLanguageServerSocket()
  const { service } = createWorkspaceTextChanges(client)
  const buffer = createEditorTextBuffer('export const current = 1')
  const abort = new AbortController()
  const withHost = {
    ...request,
    buffer,
    signal: abort.signal,
    onApplyWorkspaceEdit: service.onApplyWorkspaceEdit,
  }
  const result = fetchDocumentSymbolTree(withHost, client, () => connection.socket)
  const canceled = expect(result).rejects.toThrow()
  try {
    connection.open()
    await expect.poll(() => connection.sent.length).toBe(1)
    expect(connection.sent[0]?.params).toMatchObject({
      capabilities: mergeClientCapabilities(
        defaultClientCapabilities(),
        composeWorkspaceEditClientCapabilities(clientCapabilitiesForServer('typescript'), true),
      ),
    })
    connection.respond(connection.sent[0]?.id, { capabilities: { textDocumentSync: 2 } })
    await expect.poll(() => connection.sent.at(-1)?.method).toBe('textDocument/documentSymbol')
    const beforeRequest = service.getSnapshot()
    connection.request('unsolicited-edit', 'workspace/applyEdit', {
      edit: {
        changes: {
          'file:///repo/main.ts': [
            {
              range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
              newText: 'unexpected',
            },
          ],
        },
      },
    })
    await expect
      .poll(() => connection.sent.some((frame) => frame.id === 'unsolicited-edit'))
      .toBe(true)
    expect(connection.sent.find((frame) => frame.id === 'unsolicited-edit')).toMatchObject({
      error: { code: -32601 },
    })
    expect(service.getSnapshot()).toBe(beforeRequest)
    expect(pieceTableDocumentText(buffer.getSnapshot())).toBe('export const current = 1')
  } finally {
    abort.abort()
    await canceled
    expect(connection.closed).toBe(true)
  }
})

test('symbol requests await initialize and initialized with the editor pooled contract', async ({
  client,
}) => {
  const { service } = createWorkspaceTextChanges(client)
  const connection = createLanguageServerSocket()
  const abort = new AbortController()
  const result = fetchDocumentSymbolTree(
    { ...request, signal: abort.signal, onApplyWorkspaceEdit: service.onApplyWorkspaceEdit },
    client,
    () => connection.socket,
  )
  connection.open()
  await Promise.resolve()
  expect(connection.sent.map((message) => message.method)).toEqual(['initialize'])

  expect(connection.sent[0]?.params).toEqual({
    processId: null,
    rootUri: 'file:///repo',
    clientInfo: LANGUAGE_SERVER_CLIENT_INFO,
    workspaceFolders: null,
    capabilities: mergeClientCapabilities(
      defaultClientCapabilities(),
      composeWorkspaceEditClientCapabilities(clientCapabilitiesForServer('typescript'), true),
    ),
  })

  connection.respond(connection.sent[0]?.id, { capabilities: {} })
  await expect
    .poll(() => connection.sent.map((message) => message.method))
    .toEqual(['initialize', 'initialized', 'textDocument/documentSymbol'])
  const symbols = [
    {
      name: 'hello',
      kind: 12,
      range: { start: { line: 0, character: 0 }, end: { line: 2, character: 1 } },
      selectionRange: { start: { line: 0, character: 9 }, end: { line: 0, character: 14 } },
    },
  ]
  connection.respond(connection.sent[2]?.id, symbols)
  expect(await result).toEqual(symbols)
  expect(connection.closed).toBe(true)
})

test('aborting a symbol query during initialize closes the socket without a document request', async ({
  client,
}) => {
  const connection = createLanguageServerSocket()
  const abort = new AbortController()
  const result = fetchDocumentSymbolTree(
    { ...request, signal: abort.signal },
    client,
    () => connection.socket,
  )
  const rejected = expect(result).rejects.toThrow()
  connection.open()
  abort.abort()
  await rejected
  expect(connection.closed).toBe(true)
  expect(connection.sent.map((message) => message.method)).toEqual(['initialize'])
})

test('live symbols synchronize the canonical buffer and release their source after the response', async ({
  client,
}) => {
  const connection = createLanguageServerSocket()
  const buffer = createEditorTextBuffer('export const first = 1')
  const edit = createEditorBufferSession(buffer)
  const abort = new AbortController()
  const result = fetchDocumentSymbolTree(
    { ...request, buffer, signal: abort.signal },
    client,
    () => connection.socket,
  )
  connection.open()
  await expect.poll(() => connection.sent.length).toBe(1)
  connection.respond(connection.sent[0]?.id, { capabilities: { textDocumentSync: 2 } })
  await expect
    .poll(() => connection.sent.map((frame) => frame.method))
    .toEqual(['initialize', 'initialized', 'textDocument/didOpen', 'textDocument/documentSymbol'])
  expect(connection.sent[2]?.params).toMatchObject({
    textDocument: { uri: 'file:///repo/main.ts', version: 0, text: 'export const first = 1' },
  })
  edit.applyEdits([{ from: 13, to: 18, text: 'second' }])
  await expect.poll(() => connection.sent.at(-1)?.method).toBe('textDocument/didChange')
  connection.respond(connection.sent[3]?.id, [
    {
      name: 'outgoing',
      kind: 12,
      range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } },
      selectionRange: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } },
    },
  ])
  await expect(result).resolves.toEqual([])
  expect(connection.closed).toBe(true)
  const sent = connection.sent.length
  edit.applyText('!')
  await Promise.resolve()
  expect(connection.sent).toHaveLength(sent)
})

test('live symbols return a nonempty answer while their captured source is current', async ({
  client,
}) => {
  const connection = createLanguageServerSocket()
  const result = fetchDocumentSymbolTree(
    {
      ...request,
      buffer: createEditorTextBuffer('export const current = 1'),
      signal: new AbortController().signal,
    },
    client,
    () => connection.socket,
  )
  connection.open()
  await expect.poll(() => connection.sent.length).toBe(1)
  connection.respond(connection.sent[0]?.id, { capabilities: { textDocumentSync: 2 } })
  await expect.poll(() => connection.sent.at(-1)?.method).toBe('textDocument/documentSymbol')
  const symbols = [
    {
      name: 'current',
      kind: 12,
      range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } },
      selectionRange: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } },
    },
  ]
  connection.respond(connection.sent.at(-1)?.id, symbols)
  await expect(result).resolves.toEqual(symbols)
  expect(connection.closed).toBe(true)
})

test('live symbol cancellation retires a waiting canonical source without sending a query', async ({
  client,
}) => {
  const connection = createLanguageServerSocket()
  const abort = new AbortController()
  const result = fetchDocumentSymbolTree(
    { ...request, buffer: createEditorTextBuffer('one'), signal: abort.signal },
    client,
    () => connection.socket,
  )
  const rejected = expect(result).rejects.toThrow()
  abort.abort()
  await rejected
  expect(connection.closed).toBe(true)
  expect(connection.sent.map((frame) => frame.method)).not.toContain('textDocument/documentSymbol')
})
