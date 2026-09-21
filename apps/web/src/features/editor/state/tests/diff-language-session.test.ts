import type { LspClient, LspWorkspace } from '@singapore-editor/lsp'
import type { LanguageServerLaneOptions } from '@singapore-editor/lsp-plugin/websocket'
import type { LspConnectionCallbacks, LspConnectionProvider } from '@singapore-editor/lsp-plugin'
import { vi } from 'vitest'

import { createDiffLanguageSession } from '@/features/editor/state/diff-language-session'
import { expect, test } from '../../../../../test/fixtures'

test('awaits the existing lane lease before opening documents or sending requests', async () => {
  const harness = laneHarness()
  const session = createDiffLanguageSession({ documents: documents(), lanes: [harness.options] })

  const request = session.request('textDocument/hover', { position: 1 })
  expect(harness.openDocumentSnapshot).not.toHaveBeenCalled()
  expect(harness.request).not.toHaveBeenCalled()

  harness.connect()
  await expect(request).resolves.toMatchObject({
    contents: { kind: 'markdown', value: 'answer' },
  })
  expect(harness.openDocumentSnapshot).toHaveBeenCalledTimes(2)
  expect(harness.request).toHaveBeenCalledWith(
    'textDocument/hover',
    { position: 1 },
    { signal: expect.any(AbortSignal) },
  )
})

test('closes only diff-owned documents and releases its dedicated lease', async () => {
  const harness = laneHarness()
  const session = createDiffLanguageSession({ documents: documents(), lanes: [harness.options] })
  const request = session.request('textDocument/definition', {})
  harness.connect()
  await request

  session.dispose()

  expect(harness.closeDocument.mock.calls.map(([attachment]) => attachment.uri)).toEqual([
    'file:///repo/file.ts',
    'file:///repo/file.ts.diff-old',
  ])
  expect(harness.release).toHaveBeenCalledTimes(1)
})

test('rejects an in-flight response after the session is disposed', async () => {
  const answer = deferred<string>()
  const harness = laneHarness(() => answer.promise)
  const session = createDiffLanguageSession({ documents: documents(), lanes: [harness.options] })
  const request = session.request<string>('textDocument/hover', {})
  harness.connect()
  await vi.waitFor(() => expect(harness.request).toHaveBeenCalledTimes(1))

  session.dispose()
  answer.resolve('late answer')

  await expect(request).rejects.toThrow('Diff language session closed')
})

test('routes diff hover and navigation through independent capable lanes', async () => {
  const hover = laneHarness(async () => ({ contents: { kind: 'markdown', value: 'hover' } }), {
    capabilities: { hoverProvider: true },
    features: { hover: 0 },
    id: 'hover',
  })
  const navigation = laneHarness(
    async () => [
      {
        range: {
          end: { character: 1, line: 0 },
          start: { character: 0, line: 0 },
        },
        uri: 'file:///repo/definition.ts',
      },
    ],
    {
      capabilities: { definitionProvider: true },
      features: { navigation: 0 },
      id: 'navigation',
    },
  )
  const session = createDiffLanguageSession({
    documents: documents(),
    lanes: [hover.options, navigation.options],
  })
  const hoverRequest = session.request('textDocument/hover', {})
  const definitionRequest = session.request('textDocument/definition', {})
  hover.connect()
  navigation.connect()

  await expect(hoverRequest).resolves.toMatchObject({
    contents: { kind: 'markdown', value: 'hover' },
  })
  await expect(definitionRequest).resolves.toHaveLength(1)
  expect(hover.request).toHaveBeenCalledWith('textDocument/hover', {}, expect.any(Object))
  expect(navigation.request).toHaveBeenCalledWith('textDocument/definition', {}, expect.any(Object))
})

function laneHarness(
  requestResult: (method: string) => Promise<unknown> = async () => ({
    contents: { kind: 'markdown', value: 'answer' },
  }),
  overrides: {
    readonly capabilities?: LspClient['serverCapabilities']
    readonly features?: LanguageServerLaneOptions['features']
    readonly id?: string
  } = {},
) {
  let callbacks: LspConnectionCallbacks | null = null
  const openDocumentSnapshot = vi.fn((document: { uri: string }) => ({
    attachment: { uri: document.uri },
    document: { ...document, version: 1 },
  }))
  const closeDocument = vi.fn()
  const request = vi.fn(requestResult)
  const release = vi.fn()
  const client = {
    notify: vi.fn(async () => undefined),
    request,
    serverCapabilities: overrides.capabilities ?? {
      definitionProvider: true,
      hoverProvider: true,
    },
  } as unknown as LspClient
  const workspace = { closeDocument, openDocumentSnapshot } as unknown as LspWorkspace
  const connection = { client, workspace }
  const provider: LspConnectionProvider = {
    acquire: (_options, connectionCallbacks) => {
      callbacks = connectionCallbacks
      return { connection: connection as never, release }
    },
  }
  const options: LanguageServerLaneOptions = {
    connectionProvider: provider,
    features: overrides.features ?? { hover: 0, navigation: 0 },
    id: overrides.id ?? 'typescript',
    webSocketRoute: 'ws://localhost/lsp',
  }

  return {
    closeDocument,
    openDocumentSnapshot,
    options,
    release,
    request,
    connect: () => callbacks?.onConnected(),
  }
}

function deferred<T>(): { promise: Promise<T>; resolve(value: T): void } {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((settle) => {
    resolve = settle
  })
  return { promise, resolve }
}

function documents() {
  return [
    {
      languageId: 'typescript',
      sharesRealUri: true,
      side: 'new' as const,
      text: 'new',
      uri: 'file:///repo/file.ts',
    },
    {
      languageId: 'typescript',
      sharesRealUri: false,
      side: 'old' as const,
      text: 'old',
      uri: 'file:///repo/file.ts.diff-old',
    },
  ]
}
