import { writeFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import { isRecord } from '@workspace/utils/objects'
import { createViewerLsp } from '@/viewer/state/lsp'
import type { ViewerDiagnostics } from '@/viewer/utils/lsp'
import { test, expect } from '../../../test/socket-fixtures'
import { createTestSettingsSession } from '../../../test/factories/session'

test('viewer initializes through the real LSP route, receives diagnostics and navigates definitions', async ({
  socketServer,
  lsp,
}) => {
  await writeFile(`${socketServer.root}/sample.ts`, 'const answer = 42')
  const session = createTestSettingsSession(socketServer)
  const snapshots: ViewerDiagnostics[] = []
  const owner = createViewerLsp({
    session,
    rootPath: '',
    filePath: 'sample.ts',
    content: 'const answer = 42',
    onDiagnostics: (snapshot) => snapshots.push(snapshot),
  })
  const messages = () => lsp.clients[0]?.messages.filter(isRecord) ?? []
  const send = (value: unknown) => lsp.acquisitions[0]?.[0].send(JSON.stringify(value))
  try {
    await expect
      .poll(() => messages().some((message) => message.method === 'initialize'))
      .toBe(true)
    const initialize = messages().find((message) => message.method === 'initialize')
    send({
      jsonrpc: '2.0',
      id: initialize?.id,
      result: {
        capabilities: { textDocumentSync: 1, hoverProvider: true, definitionProvider: true },
      },
    })
    await owner.ready
    expect(messages().some((message) => message.method === 'textDocument/didOpen')).toBe(true)
    const uri = pathToFileURL(`${socketServer.root}/sample.ts`).href
    const range = { start: { line: 0, character: 6 }, end: { line: 0, character: 12 } }
    send({
      jsonrpc: '2.0',
      method: 'textDocument/publishDiagnostics',
      params: { uri, diagnostics: [{ range, severity: 1, message: 'Example diagnostic' }] },
    })
    expect(snapshots.at(-1)?.items[0]?.message).toBe('Example diagnostic')
    const hover = owner.hover({ line: 0, character: 7 })
    await expect
      .poll(() => messages().some((message) => message.method === 'textDocument/hover'))
      .toBe(true)
    send({
      jsonrpc: '2.0',
      id: messages().find((message) => message.method === 'textDocument/hover')?.id,
      result: { contents: { kind: 'markdown', value: 'const answer: 42' } },
    })
    expect(await hover).toBe('const answer: 42')
    const definitions = owner.definitions({ line: 0, character: 7 })
    await expect
      .poll(() => messages().some((message) => message.method === 'textDocument/definition'))
      .toBe(true)
    send({
      jsonrpc: '2.0',
      id: messages().find((message) => message.method === 'textDocument/definition')?.id,
      result: [{ uri, range }],
    })
    expect(await definitions).toEqual([{ path: 'sample.ts', line: 1, character: 6 }])
  } finally {
    owner.dispose()
    session.dispose()
  }
  expect(lsp.clients[0]?.disposed).toBe(true)
})
