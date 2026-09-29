import {
  createDocumentLogicalRevisionScope,
  createStringTextSnapshot,
} from '@singapore-editor/core/document'
import { arrayLspLineStarts, LspWorkspace, type LspClient } from '@singapore-editor/lsp'
import { describe, expect, it, vi } from 'vitest'
import type * as lsp from 'vscode-languageserver-protocol'

import {
  CompositeDiagnosticsPresenter,
  type CompositeDiagnosticsLanePresenter,
} from '../src/diagnosticsPresenter'
import type { AcquiredLanguageServerLane } from '../src/lane'
import { createLanguageServerSetPlugin } from '../src/plugin'
import { LanguageServerSet, type LanguageServerSetLane } from '../src/serverSet'
import { snapshotDocument } from './snapshotDocument'

describe('LanguageServerSet', () => {
  it('merges hover but takes the first ranked highlight answer while isolating failures', async () => {
    const primary = fakeLane('primary', { hover: 0, documentHighlights: 10 }, capabilities(), {
      'textDocument/hover': hover('primary'),
      'textDocument/documentHighlight': [highlight(1)],
    })
    const secondary = fakeLane('secondary', { hover: 5, documentHighlights: 0 }, capabilities(), {
      'textDocument/hover': hover('secondary'),
      'textDocument/documentHighlight': [highlight(2)],
    })
    const failed = fakeLane('failed', { hover: 2 }, capabilities(), {
      'textDocument/hover': new Error('unavailable'),
    })
    const servers = new LanguageServerSet([secondary, failed, primary])

    const mergedHover = await servers.request<lsp.Hover, unknown>('textDocument/hover', {})
    const mergedHighlights = await servers.request<lsp.DocumentHighlight[], unknown>(
      'textDocument/documentHighlight',
      {},
    )

    expect((mergedHover.contents as lsp.MarkupContent).value).toBe('primary\n\n---\n\nsecondary')
    expect(mergedHighlights).toEqual([highlight(2)])
    expect(failed.onRequestError).toHaveBeenCalledWith('textDocument/hover', expect.any(Error))
  })

  it('drops empty and duplicate hover answers without disturbing progressive rank order', async () => {
    const lanes = [
      fakeLane('empty', { hover: 0 }, capabilities(), {
        'textDocument/hover': hover('   '),
      }),
      fakeLane('first', { hover: 1 }, capabilities(), {
        'textDocument/hover': hover('answer'),
      }),
      fakeLane('duplicate', { hover: 2 }, capabilities(), {
        'textDocument/hover': hover('answer'),
      }),
    ]
    const servers = new LanguageServerSet(lanes)

    const result = await servers.request<lsp.Hover | null>('textDocument/hover', {})

    expect(result).toEqual(hover('answer'))
  })

  it('publishes hover answers progressively without letting resolution order change rank order', async () => {
    const firstAnswer = deferred<lsp.Hover | null>()
    const secondAnswer = deferred<lsp.Hover | null>()
    const first = fakeLane('first', { hover: 0 }, capabilities(), {
      'textDocument/hover': () => firstAnswer.promise,
    })
    const second = fakeLane('second', { hover: 5 }, capabilities(), {
      'textDocument/hover': () => secondAnswer.promise,
    })
    const servers = new LanguageServerSet([second, first])
    const updates: Array<{ values: readonly string[]; pending: boolean }> = []

    const result = servers.requestHover({}, {}, (update) => {
      updates.push({
        values: update.hovers.map((item) => (item.contents as lsp.MarkupContent).value),
        pending: update.pending,
      })
    })
    secondAnswer.resolve(hover('second'))
    await Promise.resolve()
    firstAnswer.resolve(hover('first'))

    expect((await result)?.contents).toEqual({
      kind: 'markdown',
      value: 'first\n\n---\n\nsecond',
    })
    expect(updates).toEqual([
      { values: ['second'], pending: true },
      { values: ['first', 'second'], pending: false },
    ])
  })

  it('fans out and deduplicates navigation while keeping formatting and rename single-owner', async () => {
    const shared = location('file:///shared.ts', 1)
    const first = fakeLane('first', ownerFeatures(5), ownerCapabilities(), {
      ...ownerResponses('first'),
      'textDocument/definition': [shared, location('file:///first.ts', 2)],
    })
    const second = fakeLane('second', ownerFeatures(0), ownerCapabilities(), {
      ...ownerResponses('second'),
      'textDocument/definition': [shared, location('file:///second.ts', 3)],
    })
    const servers = new LanguageServerSet([first, second])

    expect(await servers.request('textDocument/definition', {})).toEqual([
      shared,
      location('file:///second.ts', 3),
      location('file:///first.ts', 2),
    ])
    expect(await servers.request('textDocument/signatureHelp', {})).toBe('second:signature')
    expect(await servers.request('textDocument/formatting', {})).toBe('second:formatting')
    expect(await servers.request('textDocument/onTypeFormatting', {})).toBe('second:on-type')
    expect(await servers.request('textDocument/rename', {})).toBe('second:rename')
    expect(first.connection.client.request).toHaveBeenCalledTimes(1)
    expect(second.connection.client.request).toHaveBeenCalledTimes(5)
  })

  it('falls back to the next signature provider after null or failure', async () => {
    const first = fakeLane('first', { signatureHelp: 0 }, ownerCapabilities(), {
      'textDocument/signatureHelp': null,
    })
    const failed = fakeLane('failed', { signatureHelp: 1 }, ownerCapabilities(), {
      'textDocument/signatureHelp': new Error('declined'),
    })
    const answer = fakeLane('answer', { signatureHelp: 2 }, ownerCapabilities(), {
      'textDocument/signatureHelp': 'answer',
    })
    const servers = new LanguageServerSet([answer, failed, first])

    expect(await servers.request('textDocument/signatureHelp', {})).toBe('answer')
    expect(failed.onRequestError).toHaveBeenCalledWith(
      'textDocument/signatureHelp',
      expect.any(Error),
    )
  })

  it('honours runtime capability absence and elects the ready semantic owner', () => {
    const designated = fakeLane(
      'designated',
      { completion: 0, diagnostics: 10, semanticTokens: 0 },
      {},
      {},
    )
    const fallback = fakeLane(
      'fallback',
      { completion: 5, diagnostics: 0, semanticTokens: 5 },
      { completionProvider: {}, semanticTokensProvider: semanticTokensProvider() },
      {},
    )
    const servers = new LanguageServerSet([fallback, designated])

    expect(servers.declared('completion').map((lane) => lane.id)).toEqual([
      'designated',
      'fallback',
    ])
    expect(servers.ready('completion').map((lane) => lane.id)).toEqual(['fallback'])
    expect(servers.declared('diagnostics').map((lane) => lane.id)).toEqual([
      'fallback',
      'designated',
    ])
    expect(servers.ready('semanticTokens').map((lane) => lane.id)).toEqual(['fallback'])
  })

  it('combines code actions in rank order and resolves through their originating lanes', async () => {
    const firstAction = { title: 'first' }
    const secondAction = { title: 'second' }
    const first = fakeLane(
      'first',
      { codeActions: 5 },
      { codeActionProvider: { resolveProvider: true } },
      {
        'textDocument/codeAction': [firstAction],
        'codeAction/resolve': { ...firstAction, edit: { changes: {} } },
      },
    )
    const second = fakeLane(
      'second',
      { codeActions: 0 },
      { codeActionProvider: { resolveProvider: true } },
      {
        'textDocument/codeAction': [secondAction],
        'codeAction/resolve': { ...secondAction, edit: { changes: {} } },
      },
    )
    const servers = new LanguageServerSet([first, second])

    const actions = await servers.request<lsp.CodeAction[], unknown>('textDocument/codeAction', {})
    await servers.request('codeAction/resolve', actions[1])

    expect(actions.map((action) => action.title)).toEqual(['second', 'first'])
    expect(first.connection.client.request).toHaveBeenCalledWith(
      'codeAction/resolve',
      firstAction,
      {},
    )
    expect(second.connection.client.request).toHaveBeenCalledTimes(1)
  })

  it('captures each code-action guard before its owning lane request', async () => {
    const fastAnswer = deferred<lsp.CodeAction[]>()
    const slowAnswer = deferred<lsp.CodeAction[]>()
    const fastCaptured = deferred<void>()
    const fastAction = { edit: { changes: {} }, title: 'fast' }
    const slowAction = { edit: { changes: {} }, title: 'slow' }
    const fast = {
      ...fakeLane(
        'fast',
        { codeActions: 0 },
        { codeActionProvider: true },
        {
          'textDocument/codeAction': () => fastAnswer.promise,
        },
      ),
      onInteractiveReady: () => fastCaptured.resolve(),
    }
    const slow = fakeLane(
      'slow',
      { codeActions: 1 },
      { codeActionProvider: true },
      {
        'textDocument/codeAction': () => slowAnswer.promise,
      },
    )
    const sourceSegment = {}
    const initialSnapshot = createStringTextSnapshot('const value = 1')
    openWorkspaceDocument(fast.connection.workspace, initialSnapshot, sourceSegment)
    openWorkspaceDocument(slow.connection.workspace, initialSnapshot, sourceSegment)
    const servers = new LanguageServerSet([fast, slow])

    const pending = servers.request<lsp.CodeAction[], unknown>('textDocument/codeAction', {})
    fastAnswer.resolve([fastAction])
    await fastCaptured.promise

    const nextSnapshot = createStringTextSnapshot('const value = 2')
    updateWorkspaceDocument(fast.connection.workspace, nextSnapshot, sourceSegment)
    updateWorkspaceDocument(slow.connection.workspace, nextSnapshot, sourceSegment)
    slowAnswer.resolve([slowAction])
    await pending

    const fastGuard = servers.provenanceOf(fastAction)?.guard
    const slowGuard = servers.provenanceOf(slowAction)?.guard
    expect(fastGuard?.documents[0]).toMatchObject({ uri: 'file:///src/index.ts', version: 0 })
    expect(fastGuard?.isCurrent('file:///src/index.ts')).toBe(false)
    expect(slowGuard?.documents[0]).toMatchObject({ uri: 'file:///src/index.ts', version: 0 })
    expect(slowGuard?.documents[0]?.textSnapshot).toBe(initialSnapshot)
    expect(slowGuard?.isCurrent('file:///src/index.ts')).toBe(false)
  })

  it('preserves the single-lane request catalog through delayed response and lazy resolve', async () => {
    const answer = deferred<lsp.CodeAction[]>()
    const resolved = deferred<lsp.CodeAction>()
    const action = { data: { fixId: 1 }, title: 'lazy' }
    const lane = fakeLane(
      'single',
      { codeActions: 0 },
      { codeActionProvider: { resolveProvider: true } },
      {
        'textDocument/codeAction': () => answer.promise,
        'codeAction/resolve': () => resolved.promise,
      },
    )
    const sourceSegment = {}
    const initialSnapshot = createStringTextSnapshot('const value = 1')
    openWorkspaceDocument(lane.connection.workspace, initialSnapshot, sourceSegment)
    const servers = new LanguageServerSet([lane])

    const pending = servers.request<lsp.CodeAction[]>('textDocument/codeAction', {})
    updateWorkspaceDocument(
      lane.connection.workspace,
      createStringTextSnapshot('const value = 2'),
      sourceSegment,
    )
    answer.resolve([action])
    await pending
    const originalGuard = servers.provenanceOf(action)?.guard
    expect(originalGuard?.documents[0]?.textSnapshot).toBe(initialSnapshot)
    expect(originalGuard?.isCurrent('file:///src/index.ts')).toBe(false)

    const resolving = servers.resolveOwnedCodeAction(action, {})
    const resolvedAction = { ...action, edit: { changes: {} } }
    resolved.resolve(resolvedAction)
    const owned = await resolving
    expect(owned?.guard).toBe(originalGuard)
    expect(servers.provenanceOf(resolvedAction)?.guard).toBe(originalGuard)
    expect(owned?.guard.isCurrent('file:///src/index.ts')).toBe(false)
  })

  it('registers one view, command, and edit contribution for several lanes', () => {
    const registrations = {
      command: vi.fn(() => ({ dispose: vi.fn() })),
      edit: vi.fn(() => ({ dispose: vi.fn() })),
      view: vi.fn(() => ({ dispose: vi.fn() })),
    }
    const plugin = createLanguageServerSetPlugin({
      lanes: [lanePluginOptions('first'), lanePluginOptions('second')],
    })

    plugin.activate({
      registerCommandContribution: registrations.command,
      registerEditContribution: registrations.edit,
      registerViewContribution: registrations.view,
    } as never)

    expect(registrations.view).toHaveBeenCalledTimes(1)
    expect(registrations.command).toHaveBeenCalledTimes(1)
    expect(registrations.edit).toHaveBeenCalledTimes(1)
  })
})

describe('CompositeDiagnosticsPresenter', () => {
  it('unions lane batches in rank order and clearing one preserves the other', () => {
    const rendered: lsp.Diagnostic[][] = []
    const presenter = {
      clear: vi.fn(),
      render: vi.fn((_text: string, diagnostics: readonly lsp.Diagnostic[]) => {
        rendered.push([...diagnostics])
      }),
      moveMarker: vi.fn(() => false),
    }
    const combined = new CompositeDiagnosticsPresenter(presenter as never, ['primary', 'secondary'])
    const primary = combined.forLane('primary')
    const secondary = combined.forLane('secondary')

    publish(primary, diagnostic('primary'))
    publish(secondary, diagnostic('secondary'))
    primary.clear()
    publish(secondary, diagnostic('secondary-again'))

    expect(rendered.at(-3)?.map((item) => item.message)).toEqual(['primary', 'secondary'])
    expect(rendered.at(-2)?.map((item) => item.message)).toEqual(['secondary'])
    expect(rendered.at(-1)?.map((item) => item.message)).toEqual(['secondary-again'])
  })
})

function fakeLane(
  id: string,
  features: LanguageServerSetLane['features'],
  serverCapabilities: lsp.ServerCapabilities,
  responses: Readonly<Record<string, unknown>>,
) {
  const request = vi.fn(async (method: string) => {
    const response = responses[method]
    if (response instanceof Error) throw response
    if (typeof response === 'function') return response()
    return response ?? null
  })
  const client = {
    initialized: true,
    request,
    serverCapabilities,
  } as unknown as LspClient
  const workspace = new LspWorkspace()
  const connection = {
    client,
    id,
    isReady: () => true,
    logicalRevisionScope: createDocumentLogicalRevisionScope(),
    ready: Promise.resolve({ client, workspace }),
    release: vi.fn(),
    workspace,
  } satisfies AcquiredLanguageServerLane

  return { connection, features, id, onRequestError: vi.fn() }
}

function openWorkspaceDocument(
  workspace: LspWorkspace,
  textSnapshot: ReturnType<typeof createStringTextSnapshot>,
  sourceSegment: object,
): void {
  workspace.openDocumentSnapshot({
    languageId: 'typescript',
    lineStarts: arrayLspLineStarts([0]),
    sourceRevision: 0,
    sourceSegment,
    textSnapshot,
    uri: 'file:///src/index.ts',
  })
}

function updateWorkspaceDocument(
  workspace: LspWorkspace,
  textSnapshot: ReturnType<typeof createStringTextSnapshot>,
  sourceSegment: object,
): void {
  workspace.updateDocumentSnapshot('file:///src/index.ts', {
    edits: [{ from: 14, text: '2', to: 15 }],
    lineStarts: arrayLspLineStarts([0]),
    logicalRevisionCount: 1,
    sourceRevision: 1,
    sourceSegment,
    textSnapshot,
  })
}

function capabilities(): lsp.ServerCapabilities {
  return {
    documentHighlightProvider: true,
    hoverProvider: true,
  }
}

function ownerFeatures(rank: number): LanguageServerSetLane['features'] {
  return { navigation: rank, signatureHelp: rank, formatting: rank, rename: rank }
}

function ownerCapabilities(): lsp.ServerCapabilities {
  return {
    definitionProvider: true,
    documentFormattingProvider: true,
    documentOnTypeFormattingProvider: { firstTriggerCharacter: '}' },
    renameProvider: true,
    signatureHelpProvider: {},
  }
}

function ownerResponses(owner: string) {
  return {
    'textDocument/definition': `${owner}:definition`,
    'textDocument/signatureHelp': `${owner}:signature`,
    'textDocument/formatting': `${owner}:formatting`,
    'textDocument/onTypeFormatting': `${owner}:on-type`,
    'textDocument/rename': `${owner}:rename`,
  }
}

function semanticTokensProvider(): lsp.SemanticTokensOptions {
  return { legend: { tokenModifiers: [], tokenTypes: [] } }
}

function lanePluginOptions(id: string) {
  return {
    features: { completion: 0 },
    id,
    webSocketRoute: `ws://localhost/${id}`,
  }
}

function hover(value: string): lsp.Hover {
  return { contents: { kind: 'markdown', value } }
}

function highlight(character: number): lsp.DocumentHighlight {
  return {
    range: {
      start: { line: 0, character },
      end: { line: 0, character: character + 1 },
    },
  }
}

function location(uri: string, character: number): lsp.Location {
  return { uri, range: highlight(character).range }
}

function diagnostic(message: string): lsp.Diagnostic {
  return { message, range: highlight(0).range }
}

function publish(presenter: CompositeDiagnosticsLanePresenter, item: lsp.Diagnostic): void {
  presenter.render(snapshotDocument('text'), [item])
  presenter.publishSummary('file:///test.ts', 1, [item], 'current')
}

function deferred<T>(): { promise: Promise<T>; resolve(value: T): void } {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((settle) => {
    resolve = settle
  })
  return { promise, resolve }
}
