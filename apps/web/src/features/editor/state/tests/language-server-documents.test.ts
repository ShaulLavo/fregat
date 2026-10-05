import { createEditorBufferSession, createEditorTextBuffer } from '@singapore-editor/core/document'
import { createLanguageServerDocument } from '@singapore-editor/lsp-plugin'
import { describe, expect, it, vi } from 'vitest'
import {
  LanguageServerDocuments,
  type LanguageServerDocumentEntry,
} from '@/features/editor/state/language-server-documents'
import { createEditorLanguageServerStatusSource } from '@/features/editor/state/language-server-status-source'
import { test } from '../../../../../test/fixtures'
import { createLanguageServerSocket } from '../../../../../test/factories/language-server-socket'
import { languageServerWebSocketConstructor } from '@/lib/server-sockets'

function entry(buffer = createEditorTextBuffer('')): LanguageServerDocumentEntry {
  return {
    document: createLanguageServerDocument({
      buffer,
      uri: 'file:///a.ts',
      languageId: 'typescript',
      lanes: [],
    }),
    status: createEditorLanguageServerStatusSource(),
    semanticControllers: new Map(),
  }
}

describe('open LSP documents', () => {
  it('reuses a session across views and releases it when its last open reference disappears', () => {
    const documents = new LanguageServerDocuments(20)
    const buffer = createEditorTextBuffer('')
    const created = entry(buffer)
    const dispose = vi.spyOn(created.document, 'dispose')
    const create = vi.fn(() => created)
    expect(documents.getOrCreate('a', buffer, 'typescript', create)).toMatchObject(created)
    documents.retain(new Map([['a', buffer]]))
    expect(documents.getOrCreate('a', buffer, 'typescript', create)).toMatchObject(created)
    expect(create).toHaveBeenCalledTimes(1)
    expect(dispose).not.toHaveBeenCalled()
    documents.retain(new Map())
    expect(dispose).toHaveBeenCalledTimes(1)
    documents.dispose()
    expect(dispose).toHaveBeenCalledTimes(1)
  })

  it('releases retained sessions on a settings generation change, once per generation', () => {
    const documents = new LanguageServerDocuments(20)
    const buffer = createEditorTextBuffer('')
    const first = entry(buffer)
    const dispose = vi.spyOn(first.document, 'dispose')
    documents.configure(1)
    documents.getOrCreate('a', buffer, 'typescript', () => first)
    documents.configure(1)
    expect(dispose).not.toHaveBeenCalled()
    documents.configure(2)
    expect(dispose).toHaveBeenCalledOnce()
    const next = entry(buffer)
    expect(documents.getOrCreate('a', buffer, 'typescript', () => next)?.document).toBe(
      next.document,
    )
    documents.dispose()
  })

  it('replaces sessions for a new buffer or server configuration and drops a renamed key', () => {
    const documents = new LanguageServerDocuments(20)
    const firstBuffer = createEditorTextBuffer('old')
    const secondBuffer = createEditorTextBuffer('new')
    const first = entry(firstBuffer)
    const second = entry(secondBuffer)
    const third = entry(secondBuffer)
    const firstDispose = vi.spyOn(first.document, 'dispose')
    const secondDispose = vi.spyOn(second.document, 'dispose')
    const thirdDispose = vi.spyOn(third.document, 'dispose')
    documents.getOrCreate('a', firstBuffer, 'typescript', () => first)
    documents.getOrCreate('a', secondBuffer, 'typescript', () => second)
    expect(firstDispose).toHaveBeenCalledOnce()
    documents.getOrCreate('a', secondBuffer, 'typescript+eslint', () => third)
    expect(secondDispose).toHaveBeenCalledOnce()
    documents.retain(new Map([['renamed', secondBuffer]]))
    expect(thirdDispose).toHaveBeenCalledOnce()
  })
})

it('drops a retained document synchronously when edits cross the budget and resumes after undo', () => {
  const buffer = createEditorTextBuffer('1234')
  const documents = new LanguageServerDocuments(4 / 1_048_576)
  const create = vi.fn(() => entry(buffer))
  const first = documents.getOrCreate('a', buffer, 'ts', create)!
  const dispose = vi.spyOn(first.document, 'dispose')
  const session = createEditorBufferSession(buffer)
  session.applyText('5')
  expect(dispose).toHaveBeenCalledOnce()
  expect(documents.getOrCreate('a', buffer, 'ts', create)).toBeNull()
  expect(create).toHaveBeenCalledOnce()
  buffer.undo()
  expect(documents.getOrCreate('a', buffer, 'ts', create)).not.toBe(first)
  expect(create).toHaveBeenCalledTimes(2)
  const current = documents.getOrCreate('a', buffer, 'ts', create)!
  const secondDispose = vi.spyOn(current.document, 'dispose')
  documents.setLimit(3 / 1_048_576)
  expect(secondDispose).toHaveBeenCalledOnce()
  expect(documents.accepts(buffer)).toBe(false)
  documents.dispose()
})

test('configured growth retires the real protocol lane before didChange and undo reopens current source', async ({
  client,
}) => {
  const buffer = createEditorTextBuffer('1234')
  const view = createEditorBufferSession(buffer)
  const documents = new LanguageServerDocuments(4 / 1_048_576)
  const sockets: ReturnType<typeof createLanguageServerSocket>[] = []
  const create = () => {
    const socket = createLanguageServerSocket()
    sockets.push(socket)
    return {
      status: createEditorLanguageServerStatusSource(),
      semanticControllers: new Map(),
      document: createLanguageServerDocument({
        buffer,
        uri: 'file:///a.ts',
        languageId: 'typescript',
        lanes: [
          {
            id: 'typescript',
            features: {},
            webSocketRoute: 'ws://fixture/lsp',
            webSocketTransportOptions: {
              WebSocketCtor: languageServerWebSocketConstructor(
                client,
                new AbortController().signal,
                () => socket.socket,
              ),
            },
          },
        ],
      }),
    }
  }
  try {
    const first = documents.getOrCreate('environment-a:a', buffer, 'typescript-v1', create)!
    sockets[0]!.open()
    await expect.poll(() => sockets[0]!.sent.length).toBe(1)
    sockets[0]!.respond(sockets[0]!.sent[0]?.id, { capabilities: { textDocumentSync: 2 } })
    await first.document.lanes[0]!.connection.ready
    expect(sockets[0]!.sent.at(-1)?.method).toBe('textDocument/didOpen')
    view.applyEdits([{ from: 4, to: 4, text: '5' }])
    expect(sockets[0]!.closed).toBe(true)
    await Promise.resolve()
    expect(sockets[0]!.sent.map((frame) => frame.method)).not.toContain('textDocument/didChange')
    expect(documents.getOrCreate('environment-a:a', buffer, 'typescript-v1', create)).toBeNull()
    buffer.undo()
    const next = documents.getOrCreate('environment-a:a', buffer, 'typescript-v2', create)!
    sockets[1]!.open()
    await expect.poll(() => sockets[1]!.sent.length).toBe(1)
    sockets[1]!.respond(sockets[1]!.sent[0]?.id, { capabilities: { textDocumentSync: 2 } })
    await next.document.lanes[0]!.connection.ready
    expect(sockets[1]!.sent.at(-1)?.params).toMatchObject({
      textDocument: { text: '1234', version: 0 },
    })
    documents.setLimit(3 / 1_048_576)
    expect(sockets[1]!.closed).toBe(true)
  } finally {
    documents.dispose()
  }
})
