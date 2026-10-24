/*
 * The whole semantic-token seam, driven in one process.
 *
 * Everything Milestones 3-6 build is a contract with a host this repo does not contain, and a
 * contract tested only against literal arrays is proved self-consistent rather than implementable.
 * This worker is the only server the repo controls, so this is the only test in either repo that
 * runs `initialize` -> request -> decode -> resolve -> registered highlight group with nothing
 * stubbed between the worker and the layer: real TypeScript, the narrow `createLanguageServerPlugin`
 * factory, a host-built `capabilities` block, the shipped `decodeSemanticTokens`, and a layer the
 * plugin created and handed over through its `semanticTokens` block.
 *
 * One thing here is not the real article, and it does not sit on that path: the transport is a
 * stub socket that hands the worker module's own message handler the bytes a WebSocket would have
 * carried, because a `Worker` needs a bundler and the narrow factory speaks WebSocket only. The lib
 * files are the worker's bundled ones, so nothing reaches the network.
 */

import { createEditorTextBuffer, createEditorBufferSession } from '@singapore-editor/core/document'
import { acquireEditorDocumentAnalysis } from '@singapore-editor/core/internal/document-worker'
import { EditorTokenStore } from '@singapore-editor/core/syntax'
import type {
  EditorViewContribution,
  EditorViewContributionContext,
  EditorViewContributionProvider,
  EditorViewSnapshot,
  EditorVisibleRowSnapshot,
  SemanticTokenDropReason,
  SemanticTokenLayer,
  SemanticTokenPushResult,
  SemanticTokenRangeRequest,
  SemanticTokenSpan,
} from '@singapore-editor/core/extensions'
import type { VirtualizedTextHighlightStyle } from '@singapore-editor/core/rendering'
import { editorColorValue } from '@singapore-editor/core/rendering'
import type { LspClient, LspWebSocketConstructor, LspWebSocketLike } from '@singapore-editor/lsp'
import { semanticTokensClientCapability } from '@singapore-editor/lsp'
import { createLanguageServerPlugin, decodeSemanticTokens } from '@singapore-editor/lsp-plugin'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import type * as lsp from 'vscode-languageserver-protocol'
import {
  createTestPluginContext,
  createTestViewContributionContext,
} from '@singapore-editor/core/testing'

/**
 * A real TypeScript file, chosen so the fixture legend's three awkward shapes are all reachable.
 *
 * `Millis` is a type alias, which the legend names `typeAlias` and the theme does not know.
 * `elapsed` is a function and `now` is a method, which the legend names `function` at two distinct
 * indices. `started` is a local `const`, which TypeScript marks `readonly` and `local` on the same
 * token, and `drift` is a local `let`, which it marks `local` alone — so the two identifiers on line
 * 12 have to end up in different highlight groups.
 */
const FIXTURE = `export type Millis = number

export interface Clock {
  now(): Millis
}

export class SystemClock implements Clock {
  static readonly epoch: Millis = 0

  now(): Millis {
    const started = SystemClock.epoch
    let drift = 0
    drift += started
    return drift
  }
}

export function elapsed(clock: Clock, since: Millis): Millis {
  const now = clock.now()
  return now - since
}
`

const DOCUMENT_ID = 'src/index.ts'
const DOCUMENT_URI = 'file:///src/index.ts'
const ROW_HEIGHT = 20
/** The host's number, and there is exactly one of it (§C8). Small because this is a test. */
const VIEWPORT_DELAY_MS = 5
const REQUEST_TIMEOUT_MS = 30_000
/** `DocumentEditChain` keeps this many transitions; §C5's third branch is what happens past it. */
const EDIT_CHAIN_MAX_ENTRIES = 128

const FUNCTION_COLOR = editorColorValue('syntax.function')
const CONSTANT_COLOR = editorColorValue('syntax.constant')
const VARIABLE_COLOR = editorColorValue('syntax.variable')
const TYPE_COLOR = editorColorValue('syntax.type')

/**
 * The wire, in both directions, and the worker's own message handler.
 *
 * The worker was written for a `DedicatedWorkerGlobalScope`: it reads messages off `onmessage` and
 * writes them through `postMessage`, and it is imported rather than spawned here because a `Worker`
 * needs a bundler and the narrow plugin factory speaks WebSocket only. The handler is taken off the
 * global as soon as it is installed — a live `onmessage` keeps the test process open — and called
 * directly from the socket instead.
 */
const wire: {
  socket: StubSocket | null
  handleWorkerMessage: ((event: MessageEvent) => void) | null
} = { socket: null, handleWorkerMessage: null }

/**
 * Both hooks as they were before the worker was imported, captured so they can be put back.
 *
 * The environment is shared with whatever runs next, so a fixture that installs a `postMessage` of
 * its own and walks away leaves later tests posting into a socket that no longer exists.
 */
const original: {
  postMessage: typeof globalThis.postMessage
  onmessage: ((event: MessageEvent) => void) | null
} = { postMessage: globalThis.postMessage, onmessage: workerGlobal().onmessage }

beforeAll(async () => {
  original.postMessage = globalThis.postMessage
  original.onmessage = workerGlobal().onmessage
  await import('../src/typescriptLsp.worker')
  wire.handleWorkerMessage = workerGlobal().onmessage
  workerGlobal().onmessage = null
  globalThis.postMessage = ((message: unknown) => {
    wire.socket?.deliver(message)
  }) as typeof globalThis.postMessage
})

afterAll(() => {
  workerGlobal().onmessage = original.onmessage
  globalThis.postMessage = original.postMessage
  wire.socket = null
})

/** Read through a call so the checker does not narrow the global to what it held at import. */
function workerGlobal(): { onmessage: ((event: MessageEvent) => void) | null } {
  return globalThis as unknown as { onmessage: ((event: MessageEvent) => void) | null }
}

/**
 * A socket that carries JSON-RPC between the plugin's client and the worker module in one process.
 *
 * `hold()` queues what the worker has already computed instead of delivering it, which is how a
 * response is delayed past the edit-chain window without pretending the answer itself is fake.
 */
class StubSocket implements LspWebSocketLike {
  public readonly readyState = 1
  public readonly sent: string[] = []
  public readonly received: Record<string, unknown>[] = []

  readonly #listeners = new Map<string, Set<EventListener>>()
  #held: unknown[] | null = null

  public constructor() {
    wire.socket = this
  }

  public send(message: string): void {
    this.sent.push(message)
    // Straight into the worker module's own handler, which is the whole of the transport.
    wire.handleWorkerMessage?.(new MessageEvent('message', { data: JSON.parse(message) }))
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

  public hold(): void {
    this.#held = []
  }

  public release(): void {
    const held = this.#held ?? []
    this.#held = null
    for (const message of held) this.#dispatch(message)
  }

  public deliver(message: unknown): void {
    if (this.#held) {
      this.#held.push(message)
      return
    }

    this.#dispatch(message)
  }

  public sentMessages(): readonly Record<string, unknown>[] {
    return this.sent.map((entry) => JSON.parse(entry) as Record<string, unknown>)
  }

  #dispatch(message: unknown): void {
    this.received.push(message as Record<string, unknown>)
    const event = { data: JSON.stringify(message) } as unknown as Event
    for (const handler of this.#listeners.get('message') ?? []) handler(event)
  }
}

/**
 * The highlight groups the layer registered.
 *
 * The CSS highlight registry is maplike, so a Map reproduces its ordering faithfully; the ranges are
 * real `Range`s over the document text, which is what makes an assertion about *what got coloured*
 * readable rather than a list of offsets.
 */
class MockHighlight extends Set<Range> {
  public priority = 0
}

type PaintedGroup = {
  readonly highlight: MockHighlight
  readonly style: VirtualizedTextHighlightStyle
  readonly ranges: readonly { readonly start: number; readonly end: number }[]
}

/** The editor half of the harness: a document, its snapshots, and where the layer's paint lands. */
class EditorFixture {
  public text = FIXTURE
  public textVersion = 0

  public readonly painted = new Map<string, PaintedGroup>()
  public readonly context: EditorViewContributionContext

  readonly #buffer = createEditorTextBuffer(FIXTURE)
  readonly #session = createEditorBufferSession(this.#buffer)
  readonly #owner = acquireEditorDocumentAnalysis({ buffer: this.#buffer, documentId: DOCUMENT_ID })
  readonly #textNode: Text

  public constructor() {
    const container = document.createElement('div')
    this.#textNode = document.createTextNode(this.text)
    container.appendChild(this.#textNode)

    this.context = createTestViewContributionContext({
      container,
      scrollElement: container as unknown as HTMLDivElement,
      contentElement: container,
      highlightPrefix: 'editor-test-',
      getSnapshot: () => this.snapshot(),
      getDocumentContributions: () => this.#owner.analysis.contributions,
      textOffsetFromPoint: vi.fn(() => 0),
      getRangeClientRect: () => new DOMRect(0, 0, 1, 1),
      // Every edit this fixture makes is an insertion at offset zero, so a tracked set follows the
      // text by however much has been inserted since it was handed over. That is the whole of §C6
      // this document needs, and it is what makes a wrong-offset paint visible: an anchored group
      // still covers its identifier, a stale payload painted raw does not.
      trackRanges: (ranges) => {
        const insertedAtTracking = this.text.length
        return {
          resolve: () =>
            ranges.map((range) => {
              const shift = this.text.length - insertedAtTracking
              return { start: range.start + shift, end: range.end + shift }
            }),
        }
      },
      setRangeHighlight: (name, ranges, style) => {
        const highlight = new MockHighlight()
        highlight.priority = style.zIndex ?? 0
        for (const range of ranges) highlight.add(this.#domRange(range.start, range.end))
        this.painted.set(name, { highlight, ranges: ranges.map((range) => ({ ...range })), style })
      },
      clearRangeHighlight: (name) => {
        this.painted.delete(name)
      },
    })
  }

  public dispose(): void {
    this.#owner.dispose()
  }

  /** One character typed at the top of the file, which moves every span in it. */
  public type(character: string): void {
    this.#session.applyEdits([{ from: 0, to: 0, text: character }])
    this.text = this.#buffer.getTextSnapshot().readRange(0, this.#buffer.getTextSnapshot().length)
    this.textVersion = this.#buffer.getDocumentSyncPoint().textVersion
    this.#textNode.data = this.text
  }

  public lineStarts(): readonly number[] {
    const starts = [0]
    for (
      let index = this.text.indexOf('\n');
      index !== -1;
      index = this.text.indexOf('\n', index + 1)
    ) {
      starts.push(index + 1)
    }
    return starts
  }

  public snapshot(): EditorViewSnapshot {
    const lineStarts = this.lineStarts()
    const textSnapshot = this.#buffer.getTextSnapshot()
    const rows: EditorVisibleRowSnapshot[] = lineStarts.map((startOffset, index) => ({
      index,
      bufferRow: index,
      source: 'text' as EditorVisibleRowSnapshot['source'],
      startOffset,
      endOffset: (lineStarts[index + 1] ?? this.text.length + 1) - 1,
      text: '',
      kind: 'text' as const,
      primaryText: true,
      firstWrapSegment: true,
      top: index * ROW_HEIGHT,
      height: ROW_HEIGHT,
      leftSpacerWidth: 0,
      contentCursorLine: false,
      gutterNumberCursorLine: false,
      gutterCursorLineBackgroundLaneIds: [],
      mountedPaintSupport: 'replayable',
      chunks: [],
      foldMarker: null,
    }))

    return {
      documentId: DOCUMENT_ID,
      languageId: 'typescript' as EditorViewSnapshot['languageId'],
      textSnapshot,
      textVersion: this.textVersion,
      initialHighlightStatus: 'painted',
      syntaxStatus: 'ready',
      paintLayers: [],
      lineStarts,
      lineStartsView: {
        length: lineStarts.length,
        at: (index) => lineStarts[index],
        indexForOffset: (offset) => textSnapshot.lineAt(offset),
        firstIndexAtOrAfter: (offset) => {
          const index = lineStarts.findIndex((start) => start >= offset)
          return index === -1 ? lineStarts.length : index
        },
        toArray: () => lineStarts,
      },
      documentSyncPoint: this.#buffer.getDocumentSyncPoint(),
      changesSinceDocumentSyncPoint: (point, scope) =>
        this.#buffer.changesSinceDocumentSyncPoint(point, scope),
      tokens: EditorTokenStore.empty(),
      brackets: [],
      selections: [
        { anchorOffset: 0, headOffset: 0, startOffset: 0, endOffset: 0, affinity: 'after' },
      ],
      metrics: {} as EditorViewSnapshot['metrics'],
      lineCount: lineStarts.length,
      contentWidth: 0,
      totalHeight: rows.length * ROW_HEIGHT,
      gutterWidth: 0,
      gutterLayout: { leadingInset: 0, fixedWidth: 0, lanes: [] },
      tabSize: 2,
      foldMarkers: [],
      visibleRows: rows,
      viewport: {
        scrollRow: 0,
        scrollTop: 0,
        scrollLeft: 0,
        scrollHeight: rows.length * ROW_HEIGHT,
        scrollWidth: 0,
        clientHeight: rows.length * ROW_HEIGHT,
        clientWidth: 0,
        visibleRange: {
          start: 0,
          end: rows.length,
        } as EditorViewSnapshot['viewport']['visibleRange'],
      },
      toVisibleSnapshot() {
        return null
      },
    }
  }

  /** The text every painted range covers, in document order, for one resolved colour. */
  public textsColored(color: string): readonly string[] {
    const covered: { readonly start: number; readonly text: string }[] = []
    for (const group of this.painted.values()) {
      if (group.style.color !== color) continue
      for (const range of group.ranges) {
        covered.push({ start: range.start, text: this.text.slice(range.start, range.end) })
      }
    }

    return covered.sort((left, right) => left.start - right.start).map((entry) => entry.text)
  }

  #domRange(start: number, end: number): Range {
    const range = document.createRange()
    range.setStart(this.#textNode, Math.min(start, this.text.length))
    range.setEnd(this.#textNode, Math.min(end, this.text.length))
    return range
  }
}

type TokenRequest = {
  readonly documentId: string
  readonly textVersion: number
  readonly text: string
  readonly lineStarts: readonly number[]
}

type Harness = {
  readonly editor: EditorFixture
  readonly socket: StubSocket
  readonly client: LspClient
  readonly contribution: EditorViewContribution
  readonly layer: SemanticTokenLayer
  readonly legend: lsp.SemanticTokensLegend
  readonly demands: readonly SemanticTokenRangeRequest[]
  readonly resyncs: readonly SemanticTokenDropReason[]
  readonly pushes: readonly SemanticTokenPushResult[]
  readonly initializeParams: lsp.InitializeParams
  tokens(range?: lsp.Range): Promise<{ data: number[]; spans: readonly SemanticTokenSpan[] }>
  paint(range?: lsp.Range): Promise<SemanticTokenPushResult>
  /** The house shape: cancel whatever is in flight, ask again, and drop an answer that is not the
   * latest one asked for. A payload the controller discards never reaches `push`. */
  demand(): void
  dispose(): void
}

describe('the TypeScript worker and the semantic token layer, end to end', () => {
  const harnesses: Harness[] = []

  afterEach(() => {
    for (const harness of harnesses.splice(0)) harness.dispose()
  })

  async function connect(
    semanticTokens: { readonly scopeAliases?: Readonly<Record<string, string>> } = {},
  ): Promise<Harness> {
    const editor = new EditorFixture()
    const demands: SemanticTokenRangeRequest[] = []
    const resyncs: SemanticTokenDropReason[] = []
    const pushes: SemanticTokenPushResult[] = []
    // Held on objects rather than in bare locals: every one of these is assigned inside a callback,
    // and a `let` initialised to null would be narrowed to `null` for the rest of this function
    // whatever the callback did with it.
    const handed: { layer: SemanticTokenLayer | null } = { layer: null }
    const connected: { client: LspClient | null } = { client: null }

    const plugin = createLanguageServerPlugin({
      webSocketRoute: 'ws://localhost/typescript',
      webSocketTransportOptions: {
        WebSocketCtor: StubSocket as unknown as LspWebSocketConstructor,
      },
      initializationOptions: { diagnosticDelayMs: 0 },
      // The host builds the block and passes it in: this editor declares none by default, and a
      // server only answers a client that asked (§C3).
      capabilities: semanticTokensClientCapability({ requests: { full: true, range: true } }),
      clientInfo: { name: '@singapore-editor/typescript-lsp conformance fixture' },
      semanticTokens: {
        ...semanticTokens,
        viewportDelayMs: VIEWPORT_DELAY_MS,
        onRangeNeeded: (request) => demands.push(request),
        onResyncRequired: (reason) => resyncs.push(reason),
        onLayer: (layer) => {
          handed.layer = layer
        },
      },
      onConnectionCreated: (context) => {
        connected.client = context.client
      },
    })

    const contribution = activate(plugin).createContribution(editor.context)
    if (!contribution) throw new Error('the plugin created no view contribution')

    const socket = wire.socket
    if (!socket) throw new Error('the plugin never opened a socket')
    const client = connected.client
    if (!client) throw new Error('onConnectionCreated never fired on the narrow factory')

    await waitFor(() => client.initialized, 'the worker never answered initialize')
    // The document is opened once the client is ready; the notification issued before that is
    // dropped by design, and the workspace re-sends it on connect.
    contribution.update(editor.snapshot(), 'document', null)
    await flushPromises()

    const provider = client.serverCapabilities?.semanticTokensProvider
    if (!provider || !('legend' in provider)) {
      throw new Error('the worker advertised no semanticTokensProvider')
    }

    const initialize = socket.sentMessages().find((message) => message.method === 'initialize')
    const inFlight: { id: number | string | null } = { id: null }

    const harness: Harness = {
      editor,
      socket,
      client,
      contribution,
      legend: provider.legend,
      demands,
      resyncs,
      pushes,
      initializeParams: initialize?.params as lsp.InitializeParams,
      get layer(): SemanticTokenLayer {
        const layer = handed.layer
        if (!layer) throw new Error('the plugin handed over no layer')
        return layer
      },
      tokens: (range) => requestTokens(client, provider.legend, editor, range),
      paint: async (range) => {
        const request = snapshotRequest(editor)
        const { spans } = await requestTokens(client, provider.legend, editor, range)
        const result = pushTokens(harness.layer, request, spans)
        pushes.push(result)
        return result
      },
      demand: () => {
        const request = snapshotRequest(editor)
        const handle = client.requestHandle<lsp.SemanticTokens>(
          'textDocument/semanticTokens/full',
          { textDocument: { uri: DOCUMENT_URI } },
          { timeoutMs: REQUEST_TIMEOUT_MS },
        )
        inFlight.id = handle.id
        void handle.response
          .then((result) => {
            // The request-id half of `documentHighlightController`'s staleness check: an answer
            // that is not the one most recently asked for is dropped by the host and never reaches
            // the layer at all. The other two halves — disposal and document identity — the layer
            // answers itself, in §C5's terms, which is why a host-side copy of them would be a
            // second opinion on a question the verdict already settles.
            if (inFlight.id !== handle.id) return
            const spans = decodeSemanticTokens(result.data, provider.legend, {
              lineStarts: request.lineStarts,
              textLength: request.text.length,
            }).spans
            pushes.push(pushTokens(harness.layer, request, spans))
          })
          .catch(ignoreCancellation)
      },
      dispose: () => {
        contribution.dispose()
        editor.dispose()
      },
    }

    harnesses.push(harness)
    return harness
  }

  it('paints semantic colour over a real TypeScript file, from initialize to a highlight group', async () => {
    const harness = await connect()

    expect(harness.initializeParams.capabilities.textDocument?.semanticTokens?.requests).toEqual({
      full: true,
      range: true,
    })

    const result = await harness.paint()

    expect(result.status).toBe('painted')
    expect(harness.editor.painted.size).toBeGreaterThan(1)
    // The function colour covers the interface member, the method, the call and the free function —
    // and nothing else, which is the whole chain: worker classification, LSP encoding, the shipped
    // decoder, the scope trie, a registered highlight group.
    expect(harness.editor.textsColored(FUNCTION_COLOR)).toEqual(['now', 'now', 'elapsed', 'now'])
  })

  it('decodes the legend name that appears at two indices, at both of them', async () => {
    const harness = await connect()
    const { data, spans } = await harness.tokens()

    expect(harness.legend.tokenTypes[10]).toBe('function')
    expect(harness.legend.tokenTypes[11]).toBe('function')
    expect(tokenTypeIndices(data)).toEqual(expect.arrayContaining([10, 11]))

    // `elapsed` arrives at index 10 and the method `now` at index 11. A decoder that inverted the
    // legend into a name-to-index map would resolve one of them through the other's index.
    expect(spanAt(spans, harness.editor.text.indexOf('elapsed'))?.tokenType).toBe('function')
    expect(spanAt(spans, harness.editor.text.indexOf('now(): Millis {'))?.tokenType).toBe(
      'function',
    )

    await harness.paint()
    expect(harness.editor.textsColored(FUNCTION_COLOR)).toContain('elapsed')
  })

  it('ranks the legend modifier the editor puts last below the one beside it', async () => {
    const harness = await connect()
    await harness.paint()

    // `started` here is `readonly` and `local`; `drift` beside it is `local` alone. The editor's
    // canonical precedence puts `readonly` above `local`, so two identifiers on one line resolve to
    // different scopes and land in different groups — the constant colour and the variable colour.
    const text = harness.editor.text
    const line = text.indexOf('drift += started')
    expect(colorAt(harness.editor, line + 'drift += '.length)).toBe(CONSTANT_COLOR)
    expect(colorAt(harness.editor, line)).toBe(VARIABLE_COLOR)

    // The declaration site of that same constant is coloured the same as every reference to it.
    // TypeScript sends `{declaration, readonly, local}` there and `{readonly, local}` here, and
    // exactly one modifier reaches the scope — so which one the precedence picks decides whether one
    // symbol has one colour. Picking `declaration`, which carries no rule and therefore resolves to
    // the bare `variable`, painted the declaration site as a plain variable and overpainted the
    // constant colour the syntactic layer had already put there: semantic colour that made the file
    // worse than leaving the feature off.
    expect(colorAt(harness.editor, text.indexOf('const started') + 'const '.length)).toBe(
      CONSTANT_COLOR,
    )
  })

  it('paints nothing for a type name the theme does not know, and says which one', async () => {
    const harness = await connect()
    const result = await harness.paint()

    expect(result).toMatchObject({ status: 'painted', unresolvedTypeNames: ['typeAlias'] })
    expect(paintedTexts(harness.editor)).not.toContain('Millis')
  })

  it('paints the aliased colour once the host supplies a scopeAliases entry', async () => {
    const harness = await connect({ scopeAliases: { typeAlias: 'type' } })
    const result = await harness.paint()

    expect(result).toMatchObject({ status: 'painted', unresolvedTypeNames: [] })
    expect(harness.editor.textsColored(TYPE_COLOR)).toEqual([
      'Millis',
      'Millis',
      'Millis',
      'Millis',
      'Millis',
      'Millis',
    ])
  })

  it('posts no response at all for a request $/cancelRequest names in flight', async () => {
    const harness = await connect()
    // Warm the service first, so the window this cancellation lands in is the request's own and not
    // the one-off cost of building a language service.
    await harness.tokens()

    const handle = harness.client.requestHandle<lsp.SemanticTokens>(
      'textDocument/semanticTokens/full',
      { textDocument: { uri: DOCUMENT_URI } },
      { timeoutMs: REQUEST_TIMEOUT_MS },
    )
    handle.response.catch(ignoreCancellation)
    handle.cancel()

    const sent = harness.socket.sentMessages()
    // The request really went out and the cancellation really went out after it: this is a request
    // the worker was asked to do work for and then told to abandon, not a response suppressed on
    // the client side.
    expect(sent.some((message) => message.id === handle.id)).toBe(true)
    expect(sent.findLast((message) => message.method === '$/cancelRequest')?.params).toEqual({
      id: handle.id,
    })

    // The worker answers in the order it was asked, so an answer to a later request is proof that
    // the earlier one has already run to the point where it would have posted.
    await harness.tokens()
    expect(harness.socket.received.filter((message) => message.id === handle.id)).toEqual([])
  })

  it('answers a range with the tokens in it, counting deltaLine from line zero', async () => {
    const harness = await connect()
    const lineStarts = harness.editor.lineStarts()
    const { data, spans } = await harness.tokens({
      start: { line: 10, character: 0 },
      end: { line: 14, character: 0 },
    })

    // The first tuple's deltaLine is absolute from the top of the document, not from the top of the
    // request. Encoding it relative to the range start is invisible until a host scrolls, and then
    // every span in the answer paints a screenful too high.
    expect(data[0]).toBe(10)
    expect(spans.length).toBeGreaterThan(0)
    for (const span of spans) {
      expect(span.start).toBeGreaterThanOrEqual(lineStarts[10] as number)
      expect(span.end).toBeLessThanOrEqual(lineStarts[14] as number)
    }
    expect(spans.map((span) => harness.editor.text.slice(span.start, span.end))).toEqual([
      'started',
      'SystemClock',
      'epoch',
      'drift',
      'drift',
      'started',
      'drift',
    ])
  })

  it('fires the demand signal once per viewport question, coalesced by the host delay', async () => {
    const harness = await connect()
    await settle()

    expect(harness.demands.length).toBeGreaterThan(0)
    expect(harness.demands.at(-1)).toMatchObject({ documentId: DOCUMENT_ID, start: 0 })
  })

  /**
   * §C5's third branch, which has no other way to be tested.
   *
   * Ten keystrokes with the worker's answers held, then a burst long enough to push the stamped
   * version out of the edit chain. The host discards every answer but the most recent, so exactly
   * one payload reaches the layer — stamped at a version the chain can no longer reach.
   */
  it('drops a payload the edit chain can no longer reach, once, and paints nothing wrong', async () => {
    const harness = await connect()
    await harness.paint()
    const paintedBefore = paintedTexts(harness.editor)
    expect(paintedBefore).toContain('elapsed')

    harness.socket.hold()
    for (let keystroke = 0; keystroke < 10; keystroke += 1) {
      harness.editor.type(' ')
      contributionUpdate(harness, 'content')
      harness.demand()
      await settle()
    }

    const demandsBeforeBurst = harness.demands.length
    // A burst inside one debounce window: the layer coalesces it into a single question, so the
    // request stamped ten keystrokes ago is still the one in flight while the chain rolls over.
    for (let keystroke = 0; keystroke < EDIT_CHAIN_MAX_ENTRIES + 2; keystroke += 1) {
      harness.editor.type(' ')
      contributionUpdate(harness, 'content')
    }
    expect(harness.demands).toHaveLength(demandsBeforeBurst)

    harness.socket.release()
    await settle()

    expect(harness.resyncs).toEqual(['version-too-old'])
    expect(harness.pushes.filter((push) => push.status === 'dropped')).toHaveLength(1)
    // Nothing was painted from the stale payload: the groups still cover the identifiers they
    // covered before, which they only can because they were anchored rather than repainted.
    expect(paintedTexts(harness.editor)).toEqual(paintedBefore)
    expect(harness.editor.textsColored(FUNCTION_COLOR)).toEqual(['now', 'now', 'elapsed', 'now'])
  }, 30_000)
})

function contributionUpdate(harness: Harness, kind: 'content' | 'document'): void {
  harness.contribution.update(harness.editor.snapshot(), kind, null)
}

async function requestTokens(
  client: LspClient,
  legend: lsp.SemanticTokensLegend,
  editor: EditorFixture,
  range: lsp.Range | undefined,
): Promise<{ data: number[]; spans: readonly SemanticTokenSpan[] }> {
  const request = snapshotRequest(editor)
  const result = await client.request<lsp.SemanticTokens>(
    range ? 'textDocument/semanticTokens/range' : 'textDocument/semanticTokens/full',
    range
      ? { textDocument: { uri: DOCUMENT_URI }, range }
      : { textDocument: { uri: DOCUMENT_URI } },
    { timeoutMs: REQUEST_TIMEOUT_MS },
  )
  const decoded = decodeSemanticTokens(result.data, legend, {
    lineStarts: request.lineStarts,
    textLength: request.text.length,
  })

  return { data: result.data, spans: decoded.spans }
}

function pushTokens(
  layer: SemanticTokenLayer,
  request: TokenRequest,
  spans: readonly SemanticTokenSpan[],
): SemanticTokenPushResult {
  return layer.push({
    documentId: request.documentId,
    textVersion: request.textVersion,
    spans,
  })
}

/** What the host records at the moment it issues a request, and stamps on the payload (§C5). */
function snapshotRequest(editor: EditorFixture): TokenRequest {
  return {
    documentId: DOCUMENT_ID,
    textVersion: editor.textVersion,
    text: editor.text,
    lineStarts: editor.lineStarts(),
  }
}

function paintedTexts(editor: EditorFixture): readonly string[] {
  const covered: { readonly start: number; readonly text: string }[] = []
  for (const group of editor.painted.values()) {
    for (const range of group.ranges) {
      covered.push({ start: range.start, text: editor.text.slice(range.start, range.end) })
    }
  }

  return covered.sort((left, right) => left.start - right.start).map((entry) => entry.text)
}

/** The resolved colour of the group holding a span that starts here, if any group does. */
function colorAt(editor: EditorFixture, start: number): string | undefined {
  for (const group of editor.painted.values()) {
    if (group.ranges.some((range) => range.start === start)) return group.style.color
  }

  return undefined
}

/** The `tokenTypeIndex` of every tuple, which is the fourth of each five. */
function tokenTypeIndices(data: readonly number[]): readonly number[] {
  return data.filter((_, index) => index % 5 === 3)
}

function spanAt(spans: readonly SemanticTokenSpan[], start: number): SemanticTokenSpan | undefined {
  return spans.find((span) => span.start === start)
}

function ignoreCancellation(): void {
  return undefined
}

function activate(
  plugin: ReturnType<typeof createLanguageServerPlugin>,
): EditorViewContributionProvider {
  const captured: { provider: EditorViewContributionProvider | null } = { provider: null }
  const disposable = { dispose: () => undefined }

  plugin.activate(
    createTestPluginContext({
      registerViewContribution: (value) => {
        captured.provider = value
        return disposable
      },
    }),
  )

  const provider = captured.provider
  if (!provider) throw new Error('the plugin registered no view contribution provider')
  return provider
}

const flushPromises = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))

/** Long enough for the host's viewport delay to elapse and for a held answer to be handled. */
const settle = (): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, VIEWPORT_DELAY_MS * 4))

async function waitFor(predicate: () => boolean, message: string): Promise<void> {
  const deadline = Date.now() + 20_000
  while (Date.now() < deadline) {
    if (predicate()) return
    await flushPromises()
  }

  throw new Error(message)
}
