import { EditorTokenStore } from '@singapore-editor/core/syntax'
import type {
  EditorViewContributionContext,
  EditorViewContributionProvider,
  EditorViewSnapshot,
  EditorVisibleRowSnapshot,
  SemanticTokenLayer,
} from '@singapore-editor/core/extensions'
import type {
  LspClient,
  LspNotificationHandler,
  LspWebSocketLike,
  LspWebSocketConstructor,
} from '@singapore-editor/lsp'
import { describe, expect, it, vi } from 'vitest'
import type * as lsp from 'vscode-languageserver-protocol'

import { createLanguageServerPlugin, type LanguageServerConnectionContext } from '../src/plugin'
import { LanguageServerDocumentSyncController } from '../src/documentSyncController'
import type { LanguageServerPluginOptions } from '../src/types'
import { flushPromises } from './connectedEditor'
import {
  documentSyncSnapshotFields,
  viewSnapshotStructuralFields,
  viewTextFields,
} from './documentSyncSnapshot'
import {
  createTestPluginContext,
  createTestViewContributionContext,
} from '@singapore-editor/core/testing'

/**
 * The narrow `createLanguageServerPlugin` factory, driven end to end over a stub socket.
 *
 * The narrow factory is the one a host actually reaches for — the adapter factory is the escape
 * hatch — so every knob these tests exercise has to arrive through *it*. A knob that exists only on
 * the adapter is a knob the real consumer cannot reach, which is how `capabilities` came to be
 * unreachable in the first place: `LspConnection.createClient` never passed it on, so no host could
 * declare `textDocument.semanticTokens` and no server ever sent a token.
 */
class StubSocket implements LspWebSocketLike {
  static #last: StubSocket | null = null

  /**
   * Read and reset through methods rather than a bare static: assigning `null` at the top of a test
   * narrows a static field to `null` for the rest of the function, and the constructor that fills it
   * in is invisible to the checker.
   */
  public static latest(): StubSocket | null {
    return StubSocket.#last
  }

  public static reset(): void {
    StubSocket.#last = null
  }
  public readonly readyState = 1
  public readonly sent: string[] = []

  readonly #listeners = new Map<string, Set<EventListener>>()

  public constructor() {
    StubSocket.#last = this
  }

  public send(message: string): void {
    this.sent.push(message)
  }

  public close(): void {
    this.#listeners.clear()
  }

  public addEventListener(type: string, handler: EventListener): void {
    const handlers = this.#listeners.get(type) ?? new Set()
    handlers.add(handler)
    this.#listeners.set(type, handlers)
  }

  public removeEventListener(type: string, handler: EventListener): void {
    this.#listeners.get(type)?.delete(handler)
  }

  public receive(message: unknown): void {
    const event = { data: JSON.stringify(message) } as unknown as Event
    for (const handler of this.#listeners.get('message') ?? []) handler(event)
  }

  public messages(): readonly Record<string, unknown>[] {
    return this.sent.map((entry) => JSON.parse(entry) as Record<string, unknown>)
  }

  public find(method: string): Record<string, unknown> | undefined {
    return this.messages().findLast((entry) => entry.method === method)
  }
}

type Harness = {
  readonly context: EditorViewContributionContext
  readonly socket: StubSocket
  readonly client: LspClient
  readonly initializeParams: lsp.InitializeParams
  readonly diagnostics: readonly lsp.PublishDiagnosticsParams[]
  answerInitialize(capabilities?: lsp.ServerCapabilities): Promise<void>
  dispose(): void
}

async function narrowPlugin(options: Partial<LanguageServerPluginOptions> = {}): Promise<Harness> {
  StubSocket.reset()
  const diagnostics: lsp.PublishDiagnosticsParams[] = []
  // Held on an object rather than in a `let`: the assignment happens inside a callback, and a bare
  // local would be narrowed to `null` for the rest of this function whatever the callback did.
  const created: { context: LanguageServerConnectionContext | null } = { context: null }

  const plugin = createLanguageServerPlugin({
    webSocketRoute: 'ws://localhost/lsp',
    webSocketTransportOptions: { WebSocketCtor: StubSocket as unknown as LspWebSocketConstructor },
    onConnectionCreated: (context) => {
      created.context = context
    },
    onDiagnostics: (summary) => {
      diagnostics.push({ diagnostics: [...summary.diagnostics], uri: summary.uri ?? '' })
    },
    ...options,
  })

  const provider = activate(plugin)
  const context = viewContributionContext()
  const contribution = provider.createContribution(context)
  if (!contribution) throw new Error('missing contribution')
  await flushPromises()

  const socket = StubSocket.latest()
  if (!socket) throw new Error('the plugin never opened a socket')
  const connection = created.context
  if (!connection) throw new Error('onConnectionCreated never fired on the narrow factory')

  const initialize = socket.find('initialize')
  if (!initialize) throw new Error('missing initialize request')

  return {
    context,
    socket,
    client: connection.client,
    initializeParams: initialize.params as lsp.InitializeParams,
    diagnostics,
    dispose: () => contribution.dispose(),
    answerInitialize: async (capabilities = {}) => {
      socket.receive({
        jsonrpc: '2.0',
        id: initialize.id,
        result: {
          capabilities: { textDocumentSync: { openClose: true, change: 2 }, ...capabilities },
        },
      })
      await flushPromises()
    },
  }
}

describe('capabilities and clientInfo through the narrow factory', () => {
  it('reports a resolved modifier-hover destination through the narrow and set factories', async () => {
    const onDefinitionLinkHover = vi.fn()
    const harness = await narrowPlugin({ onDefinitionLinkHover })
    await harness.answerInitialize({ definitionProvider: true })
    harness.context.scrollElement.dispatchEvent(
      new PointerEvent('pointermove', { metaKey: true, buttons: 0 }),
    )
    await flushPromises()
    const request = harness.socket.find('textDocument/definition')
    expect(request).toBeDefined()
    const target = {
      uri: 'file:///src/helper.ts',
      range: { start: { line: 0, character: 0 }, end: { line: 0, character: 5 } },
    }

    harness.socket.receive({ jsonrpc: '2.0', id: request?.id, result: [target] })
    await flushPromises()

    await vi.waitFor(() =>
      expect(onDefinitionLinkHover).toHaveBeenCalledExactlyOnceWith({
        ...target,
        path: 'src/helper.ts',
      }),
    )
    harness.dispose()
  })

  it('registers and disposes the host document-sync controller with each lane', async () => {
    const controller = new LanguageServerDocumentSyncController()
    const dispose = vi.fn()
    const register = vi.spyOn(controller, 'register').mockReturnValue({ dispose })
    const harness = await narrowPlugin({ documentSync: { controller } })

    expect(register).toHaveBeenCalledOnce()
    harness.dispose()
    expect(dispose).toHaveBeenCalledOnce()
  })

  it('advertises WorkspaceEdit response capabilities only with a host callback', async () => {
    const withoutHost = await narrowPlugin()
    const withHost = await narrowPlugin({
      onApplyWorkspaceEdit: async () => ({ status: 'applied' }),
    })

    expect(withoutHost.initializeParams.capabilities.workspace?.workspaceEdit).toBeUndefined()
    expect(withHost.initializeParams.capabilities.workspace?.workspaceEdit).toBeDefined()
  })

  it('advertises documentChanges resources annotations line-ending normalization and failureHandling undo exactly', async () => {
    const harness = await narrowPlugin({
      onApplyWorkspaceEdit: async () => ({ status: 'applied' }),
    })

    expect(harness.initializeParams.capabilities.workspace?.workspaceEdit).toEqual({
      changeAnnotationSupport: { groupsOnLabel: true },
      documentChanges: true,
      failureHandling: 'undo',
      normalizesLineEndings: true,
      resourceOperations: ['create', 'rename', 'delete'],
    })
  })

  it('never advertises workspace applyEdit or snippet edit support', async () => {
    const harness = await narrowPlugin({
      capabilities: {
        workspace: {
          applyEdit: true,
          workspaceEdit: { documentChanges: true, failureHandling: 'transactional' },
        },
      },
      onApplyWorkspaceEdit: async () => ({ status: 'applied' }),
    })
    const workspace = harness.initializeParams.capabilities.workspace
    const workspaceEdit = workspace?.workspaceEdit as Record<string, unknown> | undefined

    expect(workspace?.applyEdit).toBeUndefined()
    expect(workspaceEdit?.snippetEditSupport).toBeUndefined()
    expect(workspaceEdit?.failureHandling).toBe('undo')
  })

  it('preserves semantic-token capability while adding workspace-edit capability', async () => {
    const semanticTokens: lsp.SemanticTokensClientCapabilities = {
      formats: ['relative'],
      requests: { full: true },
      tokenModifiers: ['readonly'],
      tokenTypes: ['variable'],
    }
    const harness = await narrowPlugin({
      capabilities: { textDocument: { semanticTokens } },
      onApplyWorkspaceEdit: async () => ({ status: 'applied' }),
    })

    expect(harness.initializeParams.capabilities.textDocument?.semanticTokens).toEqual(
      semanticTokens,
    )
    expect(harness.initializeParams.capabilities.workspace?.workspaceEdit).toBeDefined()
  })

  it('sends a host-supplied block verbatim in the initialize params', async () => {
    const capabilities: lsp.ClientCapabilities = {
      textDocument: {
        semanticTokens: {
          formats: ['relative'],
          requests: { full: { delta: true } },
          tokenModifiers: ['readonly'],
          tokenTypes: ['variable'],
        },
      },
    }
    const harness = await narrowPlugin({
      capabilities,
      clientInfo: { name: 'Zed', version: '1.2' },
    })

    expect(harness.initializeParams.capabilities.textDocument?.semanticTokens).toEqual(
      capabilities.textDocument?.semanticTokens,
    )
    expect(harness.initializeParams.clientInfo).toEqual({ name: 'Zed', version: '1.2' })
  })

  it('merges over the defaults instead of replacing them', async () => {
    const harness = await narrowPlugin({
      capabilities: {
        textDocument: {
          semanticTokens: {
            formats: ['relative'],
            requests: { full: true },
            tokenModifiers: [],
            tokenTypes: ['variable'],
          },
        },
      },
    })
    const declared = harness.initializeParams.capabilities

    expect(declared.textDocument?.semanticTokens?.tokenTypes).toEqual(['variable'])
    expect(declared.general?.positionEncodings).toEqual(['utf-16'])
    expect(declared.textDocument?.completion?.completionItem?.snippetSupport).toBe(true)
  })

  it('keeps the package name when the host names nobody', async () => {
    const harness = await narrowPlugin()

    expect(harness.initializeParams.clientInfo?.name).toBe('@singapore-editor/lsp')
    expect(harness.initializeParams.capabilities.textDocument?.semanticTokens).toBeUndefined()
  })
})

describe('the client handle the narrow factory hands out', () => {
  it('issues a request with a per-request timeout', async () => {
    const harness = await narrowPlugin()
    await harness.answerInitialize({
      semanticTokensProvider: { legend: { tokenTypes: [], tokenModifiers: [] }, full: true },
    })

    const response = harness.client.request(
      'textDocument/semanticTokens/full',
      {
        textDocument: { uri: 'file:///src/index.ts' },
      },
      { timeoutMs: 30_000 },
    )
    await flushPromises()

    const sent = harness.socket.find('textDocument/semanticTokens/full')
    expect(sent).toBeDefined()

    harness.socket.receive({ jsonrpc: '2.0', id: sent?.id, result: { data: [0, 0, 3, 0, 0] } })
    await expect(response).resolves.toEqual({ data: [0, 0, 3, 0, 0] })
  })

  /**
   * Cancellation reaches the wire rather than merely suppressing a response that has already been
   * computed: a server that honours `$/cancelRequest` abandons real work, which is the whole reason
   * a host needs this handle at all.
   */
  it('cancels an in-flight request through an AbortSignal', async () => {
    const harness = await narrowPlugin()
    await harness.answerInitialize()

    const abort = new AbortController()
    const response = harness.client.request(
      'textDocument/semanticTokens/full',
      {},
      {
        signal: abort.signal,
      },
    )
    await flushPromises()

    const sent = harness.socket.find('textDocument/semanticTokens/full')
    abort.abort()
    await flushPromises()

    const cancellation = harness.socket.find('$/cancelRequest')
    expect(cancellation?.params).toEqual({ id: sent?.id })
    await expect(response).rejects.toThrow()
  })
})

describe('host notification handlers', () => {
  it('invokes a handler for a method the connection does not install', async () => {
    const refreshed = vi.fn<LspNotificationHandler<LspClient>>(() => true)
    const harness = await narrowPlugin({
      notificationHandlers: { 'workspace/semanticTokens/refresh': refreshed },
    })
    await harness.answerInitialize()

    harness.socket.receive({
      jsonrpc: '2.0',
      method: 'workspace/semanticTokens/refresh',
      params: null,
    })
    await flushPromises()

    expect(refreshed).toHaveBeenCalledOnce()
  })

  /**
   * The whole diagnostics feature hangs off publishDiagnostics, so a host entry for that method is
   * merged around the plugin's rather than over it. Both run; neither is lost.
   */
  it('does not let a host handler displace publishDiagnostics', async () => {
    const observed = vi.fn<LspNotificationHandler<LspClient>>(() => true)
    const harness = await narrowPlugin({
      notificationHandlers: { 'textDocument/publishDiagnostics': observed },
    })
    await harness.answerInitialize()

    harness.socket.receive({
      jsonrpc: '2.0',
      method: 'textDocument/publishDiagnostics',
      params: {
        uri: 'file:///src/index.ts',
        diagnostics: [
          {
            range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } },
            message: 'boom',
            severity: 1,
          },
        ],
      },
    })
    await flushPromises()

    expect(observed).toHaveBeenCalledOnce()
    expect(harness.diagnostics.at(-1)?.diagnostics).toHaveLength(1)
  })
})

describe('document pull diagnostics', () => {
  it('pulls a pull-only lane into the composite and re-pulls after server refresh', async () => {
    const harness = await narrowPlugin()

    expect(harness.initializeParams.capabilities.textDocument?.diagnostic).toBeDefined()
    expect(harness.initializeParams.capabilities.workspace?.diagnostics?.refreshSupport).toBe(true)

    await harness.answerInitialize({
      diagnosticProvider: {
        identifier: 'eslint',
        interFileDependencies: false,
        workspaceDiagnostics: false,
      },
    })
    await flushPromises()

    const first = harness.socket.find('textDocument/diagnostic')
    expect(first?.params).toEqual({
      identifier: 'eslint',
      textDocument: { uri: 'file:///src/index.ts' },
    })

    harness.socket.receive({
      jsonrpc: '2.0',
      id: first?.id,
      result: {
        kind: 'full',
        resultId: 'eslint-1',
        items: [
          {
            message: 'pull-only diagnostic',
            range: { start: { line: 0, character: 0 }, end: { line: 0, character: 5 } },
            severity: 1,
          },
        ],
      },
    })
    await flushPromises()

    expect(harness.diagnostics.at(-1)?.diagnostics).toEqual([
      expect.objectContaining({ message: 'pull-only diagnostic' }),
    ])

    harness.socket.receive({
      jsonrpc: '2.0',
      id: 'diagnostic-refresh',
      method: 'workspace/diagnostic/refresh',
      params: null,
    })
    await flushPromises()

    const pulls = harness.socket
      .messages()
      .filter((message) => message.method === 'textDocument/diagnostic')
    expect(pulls).toHaveLength(2)
    expect(pulls[1]?.params).toEqual({
      identifier: 'eslint',
      previousResultId: 'eslint-1',
      textDocument: { uri: 'file:///src/index.ts' },
    })
    expect(
      harness.socket.messages().find((message) => message.id === 'diagnostic-refresh'),
    ).toMatchObject({ result: null })
  })
})

function activate(
  plugin: ReturnType<typeof createLanguageServerPlugin>,
): EditorViewContributionProvider {
  let provider: EditorViewContributionProvider | null = null
  const disposable = { dispose: () => undefined }

  plugin.activate(
    createTestPluginContext({
      registerViewContribution: (value) => {
        provider = value
        return disposable
      },
    }),
  )

  if (!provider) throw new Error('missing provider')
  return provider
}

function viewContributionContext(): EditorViewContributionContext {
  const element = document.createElement('div')
  return createTestViewContributionContext({
    container: element,
    scrollElement: element as unknown as HTMLDivElement,
    contentElement: element,
    highlightPrefix: 'editor-test',
    getSnapshot: () => snapshot(),
    textOffsetFromPoint: vi.fn(() => 0),
    getRangeClientRect: () => new DOMRect(0, 0, 1, 1),
  })
}

function snapshot(): EditorViewSnapshot {
  const fullText = 'const value = 1\n'
  return {
    ...documentSyncSnapshotFields(1),
    ...viewSnapshotStructuralFields(),
    documentId: 'src/index.ts',
    languageId: 'typescript',
    ...viewTextFields(fullText),
    textVersion: 1,
    tokens: EditorTokenStore.empty(),
    brackets: [],
    selections: [
      { anchorOffset: 0, headOffset: 0, startOffset: 0, endOffset: 0, affinity: 'after' },
    ],
    metrics: {} as EditorViewSnapshot['metrics'],
    lineCount: 2,
    contentWidth: 0,
    totalHeight: 0,
    tabSize: 4,
    foldMarkers: [],
    visibleRows: [],
    viewport: {
      scrollRow: 0,
      scrollTop: 0,
      scrollLeft: 0,
      scrollHeight: 0,
      scrollWidth: 0,
      clientHeight: 0,
      clientWidth: 0,
      visibleRange: { start: 0, end: 1 } as EditorViewSnapshot['viewport']['visibleRange'],
    },
  }
}

/**
 * The `semanticTokens` block is the only way a host gets hold of a layer: a layer needs a viewport,
 * a snapshot and a lifecycle, all of which belong to the view contribution, so the contribution
 * creates it and hands it over. Supplying no block creates nothing at all — a host that paints no
 * semantic colour does not pay for the feature existing.
 */
describe('the semantic token layer the narrow factory hands over', () => {
  type LayerHarness = {
    readonly delivered: {
      layer: SemanticTokenLayer
      documentId: string
      languageId: string | null
    }[]
    readonly requests: number[]
    readonly disposals: number[]
    readonly painted: string[]
    update(documentId: string | null, languageId: string | null): void
    dispose(): void
  }

  async function layerHarness(withBlock: boolean): Promise<LayerHarness> {
    const delivered: LayerHarness['delivered'] = []
    const requests: number[] = []
    const disposals: number[] = []
    const painted: string[] = []

    const plugin = createLanguageServerPlugin({
      webSocketRoute: 'ws://localhost/lsp',
      webSocketTransportOptions: {
        WebSocketCtor: StubSocket as unknown as LspWebSocketConstructor,
      },
      ...(withBlock
        ? {
            semanticTokens: {
              onRangeNeeded: (request) => requests.push(request.textVersion),
              onLayer: (layer, document) => {
                delivered.push({
                  layer,
                  documentId: document.documentId,
                  languageId: document.languageId,
                })
                const index = delivered.length - 1
                return { dispose: () => disposals.push(index) }
              },
            },
          }
        : {}),
    })

    let snapshot = layerSnapshot('src/index.ts', 'typescript', 1)
    const provider = activate(plugin)
    const contribution = provider.createContribution(layerContext(() => snapshot, painted))
    if (!contribution) throw new Error('missing contribution')
    await flushPromises()
    const socket = StubSocket.latest()
    const initialize = socket?.find('initialize')
    if (!socket || !initialize) throw new Error('missing initialize request')
    socket.receive({
      id: initialize.id,
      jsonrpc: '2.0',
      result: {
        capabilities: {
          semanticTokensProvider: { legend: { tokenModifiers: [], tokenTypes: [] } },
        },
      },
    })
    await flushPromises()

    return {
      delivered,
      requests,
      disposals,
      painted,
      update: (documentId, languageId) => {
        snapshot = layerSnapshot(documentId, languageId, snapshot.textVersion + 1)
        contribution.update(snapshot, 'document', null)
      },
      dispose: () => contribution.dispose(),
    }
  }

  it('delivers a layer the host can push to', async () => {
    const harness = await layerHarness(true)

    expect(harness.delivered).toHaveLength(1)
    expect(harness.delivered[0]?.documentId).toBe('src/index.ts')
    expect(harness.delivered[0]?.languageId).toBe('typescript')

    const result = harness.delivered[0]?.layer.push({
      documentId: 'src/index.ts',
      textVersion: 1,
      spans: [{ start: 0, end: 5, tokenType: 'keyword' }],
    })

    expect(result?.status).toBe('painted')
    expect(harness.painted).toHaveLength(1)
    harness.dispose()
  })

  it('creates nothing at all when the host supplies no block', async () => {
    const harness = await layerHarness(false)
    harness.update('src/index.ts', 'typescript')

    expect(harness.delivered).toHaveLength(0)
    expect(harness.requests).toHaveLength(0)
    expect(harness.painted).toHaveLength(0)
    harness.dispose()
  })

  /**
   * A layer never spans two documents or two language ids. The handle the host is holding is dead
   * from the moment either changes, and the replacement arrives as a *new* layer — which is why
   * `clear()` across a document change is a call on a disposed handle rather than a reset.
   */
  it('replaces the layer when the document changes, rather than re-pointing it', async () => {
    const harness = await layerHarness(true)
    harness.update('src/other.ts', 'typescript')

    expect(harness.delivered).toHaveLength(2)
    expect(harness.delivered[1]?.documentId).toBe('src/other.ts')
    expect(harness.disposals).toEqual([0])
    harness.dispose()
  })

  it('replaces it when only the language id changes', async () => {
    const harness = await layerHarness(true)
    harness.update('src/index.ts', 'javascript')

    expect(harness.delivered).toHaveLength(2)
    expect(harness.delivered[1]?.languageId).toBe('javascript')
    harness.dispose()
  })

  it('tears the layer down with the contribution', async () => {
    const harness = await layerHarness(true)
    harness.dispose()

    expect(harness.disposals).toEqual([0])
  })
})

function layerSnapshot(
  documentId: string | null,
  languageId: string | null,
  textVersion: number,
): EditorViewSnapshot {
  const fullText = 'const value = 1\nconst other = 2\n'
  const lineLength = 'const value = 1'.length + 1
  const rows: EditorVisibleRowSnapshot[] = [0, 1].map((row) => ({
    index: row,
    bufferRow: row,
    source: 'text' as EditorVisibleRowSnapshot['source'],
    startOffset: row * lineLength,
    endOffset: row * lineLength + lineLength - 1,
    text: '',
    kind: 'text' as const,
    primaryText: true,
    firstWrapSegment: true,
    top: row * 20,
    height: 20,
    leftSpacerWidth: 0,
    contentCursorLine: false,
    gutterNumberCursorLine: false,
    gutterCursorLineBackgroundLaneIds: [],
    mountedPaintSupport: 'replayable',
    chunks: [],
    foldMarker: null,
  }))

  return {
    ...documentSyncSnapshotFields(textVersion, documentId ?? 'no-document'),
    ...viewSnapshotStructuralFields(),
    documentId,
    languageId: languageId as EditorViewSnapshot['languageId'],
    ...viewTextFields(fullText),
    textVersion,
    tokens: EditorTokenStore.empty(),
    brackets: [],
    selections: [
      { anchorOffset: 0, headOffset: 0, startOffset: 0, endOffset: 0, affinity: 'after' },
    ],
    metrics: {} as EditorViewSnapshot['metrics'],
    lineCount: 2,
    contentWidth: 0,
    totalHeight: 0,
    tabSize: 4,
    foldMarkers: [],
    visibleRows: rows,
    viewport: {
      scrollRow: 0,
      scrollTop: 0,
      scrollLeft: 0,
      scrollHeight: 0,
      scrollWidth: 0,
      clientHeight: 0,
      clientWidth: 0,
      visibleRange: { start: 0, end: 2 } as EditorViewSnapshot['viewport']['visibleRange'],
    },
  }
}

function layerContext(
  getSnapshot: () => EditorViewSnapshot,
  painted: string[],
): EditorViewContributionContext {
  const element = document.createElement('div')
  return createTestViewContributionContext({
    container: element,
    scrollElement: element as unknown as HTMLDivElement,
    contentElement: element,
    highlightPrefix: 'editor-test-',
    getSnapshot,
    textOffsetFromPoint: vi.fn(() => 0),
    getRangeClientRect: () => new DOMRect(0, 0, 1, 1),
    setRangeHighlight: (name) => painted.push(name),
  })
}
