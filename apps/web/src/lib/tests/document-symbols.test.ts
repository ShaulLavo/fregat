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

const request = {
  path: '/repo/main.ts',
  rootPath: '/repo',
  serverId: 'typescript',
}

test('symbol requests await initialize and initialized with the editor pooled contract', async ({
  client,
}) => {
  const connection = createLanguageServerSocket()
  const abort = new AbortController()
  const result = fetchDocumentSymbolTree(
    { ...request, signal: abort.signal },
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
