import type {
  SemanticTokenLayer,
  SemanticTokenPayload,
  SemanticTokenPushResult,
} from '@singapore-editor/core/extensions'
import type { LanguageServerConnectionContext } from '@singapore-editor/lsp-plugin'
import { arrayLspLineStarts, LspRequestCancelledError, LspWorkspace } from '@singapore-editor/lsp'
import { createStringTextSnapshot } from '@singapore-editor/core/document'
import { afterEach, beforeEach, describe, vi } from 'vitest'
import { test as it, expect } from '../../../../test/fixtures'
import { fileDocumentKey, filesystemPath } from '@/lib/documents/utils/identity'

import { SemanticTokenController } from '@/features/editor/state/semantic-token-controller'
import { log } from '@/lib/client-logging'

const DOCUMENT_ID = fileDocumentKey(filesystemPath('/repo/src/lib.rs'))
const URI = 'file:///repo/src/lib.rs'
const TEXT = Array.from({ length: 200 }, (_, line) => `let value_${line} = ${line};`).join('\n')

/**
 * The controller reads its own switch on every request, through the same boot
 * mirror the rest of the app reads outside React. Seeded rather than stubbed:
 * `readSettingsMirror` validates per key against the real registry, so a fake
 * would be testing a shape the product does not have.
 */
function seedSettings(values: Record<string, unknown>) {
  localStorage.setItem(
    'platform.settings-boot-mirror.v1',
    JSON.stringify({ 'lsp.semanticTokens.enabled': true, ...values }),
  )
}

type FakeLayer = SemanticTokenLayer & {
  readonly pushes: SemanticTokenPayload[]
  clears: number
  verdict: SemanticTokenPushResult
}

function fakeLayer(): FakeLayer {
  const layer: FakeLayer = {
    clears: 0,
    pushes: [],
    verdict: {
      paintedSpans: 1,
      projectedThroughEdits: 0,
      status: 'painted',
      unresolvedTypeNames: [],
    },
    clear: () => {
      layer.clears += 1
    },
    dispose: () => {},
    push: (payload) => {
      layer.pushes.push(payload)
      return layer.verdict
    },
  }

  return layer
}

type RecordedRequest = {
  method: string
  params: unknown
  /** Recorded, not dropped: the timeout and the abort signal are policy this repo owns. */
  options: { timeoutMs?: number; signal?: AbortSignal }
}

type FakeConnection = {
  readonly context: LanguageServerConnectionContext
  readonly requests: RecordedRequest[]
  /** Resolves the pending request, so a test can interleave against an in-flight one. */
  settle: () => void
}

/**
 * A real `LspWorkspace` holding a real document, behind a client that records
 * what was asked. The workspace is the app's own; only the socket at the far end
 * is replaced, because a language server is the outside world.
 */
function fakeConnection(
  serverCapabilities: unknown,
  text: string = TEXT,
  respond: () => unknown = () => ({ data: [0, 0, 3, 0, 0] }),
): FakeConnection {
  const workspace = new LspWorkspace()
  workspace.openDocumentSnapshot({
    languageId: 'rust',
    lineStarts: arrayLspLineStarts(lineStartOffsets(text)),
    sourceRevision: 0,
    sourceSegment: {},
    textSnapshot: createStringTextSnapshot(text),
    uri: URI,
  })
  const requests: RecordedRequest[] = []
  const settlers: (() => void)[] = []

  const client = {
    request: (
      method: string,
      params: unknown,
      options: { timeoutMs?: number; signal?: AbortSignal } = {},
    ) => {
      requests.push({ method, options, params })
      return new Promise((resolve, reject) => {
        // Honour the abort the way the real client does, so a test that cancels
        // sees a rejection rather than a resolution nothing was waiting for.
        options.signal?.addEventListener('abort', () => reject(new LspRequestCancelledError()))
        settlers.push(() => resolve(respond()))
      })
    },
    serverCapabilities,
    workspace,
  }

  return {
    context: { client, workspace } as unknown as LanguageServerConnectionContext,
    requests,
    settle: () => {
      for (const resolve of settlers.splice(0)) resolve()
    },
  }
}

function lineStartOffsets(text: string): number[] {
  const starts = [0]
  for (let index = text.indexOf('\n'); index !== -1; index = text.indexOf('\n', index + 1)) {
    starts.push(index + 1)
  }
  return starts
}

const RUST_LIKE = {
  semanticTokensProvider: {
    full: { delta: true },
    legend: { tokenModifiers: [], tokenTypes: ['variable'] },
    range: true,
  },
}

const NO_RANGE = {
  semanticTokensProvider: {
    full: { delta: true },
    legend: { tokenModifiers: [], tokenTypes: ['variable'] },
    range: false,
  },
}

function demand(overrides: Partial<{ textVersion: number; start: number; end: number }> = {}) {
  return {
    documentId: DOCUMENT_ID,
    end: 400,
    start: 0,
    textVersion: 1,
    ...overrides,
  }
}

function attached(serverCapabilities: unknown, serverId = 'rust', text: string = TEXT) {
  const controller = new SemanticTokenController({ serverId })
  const connection = fakeConnection(serverCapabilities, text)
  const layer = fakeLayer()
  controller.attachConnection(connection.context)
  controller.attachLayer(layer, { documentId: DOCUMENT_ID, languageId: 'rust' }, URI)

  return { connection, controller, layer }
}

/**
 * The debug events the controller emitted, captured by spying on the one method
 * rather than replacing the logging module: what is under test is which outcome
 * it reported, and a stand-in module would let the real event shape drift.
 */
let debugEvents: Record<string, unknown>[] = []

function loggedRequestOutcomes(): readonly unknown[] {
  return debugEvents
    .filter((event) => event.action === 'lsp.semanticTokens.request')
    .map((event) => event.outcome)
}

beforeEach(() => {
  seedSettings({})
  vi.useFakeTimers()
  debugEvents = []
  vi.spyOn(log, 'debug').mockImplementation((event: unknown) => {
    if (event && typeof event === 'object') debugEvents.push(event as Record<string, unknown>)
  })
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
  localStorage.clear()
})

describe('SemanticTokenController request policy', () => {
  it('asks immediately for a document that just arrived', async () => {
    const { connection, controller } = attached(RUST_LIKE)

    controller.handleRangeNeeded(demand())
    await vi.advanceTimersByTimeAsync(0)

    expect(connection.requests).toHaveLength(1)
    expect(connection.requests[0]?.method).toBe('textDocument/semanticTokens/range')
    expect(connection.requests[0]?.params).toMatchObject({ textDocument: { uri: URI } })
  })

  it('waits out a burst of typing before asking again', async () => {
    const { connection, controller } = attached(RUST_LIKE)
    controller.handleRangeNeeded(demand())
    await vi.advanceTimersByTimeAsync(0)

    controller.handleRangeNeeded(demand({ textVersion: 2 }))
    controller.handleRangeNeeded(demand({ textVersion: 3 }))
    controller.handleRangeNeeded(demand({ textVersion: 4 }))
    await vi.advanceTimersByTimeAsync(240)

    expect(connection.requests).toHaveLength(1)

    await vi.advanceTimersByTimeAsync(20)

    // One question per pause, not one per keystroke.
    expect(connection.requests).toHaveLength(2)
  })

  it('rate-limits a scroll harder than it rate-limits typing', async () => {
    const { connection, controller } = attached(RUST_LIKE)
    controller.handleRangeNeeded(demand())
    await vi.advanceTimersByTimeAsync(0)

    controller.handleRangeNeeded(demand({ end: 900, start: 500 }))
    await vi.advanceTimersByTimeAsync(90)
    expect(connection.requests).toHaveLength(1)

    await vi.advanceTimersByTimeAsync(20)
    expect(connection.requests).toHaveLength(2)
  })

  /**
   * The worst thing this controller could accidentally do. clangd refuses a
   * range outright, so its whole-file answer already covers every viewport;
   * treating a scroll as a trigger would turn one 78 KB payload into a 78 KB
   * payload per scroll event.
   */
  it('never re-asks a range-less server on scroll', async () => {
    const { connection, controller } = attached(NO_RANGE, 'clangd')
    controller.handleRangeNeeded(demand())
    await vi.advanceTimersByTimeAsync(0)

    expect(connection.requests).toHaveLength(1)
    expect(connection.requests[0]?.method).toBe('textDocument/semanticTokens/full')

    controller.handleRangeNeeded(demand({ end: 900, start: 500 }))
    await vi.advanceTimersByTimeAsync(1_000)

    expect(connection.requests).toHaveLength(1)
  })

  it('still re-asks a range-less server when the text changes', async () => {
    const { connection, controller } = attached(NO_RANGE, 'clangd')
    controller.handleRangeNeeded(demand())
    await vi.advanceTimersByTimeAsync(0)

    controller.handleRangeNeeded(demand({ textVersion: 2 }))
    await vi.advanceTimersByTimeAsync(300)

    expect(connection.requests).toHaveLength(2)
  })

  /**
   * gopls v0.21.0 answers a whole-file request over 100 000 bytes with an error
   * the user must never see, while a range request against the same file
   * succeeds. Above the cap, range is not an optimization.
   */
  it('refuses a whole-file request past a server that measured a size cliff', async () => {
    // Over 100 000 bytes, which is the number gopls itself refuses at.
    const huge = 'package main\n'.repeat(9_000)
    expect(huge.length).toBeGreaterThan(100_000)
    const fullOnly = {
      semanticTokensProvider: { full: true, legend: { tokenModifiers: [], tokenTypes: ['x'] } },
    }
    const { connection, controller } = attached(fullOnly, 'gopls', huge)

    controller.handleResyncRequired('document-changed')
    await vi.advanceTimersByTimeAsync(0)

    // No request at all, rather than one that answers with an error the user
    // would have to be shown.
    expect(connection.requests).toEqual([])
  })

  it('still answers a viewport with a range on the same oversized file', async () => {
    const huge = 'package main\n'.repeat(9_000)
    const rangeCapable = {
      semanticTokensProvider: {
        full: true,
        legend: { tokenModifiers: [], tokenTypes: ['x'] },
        range: true,
      },
    }
    const { connection, controller } = attached(rangeCapable, 'gopls', huge)

    controller.handleRangeNeeded(demand())
    await vi.advanceTimersByTimeAsync(0)

    // The cap governs `full` only. Whatever is on screen still gets colour.
    expect(connection.requests[0]?.method).toBe('textDocument/semanticTokens/range')
  })

  it('sends nothing at all while the feature is switched off', async () => {
    seedSettings({ 'lsp.semanticTokens.enabled': false })
    const { connection, controller } = attached(RUST_LIKE)

    controller.handleRangeNeeded(demand())
    await vi.advanceTimersByTimeAsync(500)

    expect(connection.requests).toEqual([])
  })

  it('honours a per-server override over the server default', async () => {
    seedSettings({ 'lsp.semanticTokens.servers': { rust: false } })
    const { connection, controller } = attached(RUST_LIKE)

    controller.handleRangeNeeded(demand())
    await vi.advanceTimersByTimeAsync(500)

    expect(connection.requests).toEqual([])
  })

  /**
   * The layer and the document sync are two contributions updating on the same
   * tick with no ordering between them, so a demand can arrive before the uri is
   * open. Asking anyway would decode against a zero-length snapshot, drop every
   * tuple past the end of it, and push an empty span set — which paints nothing
   * and therefore blanks whatever was on screen.
   */
  it('asks nothing before the document sync has opened the uri', async () => {
    const controller = new SemanticTokenController({ serverId: 'rust' })
    const workspace = new LspWorkspace()
    const requests: { method: string; params: unknown }[] = []
    const client = {
      request: (method: string, params: unknown) => {
        requests.push({ method, params })
        return Promise.resolve({ data: [] })
      },
      serverCapabilities: RUST_LIKE,
      workspace,
    }
    const layer = fakeLayer()
    controller.attachConnection({ client, workspace } as unknown as LanguageServerConnectionContext)
    controller.attachLayer(layer, { documentId: DOCUMENT_ID, languageId: 'rust' }, URI)

    controller.handleRangeNeeded(demand())
    await vi.advanceTimersByTimeAsync(500)

    expect(requests).toEqual([])
    expect(layer.pushes).toEqual([])
  })

  it('turns a server on that has no row of its own', async () => {
    // A server nobody has reviewed is off whatever the master switch says, so
    // the `true` direction is the one a user reaches for, and it has to work.
    seedSettings({ 'lsp.semanticTokens.servers': { unreviewed: true } })
    const { connection, controller } = attached(RUST_LIKE, 'unreviewed')

    controller.handleRangeNeeded(demand())
    await vi.advanceTimersByTimeAsync(0)

    expect(connection.requests).toHaveLength(1)
  })

  it('leaves a server with no row of its own off even with the feature on', async () => {
    const { connection, controller } = attached(RUST_LIKE, 'unreviewed')

    controller.handleRangeNeeded(demand())
    await vi.advanceTimersByTimeAsync(500)

    expect(connection.requests).toEqual([])
  })

  it('turns a reviewed server off when its own row is overridden', async () => {
    // The direction that matters now that typescript ships on: one server whose
    // colour a user dislikes has to be switchable without losing the feature.
    seedSettings({ 'lsp.semanticTokens.servers': { typescript: false } })
    const { connection, controller } = attached(RUST_LIKE, 'typescript')

    controller.handleRangeNeeded(demand())
    await vi.advanceTimersByTimeAsync(500)

    expect(connection.requests).toEqual([])
  })

  it('asks a reviewed server without being told to', async () => {
    const { connection, controller } = attached(RUST_LIKE, 'typescript')

    controller.handleRangeNeeded(demand())
    await vi.advanceTimersByTimeAsync(0)

    expect(connection.requests).toHaveLength(1)
  })

  /**
   * The first demand fires as soon as the view has a viewport, which is well
   * before a websocket has been answered — and the layer never repeats a
   * question, because its demand signal is deduplicated on
   * `documentId:textVersion:start:end`. Without a retry the file simply stays
   * uncoloured until the user scrolls or types.
   */
  it('re-asks the demand it lost while initialize was still in flight', async () => {
    const controller = new SemanticTokenController({ serverId: 'rust' })
    const connection = fakeConnection(undefined)
    const layer = fakeLayer()
    controller.attachConnection(connection.context)
    controller.attachLayer(layer, { documentId: DOCUMENT_ID, languageId: 'rust' }, URI)

    controller.handleRangeNeeded(demand())
    await vi.advanceTimersByTimeAsync(500)
    expect(connection.requests).toEqual([])

    // `initialize` comes back and the capabilities appear.
    ;(connection.context.client as unknown as { serverCapabilities: unknown }).serverCapabilities =
      RUST_LIKE
    controller.handleConnected()
    await vi.advanceTimersByTimeAsync(0)

    expect(connection.requests).toHaveLength(1)
  })

  it('asks nothing of a server that advertises no provider', async () => {
    const { connection, controller } = attached({})

    controller.handleRangeNeeded(demand())
    await vi.advanceTimersByTimeAsync(500)

    expect(connection.requests).toEqual([])
  })
})

/**
 * Every one of these was a silent `return` before, and the difference between
 * them is the difference between "you have it switched off", "your server does
 * not offer it" and "this side has a bug". A 222 MB performance trace was needed
 * to tell the first from the third once; that is what these events are for.
 */
describe('SemanticTokenController reported outcomes', () => {
  it('says the feature is off rather than going quiet', async () => {
    seedSettings({ 'lsp.semanticTokens.enabled': false })
    const { controller } = attached(RUST_LIKE)

    controller.handleRangeNeeded(demand())
    await vi.advanceTimersByTimeAsync(500)

    expect(loggedRequestOutcomes()).toEqual(['disabled'])
  })

  it('says the server offered no legend', async () => {
    const { controller } = attached({})

    controller.handleRangeNeeded(demand())
    await vi.advanceTimersByTimeAsync(500)

    expect(loggedRequestOutcomes()).toEqual(['no_legend'])
  })

  it('reports the first answer, so a working path is distinguishable from a quiet one', async () => {
    const { connection, controller } = attached(RUST_LIKE)

    controller.handleRangeNeeded(demand())
    await vi.advanceTimersByTimeAsync(0)
    connection.settle()
    await vi.advanceTimersByTimeAsync(0)

    expect(loggedRequestOutcomes()).toEqual(['answered'])
  })

  it('says a steady state once per document rather than once per demand', async () => {
    seedSettings({ 'lsp.semanticTokens.enabled': false })
    const { controller } = attached(RUST_LIKE)

    controller.handleRangeNeeded(demand())
    await vi.advanceTimersByTimeAsync(500)
    controller.handleRangeNeeded(demand({ textVersion: 2 }))
    await vi.advanceTimersByTimeAsync(500)

    // A scroll fires this signal per frame; one line per document is the budget.
    expect(loggedRequestOutcomes()).toEqual(['disabled'])
  })
})

describe('SemanticTokenController range padding', () => {
  /**
   * The last line is the one this is easiest to lose. Clamping the padded *line*
   * and then taking its start stops the range at the beginning of the final line,
   * so every viewport within a padding window of the end of a file asks for a
   * range that excludes the text the user is looking at.
   */
  it('asks all the way to the end of the text, not to the start of the last line', async () => {
    const { connection, controller } = attached(RUST_LIKE)

    // A viewport at the very bottom of the fixture document.
    controller.handleRangeNeeded(demand({ end: TEXT.length, start: TEXT.length - 50 }))
    await vi.advanceTimersByTimeAsync(0)

    // Asserted before it is indexed: if no request went out at all, the failure
    // should say so rather than throw a TypeError on a missing property.
    expect(connection.requests).toHaveLength(1)
    const { range } = connection.requests[0]!.params as {
      range: { end: { line: number; character: number } }
    }
    const lastLineIndex = TEXT.split('\n').length - 1
    const lastLineLength = TEXT.split('\n')[lastLineIndex]?.length ?? 0

    expect(range.end.line).toBe(lastLineIndex)
    expect(range.end.character).toBe(lastLineLength)
  })

  it('pads above the viewport rather than starting at it', async () => {
    const { connection, controller } = attached(RUST_LIKE)
    const midpoint = Math.floor(TEXT.length / 2)

    controller.handleRangeNeeded(demand({ end: midpoint + 50, start: midpoint }))
    await vi.advanceTimersByTimeAsync(0)

    expect(connection.requests).toHaveLength(1)
    const { range } = connection.requests[0]!.params as { range: { start: { line: number } } }
    const demandedLine = TEXT.slice(0, midpoint).split('\n').length - 1

    expect(range.start.line).toBeLessThan(demandedLine)
  })
})

describe('SemanticTokenController staleness', () => {
  /**
   * The editor's own version, never `LspDocument.version`.
   *
   * The workspace counter starts at 0 when document sync opens the uri, by which
   * time the editor has already recorded its first transition, so the two can
   * never agree. Stamping the workspace's would make every push compare a number
   * the editor never issued: dropped, then `onResyncRequired`, then the same
   * wrong number again, forever.
   */
  it('pushes the version it asked about, not the one it happens to see', async () => {
    const { connection, controller, layer } = attached(RUST_LIKE)

    controller.handleRangeNeeded(demand({ textVersion: 7 }))
    await vi.advanceTimersByTimeAsync(0)
    connection.settle()
    await vi.advanceTimersByTimeAsync(0)

    expect(layer.pushes).toHaveLength(1)
    expect(layer.pushes[0]).toMatchObject({ documentId: DOCUMENT_ID, textVersion: 7 })
    // The workspace's own version for this document is 0; 7 is the editor's.
    expect(layer.pushes[0]?.textVersion).not.toBe(0)
    expect(layer.pushes[0]?.spans.length).toBeGreaterThan(0)
  })

  it('carries the same editor version through a resync that has no demand of its own', async () => {
    const { connection, controller, layer } = attached(RUST_LIKE)
    controller.handleRangeNeeded(demand({ textVersion: 7 }))
    await vi.advanceTimersByTimeAsync(0)
    connection.settle()
    await vi.advanceTimersByTimeAsync(0)

    controller.handleResyncRequired('version-too-old')
    await vi.advanceTimersByTimeAsync(0)
    connection.settle()
    await vi.advanceTimersByTimeAsync(0)

    expect(layer.pushes.at(-1)).toMatchObject({ textVersion: 7 })
  })

  it('asks nothing at all before the editor has named a version', async () => {
    const { connection, controller } = attached(RUST_LIKE)

    // A refresh or a resync can land before the first demand. There is no editor
    // version to answer about, and inventing one is the loop above.
    controller.handleResyncRequired('document-changed')
    controller.handleRefresh()
    await vi.advanceTimersByTimeAsync(500)

    expect(connection.requests).toEqual([])
  })

  it('sets the timeout it costed, and a longer one before the first answer', async () => {
    const { connection, controller } = attached(RUST_LIKE)

    controller.handleRangeNeeded(demand())
    await vi.advanceTimersByTimeAsync(0)

    // A cold server is bounded by indexing, not by token computation, so the
    // first request gets 30s where the editor's default would have timed out at 3.
    expect(connection.requests[0]?.options.timeoutMs).toBe(30_000)
    expect(connection.requests[0]?.options.signal).toBeInstanceOf(AbortSignal)

    connection.settle()
    await vi.advanceTimersByTimeAsync(0)
    controller.handleRangeNeeded(demand({ textVersion: 2 }))
    await vi.advanceTimersByTimeAsync(300)

    expect(connection.requests[1]?.options.timeoutMs).toBe(5_000)
  })

  it('cancels the in-flight request when a new demand arrives', async () => {
    const { connection, controller } = attached(RUST_LIKE)
    controller.handleRangeNeeded(demand())
    await vi.advanceTimersByTimeAsync(0)

    const signal = connection.requests[0]?.options.signal
    expect(signal?.aborted).toBe(false)

    controller.handleRangeNeeded(demand({ textVersion: 2 }))
    await vi.advanceTimersByTimeAsync(0)

    // A real `$/cancelRequest` on the wire, which the proxy remaps and a server
    // that honours it uses to abandon work in its own process.
    expect(signal?.aborted).toBe(true)
  })

  /**
   * The rule that keeps a slow server and fast typing from becoming a request
   * loop. A dropped payload means the text moved past what was asked about, and
   * the editor raises `onResyncRequired` when it wants another — retrying here
   * would race the typing that caused the drop.
   */
  it('does not re-ask after a dropped push until the editor says to', async () => {
    const { connection, controller, layer } = attached(RUST_LIKE)
    layer.verdict = { reason: 'version-too-old', status: 'dropped' }

    controller.handleRangeNeeded(demand())
    await vi.advanceTimersByTimeAsync(0)
    connection.settle()
    await vi.advanceTimersByTimeAsync(1_000)

    expect(layer.pushes).toHaveLength(1)
    expect(connection.requests).toHaveLength(1)

    controller.handleResyncRequired('version-too-old')
    await vi.advanceTimersByTimeAsync(0)

    expect(connection.requests).toHaveLength(2)
  })

  /**
   * The editor raises `onResyncRequired` on every dropped push and this side
   * answers at delay zero, so a drop a fresh request cannot fix would otherwise
   * be an unbounded loop against a real child process.
   */
  it('stops answering resyncs that never produce a paint', async () => {
    const { connection, controller, layer } = attached(RUST_LIKE)
    layer.verdict = { reason: 'version-too-old', status: 'dropped' }
    controller.handleRangeNeeded(demand())
    await vi.advanceTimersByTimeAsync(0)
    connection.settle()
    await vi.advanceTimersByTimeAsync(0)

    for (let attempt = 0; attempt < 6; attempt += 1) {
      controller.handleResyncRequired('version-too-old')
      await vi.advanceTimersByTimeAsync(0)
      connection.settle()
      await vi.advanceTimersByTimeAsync(0)
    }

    // The first demand, plus a bounded number of resyncs — not one per drop.
    expect(connection.requests.length).toBeLessThanOrEqual(3)
  })

  /** A resync asks for the whole document: the version it held is unreachable. */
  it('resyncs with a whole-file request even when range is on offer', async () => {
    const { connection, controller } = attached(RUST_LIKE)
    controller.handleRangeNeeded(demand())
    await vi.advanceTimersByTimeAsync(0)
    connection.settle()
    await vi.advanceTimersByTimeAsync(0)

    controller.handleResyncRequired('document-changed')
    await vi.advanceTimersByTimeAsync(0)

    expect(connection.requests.at(-1)?.method).toBe('textDocument/semanticTokens/full')
  })

  it('drops a layer for a document it no longer owns', async () => {
    const { connection, controller } = attached(RUST_LIKE)
    const next = fakeLayer()
    controller.attachLayer(
      next,
      { documentId: fileDocumentKey(filesystemPath('/repo/src/other.rs')), languageId: 'rust' },
      'file:///repo/src/other.rs',
    )

    // Addressed to the layer that was replaced, which is the ordinary case on a
    // tab switch rather than a theoretical one.
    controller.handleRangeNeeded(demand())
    await vi.advanceTimersByTimeAsync(500)

    expect(connection.requests).toEqual([])
  })

  it('stops asking once disposed', async () => {
    const { connection, controller } = attached(RUST_LIKE)

    controller.dispose()
    controller.handleRangeNeeded(demand())
    await vi.advanceTimersByTimeAsync(500)

    expect(connection.requests).toEqual([])
  })
})

describe('SemanticTokenController refresh', () => {
  /**
   * The proxy downgrades the server's request into a notification, because N
   * pooled clients cannot answer one request id. The handler does two things and
   * no more.
   */
  it('empties the layer and asks once', async () => {
    const { connection, controller, layer } = attached(RUST_LIKE)
    controller.handleRangeNeeded(demand())
    await vi.advanceTimersByTimeAsync(0)
    connection.settle()
    await vi.advanceTimersByTimeAsync(0)
    const before = connection.requests.length

    controller.handleRefresh()
    await vi.advanceTimersByTimeAsync(300)

    expect(layer.clears).toBe(1)
    expect(connection.requests).toHaveLength(before + 1)
  })
})
