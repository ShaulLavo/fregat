import { LspConnectionPool } from '../src/lspConnectionPool'
import type { LspReconnectOptions } from '../src/lspConnection'
import { createLanguageServerDocument } from '../src/document'
import { createEditorTextBuffer, createEditorBufferSession } from '@singapore-editor/core/document'
import { EditorTokenStore } from '@singapore-editor/core/syntax'
import type { EditorAnyCommandId } from '@singapore-editor/core/editor'
import {
  createEditorCapabilityToken,
  type EditorCommandContributionContext,
  type EditorCommandHandler,
  type EditorEditContributionContext,
  type EditorViewContributionContext,
  type EditorViewContributionProvider,
  type EditorViewSnapshot,
} from '@singapore-editor/core/extensions'
import type {
  LspManagedTransport,
  LspTransportHandler,
  LspWebSocketLike,
  LspWorkspace,
} from '@singapore-editor/lsp'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type * as lsp from 'vscode-languageserver-protocol'
import { syncedDocument } from './syncedDocument'

import { type LanguageServerCompletionEditFeature } from '../src/completion'
import {
  LspConnection,
  type LspConnectionCallbacks,
  type LspConnectionOptions,
  type LspConnectionProvider,
} from '../src/lspConnection'
import { createLanguageServerAdapterPlugin, createLanguageServerPlugin } from '../src/plugin'
import type {
  ApplyWorkspaceEditRequest,
  ApplyWorkspaceEditResult,
  LanguageServerDiagnosticSummary,
  LanguageServerPlugin,
  LanguageServerRenamePrompt,
} from '../src/types'
import { connectedEditor, DOCUMENT_URI } from './connectedEditor'
import {
  documentSyncSnapshotFields,
  viewSnapshotStructuralFields,
  viewTextFields,
} from './documentSyncSnapshot'
import {
  createTestEditContributionContext,
  createTestPluginContext,
  createTestViewContributionContext,
} from '@singapore-editor/core/testing'

type JsonMessage = Record<string, unknown>
type Listener = (event: Event) => void

class FakeTransport implements LspManagedTransport {
  public readonly sent: string[] = []
  private readonly handlers = new Set<LspTransportHandler>()

  public send(message: string): void {
    this.sent.push(message)
  }

  public subscribe(handler: LspTransportHandler): void {
    this.handlers.add(handler)
  }

  public unsubscribe(handler: LspTransportHandler): void {
    this.handlers.delete(handler)
  }

  public onDidClose(): () => void {
    return () => undefined
  }

  public closed = false

  public close(): void {
    this.closed = true
    this.handlers.clear()
  }

  public receive(message: unknown): void {
    const text = typeof message === 'string' ? message : JSON.stringify(message)
    for (const handler of this.handlers) handler(text)
  }
}

class FakeWebSocket implements LspWebSocketLike {
  public static readonly instances: FakeWebSocket[] = []
  public readonly sent: string[] = []
  public readyState = 0
  private readonly listeners = new Map<string, Set<Listener>>()

  public constructor(public readonly url: string | URL) {
    FakeWebSocket.instances.push(this)
  }

  public send(message: string): void {
    this.sent.push(message)
  }

  public close(): void {
    this.readyState = 3
    this.emit('close')
  }

  public addEventListener(type: 'open' | 'message' | 'error' | 'close', handler: Listener): void {
    this.listenersFor(type).add(handler)
  }

  public removeEventListener(
    type: 'open' | 'message' | 'error' | 'close',
    handler: Listener,
  ): void {
    this.listenersFor(type).delete(handler)
  }

  public open(): void {
    this.readyState = 1
    this.emit('open')
  }

  public receive(message: unknown): void {
    this.emit('message', JSON.stringify(message))
  }

  private emit(type: string, data?: unknown): void {
    const event = data === undefined ? new Event(type) : new MessageEvent(type, { data })
    for (const listener of this.listenersFor(type)) listener(event)
  }

  private listenersFor(type: string): Set<Listener> {
    let listeners = this.listeners.get(type)
    if (listeners) return listeners

    listeners = new Set()
    this.listeners.set(type, listeners)
    return listeners
  }
}

describe('createLanguageServerAdapterPlugin', () => {
  afterEach(() => {
    FakeWebSocket.instances.length = 0
    document.body.replaceChildren()
  })

  it('repaints existing unnecessary diagnostics when the editor theme changes', async () => {
    const transport = new FakeTransport()
    const { features, provider } = activatePlugin(
      createLanguageServerAdapterPlugin({
        name: 'test.theme',
        createTransport: () => transport,
      }),
      { applyEdits: vi.fn() },
    )
    const context = viewContributionContext(editorSnapshot(), { features })
    const contribution = provider.createContribution(context)!
    const computed = vi
      .spyOn(window, 'getComputedStyle')
      .mockReturnValue({ color: 'rgba(0, 0, 0, 0.25)' } as CSSStyleDeclaration)
    try {
      transport.receive(initializeResponse(jsonMessage(transport.sent[0])))
      await flushPromises()
      transport.receive({
        jsonrpc: '2.0',
        method: 'textDocument/publishDiagnostics',
        params: {
          uri: 'file:///README.md',
          diagnostics: [
            {
              range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } },
              message: 'unused',
              severity: 4,
              tags: [1],
            },
          ],
        },
      })
      expect(context.setRangeHighlight).toHaveBeenCalledWith(
        expect.stringContaining('unnecessary'),
        [{ start: 0, end: 1 }],
        { overlay: { dim: 0.25 } },
      )
      computed.mockReturnValue({ color: 'rgba(0, 0, 0, 0.75)' } as CSSStyleDeclaration)
      contribution.update({ ...editorSnapshot(), theme: { type: 'light' } }, 'tokens')
      expect(context.setRangeHighlight).toHaveBeenCalledWith(
        expect.stringContaining('unnecessary'),
        [{ start: 0, end: 1 }],
        { overlay: { dim: 0.75 } },
      )
    } finally {
      computed.mockRestore()
      contribution.dispose()
    }
  })

  it('owns generic LSP document sync, diagnostics, and adapter naming', async () => {
    const transport = new FakeTransport()
    const completionToken = createEditorCapabilityToken<LanguageServerCompletionEditFeature>(
      'test.lsp-plugin.completion',
    )
    const applyEdits = vi.fn<EditorEditContributionContext['applyEdits']>()
    const { commands, features, provider } = activatePlugin(
      createLanguageServerAdapterPlugin({
        name: 'editor.test-lsp',
        createTransport: () => transport,
        diagnostics: {
          minimapSourceId: 'editor.test-lsp.diagnostics',
          highlightNameNamespace: 'test-lsp',
          markerTimingNamePrefix: 'testLsp.marker',
        },
        completion: {
          editFeature: completionToken,
          acceptTimingName: 'testLsp.completion.accept',
          widgetClassNamespace: 'test-lsp',
        },
        hoverDefinition: {
          linkHighlightNameNamespace: 'test-lsp',
          tooltipClassNamespace: 'test-lsp',
          navigationTimingNamePrefix: 'testLsp',
        },
      }),
      { applyEdits },
    )
    const context = viewContributionContext(editorSnapshot(), { features })
    const contribution = provider.createContribution(context)
    if (!contribution) throw new Error('missing contribution')

    transport.receive(initializeResponse(jsonMessage(transport.sent[0])))
    await flushPromises()

    expect(textDocumentFor(transport.sent.find(hasMethod('textDocument/didOpen')))).toEqual({
      uri: 'file:///README.md',
      languageId: 'markdown',
      version: 0,
      text: '# Notes',
    })

    transport.receive(publishDiagnosticsMessage())
    expect(context.setRangeHighlight).toHaveBeenCalledWith(
      'editor-test-test-lsp-error',
      [{ start: 0, end: 1 }],
      expect.any(Object),
    )
    expect(command(commands, 'editor.action.marker.next')({})).toBe(true)
    expect(context.setSelection).toHaveBeenCalledWith(0, 1, 'testLsp.marker.next', {
      revealOffset: 0,
    })

    const completionFeature = features.get(completionToken) as
      | LanguageServerCompletionEditFeature
      | undefined
    expect(
      completionFeature?.applyCompletion({
        edits: [{ from: 0, to: 1, text: 'value' }],
        selection: { anchor: 5, head: 5 },
      }),
    ).toBe(true)
    expect(applyEdits).toHaveBeenCalledWith(
      [{ from: 0, to: 1, text: 'value' }],
      'testLsp.completion.accept',
      { anchor: 5, head: 5 },
    )
  })

  // A formatter answers with the whole file even when one line moved, and applying that verbatim
  // retires every anchor, decoration, fold and selection inside it.
  it.each([0, 22])('formats a smaller document with the caret at %s', async (caret) => {
    const transport = new FakeTransport()
    const applyEdits = vi.fn<EditorEditContributionContext['applyEdits']>()
    const text = '# Notes\n\n- one\n-  two\n'
    const { commands, features, provider } = activatePlugin(
      createLanguageServerAdapterPlugin({
        name: 'editor.test-lsp',
        createTransport: () => transport,
        completion: { acceptTimingName: 'testLsp.completion.accept' },
      }),
      { applyEdits },
    )
    const contribution = provider.createContribution(
      viewContributionContext(
        {
          ...editorSnapshot(text),
          selections: [
            {
              anchorOffset: caret,
              headOffset: caret,
              startOffset: caret,
              endOffset: caret,
              affinity: 'after',
            },
          ],
        },
        { features },
      ),
    )
    if (!contribution) throw new Error('missing contribution')

    transport.receive(
      initializeResponse(jsonMessage(transport.sent[0]), { documentFormattingProvider: true }),
    )
    await flushPromises()

    expect(command(commands, 'editor.action.formatDocument')({})).toBe(true)

    const request = transport.sent.findLast(hasMethod('textDocument/formatting'))
    if (!request) throw new Error('missing formatting request')
    transport.receive({
      jsonrpc: '2.0',
      id: jsonMessage(request).id,
      result: [
        {
          newText: '# Notes\n\n- one\n- two\n',
          range: { start: { line: 0, character: 0 }, end: { line: 4, character: 0 } },
        },
      ],
    })
    await flushPromises()

    expect(applyEdits).toHaveBeenCalledWith(
      [{ from: 17, text: '', to: 18 }],
      'testLsp.completion.accept',
      { anchor: Math.min(caret, text.length - 1), head: Math.min(caret, text.length - 1) },
    )
  })

  it('keeps the public custom-server plugin as the bring-your-own-server path', async () => {
    const statuses: string[] = []
    const applyEdits = vi.fn<EditorEditContributionContext['applyEdits']>()
    const { provider, features } = activatePlugin(
      createLanguageServerPlugin({
        webSocketRoute: 'ws://localhost/lsp/custom',
        rootUri: 'file:///repo',
        webSocketTransportOptions: { WebSocketCtor: FakeWebSocket },
        onStatusChange: (status) => statuses.push(status),
      }),
      { applyEdits },
    )
    const context = viewContributionContext(editorSnapshot(), { features })
    const contribution = provider.createContribution(context)
    if (!contribution) throw new Error('missing contribution')

    const socket = FakeWebSocket.instances[0]
    if (!socket) throw new Error('missing socket')

    socket.open()
    await flushPromises()
    socket.receive(initializeResponse(jsonMessage(socket.sent[0])))
    await flushPromises()

    expect(socket.url).toBe('ws://localhost/lsp/custom')
    expect(sentMethods(socket)).toEqual(['initialize', 'initialized', 'textDocument/didOpen'])
    expect(textDocumentFor(socket.sent[2])).toEqual({
      uri: 'file:///README.md',
      languageId: 'markdown',
      version: 0,
      text: '# Notes',
    })
    expect(statuses).toEqual(['loading', 'ready'])
  })

  // The editor refuses a second handler for an id, so `commands` is how a second plugin in the same
  // editor stays out of the first one's way; the completion list's keys are commands like any other.
  it('registers every command it has, list and hint keys included, only from `commands`', () => {
    const applyEdits = vi.fn<EditorEditContributionContext['applyEdits']>()
    const plugin = (commands?: []) =>
      createLanguageServerAdapterPlugin({
        name: 'editor.test-lsp',
        createTransport: () => new FakeTransport(),
        commands,
      })

    const defaults = activatePlugin(plugin(), { applyEdits }).commands
    const none = activatePlugin(plugin([]), { applyEdits }).commands

    expect([...defaults.keys()]).toEqual(
      expect.arrayContaining(['editor.action.triggerSuggest', 'closeParameterHints']),
    )
    expect(none.size).toBe(0)
  })
})

type ActivationOptions = {
  readonly applyEdits: EditorEditContributionContext['applyEdits']
}

describe('rename WorkspaceEdit routing', () => {
  afterEach(() => {
    document.body.replaceChildren()
  })

  it('dispatches a same-document rename to the host exactly once', async () => {
    const applied: ApplyWorkspaceEditRequest[] = []
    const editor = await connectedEditor('const value = 1', 8, {
      onApplyWorkspaceEdit: async (request) => {
        applied.push(request)
        return { status: 'applied' }
      },
      onRequestRenameName: async () => 'renamed',
    })

    expect(editor.runCommand('editor.action.rename')).toBe(true)
    await flushPromises()
    expect(editor.renameRequests()).toHaveLength(1)
    editor.answerRename({
      changes: {
        [DOCUMENT_URI]: [
          {
            newText: 'renamed',
            range: { start: { line: 0, character: 6 }, end: { line: 0, character: 11 } },
          },
        ],
      },
    })
    await flushPromises()

    expect(applied).toHaveLength(1)
    expect(applied[0]).toMatchObject({
      originUri: DOCUMENT_URI,
      serverId: 'editor.test-lsp',
      source: 'rename',
    })
    expect(applied[0]?.guard.isCurrent(DOCUMENT_URI)).toBe(true)
    expect(applied[0]?.guard.documents[0]?.textSnapshot).toBe(editor.textSnapshot())
    expect(editor.applyEdits).not.toHaveBeenCalled()
  })

  it('dispatches rename with the owning lane version after a document change', async () => {
    const editor = await connectedEditor('const value = 1', 8, {
      onRequestRenameName: async () => 'renamed',
    })
    editor.editElsewhere({ from: 15, to: 15, text: ' ' })

    expect(editor.runCommand('editor.action.rename')).toBe(true)
    await flushPromises()
    editor.answerRename({ changes: { [DOCUMENT_URI]: [] } })
    await flushPromises()

    expect(editor.workspaceEditRequests()).toHaveLength(1)
    expect(editor.workspaceEditRequests()[0]?.originVersion).toBe(1)
  })

  it('dispatches a cross-file rename without applying the active-document half', async () => {
    const editor = await connectedEditor('const value = 1', 8, {
      onRequestRenameName: async () => 'renamed',
    })
    expect(editor.runCommand('editor.action.rename')).toBe(true)
    await flushPromises()
    editor.answerRename({
      changes: {
        [DOCUMENT_URI]: [],
        'file:///src/other.ts': [],
      },
    })
    await flushPromises()

    expect(editor.workspaceEditRequests()[0]?.plan.operations).toHaveLength(2)
    expect(editor.applyEdits).not.toHaveBeenCalled()
  })

  it.each([true, false])(
    'checks request-time secondary sources only when affected by rename: %s',
    async (affected) => {
      let workspace: LspWorkspace | undefined
      const editor = await connectedEditor('const value = 1', 8, {
        onConnectionCreated: (connection) => {
          workspace = connection.workspace
        },
        onRequestRenameName: async () => 'renamed',
      })
      const secondaryUri = 'file:///src/other.ts'
      const secondary = syncedDocument(workspace, secondaryUri, 'const other = value')

      expect(editor.runCommand('editor.action.rename')).toBe(true)
      await flushPromises()
      expect(editor.renameRequests()).toHaveLength(1)
      secondary.replace('const other = newer')
      editor.answerRename({
        changes: { [affected ? secondaryUri : DOCUMENT_URI]: [] },
      })
      await flushPromises()

      expect(editor.workspaceEditRequests()).toHaveLength(affected ? 0 : 1)
      expect(editor.applyEdits).not.toHaveBeenCalled()
      if (affected) return
      const request = editor.workspaceEditRequests()[0]
      expect(
        request?.guard.documents.find((document) => document.uri === secondaryUri)?.textSnapshot,
      ).toBe(secondary.textSnapshot)
      expect(request?.guard.isCurrent(secondaryUri)).toBe(false)
    },
  )

  it('rechecks the originating document after the rename prompt resolves', async () => {
    const prompt = deferred<string | null>()
    const editor = await connectedEditor('const value = 1', 8, {
      onRequestRenameName: () => prompt.promise,
    })

    expect(editor.runCommand('editor.action.rename')).toBe(true)
    await flushPromises()
    editor.type('!')
    prompt.resolve('renamed')
    await flushPromises()

    expect(editor.renameRequests()).toHaveLength(0)
    expect(editor.workspaceEditRequests()).toHaveLength(0)
  })

  it('propagates the host rename-name callback through resolved options', async () => {
    const prompt = vi.fn(async () => null)
    const editor = await connectedEditor('const value = 1', 8, {
      onRequestRenameName: prompt,
    })

    expect(editor.runCommand('editor.action.rename')).toBe(true)
    await flushPromises()

    expect(prompt).toHaveBeenCalledOnce()
    expect(editor.renameRequests()).toHaveLength(0)
  })

  it('passes anchor currentName and the operation signal to the host rename prompt', async () => {
    const prompts: LanguageServerRenamePrompt[] = []
    const editor = await connectedEditor('const value = 1', 8, {
      onRequestRenameName: async (prompt) => {
        prompts.push(prompt)
        return null
      },
    })

    expect(editor.runCommand('editor.action.rename')).toBe(true)
    await flushPromises()

    expect(prompts).toHaveLength(1)
    expect(prompts[0]).toMatchObject({ currentName: 'value', anchor: expect.any(DOMRect) })
    expect(prompts[0]?.signal).toBeInstanceOf(AbortSignal)
  })

  it('does not mount an already-aborted built-in rename prompt', async () => {
    const editor = await connectedEditor('const value = 1', 8)

    expect(editor.runCommand('editor.action.rename')).toBe(true)
    editor.type('!')
    await flushPromises()

    expect(document.querySelector('.lsp-plugin-rename')).toBeNull()
  })

  it('aborts and closes a pending rename prompt on a newer rename or disposal', async () => {
    const editor = await connectedEditor('const value = 1', 8)
    expect(editor.runCommand('editor.action.rename')).toBe(true)
    await flushPromises()
    expect(renameInputElement()?.style.display).toBe('block')

    expect(editor.runCommand('editor.action.rename')).toBe(true)
    await flushPromises()
    expect(document.querySelectorAll('.lsp-plugin-rename')).toHaveLength(1)
    expect(renameInputElement()?.style.display).toBe('block')

    editor.dispose()
    expect(document.querySelector('.lsp-plugin-rename')).toBeNull()
  })

  it('does not dispatch after prompt cancel request cancel or active-document drift', async () => {
    const promptCancelled = await connectedEditor('const value = 1', 8, {
      onRequestRenameName: async () => null,
    })
    promptCancelled.runCommand('editor.action.rename')
    await flushPromises()
    expect(promptCancelled.workspaceEditRequests()).toHaveLength(0)

    const requestCancelled = await connectedEditor('const value = 1', 8, {
      onRequestRenameName: async () => 'renamed',
    })
    requestCancelled.runCommand('editor.action.rename')
    await flushPromises()
    requestCancelled.type('!')
    requestCancelled.answerRename({ changes: { [DOCUMENT_URI]: [] } })
    await flushPromises()
    expect(requestCancelled.workspaceEditRequests()).toHaveLength(0)

    const drifted = await connectedEditor('const value = 1', 8, {
      onRequestRenameName: async () => 'renamed',
    })
    drifted.runCommand('editor.action.rename')
    drifted.type('!')
    await flushPromises()
    expect(drifted.renameRequests()).toHaveLength(0)
    expect(drifted.workspaceEditRequests()).toHaveLength(0)
  })

  it('reports malformed producer output without invoking the host', async () => {
    const editor = await connectedEditor('const value = 1', 8, {
      onRequestRenameName: async () => 'renamed',
    })
    editor.runCommand('editor.action.rename')
    await flushPromises()
    editor.answerRename({ documentChanges: [{ nope: true }] })
    await flushPromises()

    expect(editor.workspaceEditRequests()).toHaveLength(0)
    expect(editor.reportedErrors()).toHaveLength(1)
  })

  it('treats host cancellation as a non-error', async () => {
    const editor = await renameSettlement({ status: 'cancelled' })

    expect(editor.workspaceEditRequests()).toHaveLength(1)
    expect(editor.reportedErrors()).toHaveLength(0)
  })

  it('reports a real host failure exactly once', async () => {
    const editor = await renameSettlement({
      code: 'version-conflict',
      message: 'The proposal is stale.',
      status: 'failed',
    })

    expect(editor.reportedErrors()).toHaveLength(1)
    expect(String(editor.reportedErrors()[0])).toContain('version-conflict')
  })

  it('preserves rolled-back and recovery-required host settlements without reporting applied', async () => {
    const rolledBack = await renameSettlement({
      code: 'write-failed',
      message: 'Restored.',
      status: 'rolled-back',
    })
    const recovery = await renameSettlement({
      affectedPaths: ['src/index.ts'],
      code: 'recovery-required',
      message: 'Manual recovery is required.',
      status: 'recovery-required',
    })

    expect(rolledBack.reportedErrors()).toHaveLength(0)
    expect(recovery.reportedErrors()).toHaveLength(0)
  })

  it('never reports a post-commit settlement as cancelled', async () => {
    const settlement = deferred<ApplyWorkspaceEditResult>()
    const editor = await connectedEditor('const value = 1', 8, {
      onApplyWorkspaceEdit: () => settlement.promise,
      onRequestRenameName: async () => 'renamed',
    })
    editor.runCommand('editor.action.rename')
    await flushPromises()
    editor.answerRename({ changes: { [DOCUMENT_URI]: [] } })
    await flushPromises()
    expect(editor.workspaceEditRequests()).toHaveLength(1)

    editor.type('!')
    settlement.resolve({
      code: 'cancelled-after-commit',
      message: 'Restored.',
      status: 'rolled-back',
    })
    await flushPromises()

    expect(editor.reportedErrors()).toHaveLength(0)
    expect(editor.workspaceEditRequests()).toHaveLength(1)
  })
})

describe('connectionProvider', () => {
  /**
   * A host that owns the connection, counting what the contributions ask of it.
   *
   * The real one keys by workspace root and server id; this one has a single key,
   * because what is under test is that two contributions get the *same*
   * connection and that neither of them closes it.
   */
  function testProvider() {
    let connection: LspConnection | null = null
    let connected = false
    const counts = { acquired: 0, released: 0 }
    const leases = new Set<LspConnectionCallbacks>()
    const fanout: LspConnectionCallbacks = {
      onConnected: () => {
        connected = true
        for (const callbacks of leases) callbacks.onConnected()
      },
      onUnavailable: () => {
        connected = false
        for (const callbacks of leases) callbacks.onUnavailable()
      },
      onPublishDiagnostics: (params) => {
        for (const callbacks of leases) callbacks.onPublishDiagnostics(params)
      },
      onStatusChange: (status) => {
        for (const callbacks of leases) callbacks.onStatusChange?.(status)
      },
      onError: (error) => {
        for (const callbacks of leases) callbacks.onError?.(error)
      },
    }

    return {
      counts,
      provider: {
        acquire: (options: LspConnectionOptions, callbacks: LspConnectionCallbacks) => {
          counts.acquired += 1
          leases.add(callbacks)
          if (!connection) {
            connection = new LspConnection(options, fanout)
            connection.connect()
          } else if (connected) {
            queueMicrotask(() => {
              if (!leases.has(callbacks)) return
              callbacks.onStatusChange?.('ready')
              callbacks.onConnected()
            })
          }
          const held = connection
          return {
            connection: held,
            release: () => {
              counts.released += 1
              leases.delete(callbacks)
            },
          }
        },
      } satisfies LspConnectionProvider,
    }
  }

  function pluginWith(provider: LspConnectionProvider, transport: FakeTransport) {
    return createLanguageServerAdapterPlugin({
      name: 'editor.test-lsp',
      createTransport: () => transport,
      connectionProvider: provider,
      completion: { acceptTimingName: 'testLsp.completion.accept' },
    })
  }

  it('runs one initialize for two contributions on one connection', async () => {
    const transport = new FakeTransport()
    const { provider: connectionProvider, counts } = testProvider()
    const first = activatePlugin(pluginWith(connectionProvider, transport), { applyEdits: vi.fn() })
    const second = activatePlugin(pluginWith(connectionProvider, transport), {
      applyEdits: vi.fn(),
    })

    first.provider.createContribution(
      viewContributionContext(editorSnapshot('# One', 'one.md'), { features: first.features }),
    )
    transport.receive(initializeResponse(jsonMessage(transport.sent[0])))
    await flushPromises()
    second.provider.createContribution(
      viewContributionContext(editorSnapshot('# Two', 'two.md'), { features: second.features }),
    )
    await flushPromises()

    expect(counts.acquired).toBe(2)
    // One handshake, two documents. Before the seam existed this was two of
    // everything, because the connection died with the view that built it.
    expect(transport.sent.map((sent) => jsonMessage(sent).method)).toEqual([
      'initialize',
      'initialized',
      'textDocument/didOpen',
      'textDocument/didOpen',
    ])
    expect(transport.sent.filter(hasMethod('textDocument/didOpen')).map(textDocumentFor)).toEqual([
      expect.objectContaining({ uri: 'file:///one.md' }),
      expect.objectContaining({ uri: 'file:///two.md' }),
    ])
  })

  it('leaves the connection open when a contribution goes away', async () => {
    const transport = new FakeTransport()
    const { provider: connectionProvider, counts } = testProvider()
    const { features, provider } = activatePlugin(pluginWith(connectionProvider, transport), {
      applyEdits: vi.fn(),
    })
    const contribution = provider.createContribution(
      viewContributionContext(editorSnapshot('# One', 'one.md'), { features }),
    )
    if (!contribution) throw new Error('missing contribution')
    transport.receive(initializeResponse(jsonMessage(transport.sent[0])))
    await flushPromises()

    contribution.dispose()

    // Told the server this view's document is gone, and nothing more: closing the
    // socket is the provider's call, and it was not asked to.
    expect(transport.sent.filter(hasMethod('textDocument/didClose'))).toHaveLength(1)
    expect(counts.released).toBe(1)
    expect(transport.closed).toBe(false)
  })

  it('tells a contribution that joined a live connection that it is connected', async () => {
    const transport = new FakeTransport()
    const { provider: connectionProvider } = testProvider()
    const first = activatePlugin(pluginWith(connectionProvider, transport), { applyEdits: vi.fn() })
    first.provider.createContribution(
      viewContributionContext(editorSnapshot('# One', 'one.md'), { features: first.features }),
    )
    transport.receive(initializeResponse(jsonMessage(transport.sent[0])))
    await flushPromises()

    const onConnected = vi.fn()
    const late = activatePlugin(
      createLanguageServerAdapterPlugin({
        name: 'editor.test-lsp',
        createTransport: () => transport,
        connectionProvider,
        completion: { acceptTimingName: 'testLsp.completion.accept' },
        onConnected,
      }),
      { applyEdits: vi.fn() },
    )
    late.provider.createContribution(
      viewContributionContext(editorSnapshot('# Two', 'two.md'), { features: late.features }),
    )
    await flushPromises()

    expect(onConnected).toHaveBeenCalledTimes(1)
  })
})

describe('shared language-server documents', () => {
  it('advertises document-owned workspace edits before any view attaches', async () => {
    const onApplyWorkspaceEdit = vi.fn(async () => ({ status: 'applied' as const }))
    const document = createLanguageServerDocument({
      buffer: createEditorTextBuffer('# Notes'),
      uri: 'file:///README.md',
      languageId: 'markdown',
      onApplyWorkspaceEdit,
      lanes: [
        {
          id: 'test',
          features: { diagnostics: 0 },
          webSocketRoute: 'ws://localhost/lsp',
          webSocketTransportOptions: { WebSocketCtor: FakeWebSocket },
        },
      ],
    })
    const socket = FakeWebSocket.instances.at(-1)!
    socket.open()
    await flushPromises()
    expect(jsonMessage(socket.sent[0])).toMatchObject({
      method: 'initialize',
      params: {
        capabilities: {
          workspace: {
            workspaceEdit: {
              documentChanges: true,
              resourceOperations: ['create', 'rename', 'delete'],
            },
          },
        },
      },
    })
    expect(document.lanes[0]!.options.onApplyWorkspaceEdit).toBe(onApplyWorkspaceEdit)
    document.dispose()
  })

  it('retains diagnostics and synchronization without a view, then paints synchronously on reattachment', async () => {
    const buffer = createEditorTextBuffer('# Notes')
    const document = createLanguageServerDocument({
      buffer,
      uri: 'file:///README.md',
      languageId: 'markdown',
      lanes: [
        {
          id: 'test',
          features: { diagnostics: 0 },
          webSocketRoute: 'ws://localhost/lsp',
          webSocketTransportOptions: { WebSocketCtor: FakeWebSocket },
        },
      ],
    })
    const socket = FakeWebSocket.instances.at(-1)!
    socket.open()
    await flushPromises()
    socket.receive(initializeResponse(jsonMessage(socket.sent[0])))
    await document.lanes[0]!.connection.ready
    const mount = () => {
      const { provider, features } = activatePlugin(createLanguageServerPlugin({ document }), {
        applyEdits: vi.fn(),
      })
      const context = viewContributionContext(editorSnapshot(buffer.materializeFullText()), {
        features,
      })
      const view = provider.createContribution(context)!
      return { context, view }
    }
    const first = mount()
    socket.receive(publishDiagnosticsMessage())
    expect(first.context.setRangeHighlight).toHaveBeenCalledWith(
      'editor-test-lsp-plugin-error',
      [{ start: 0, end: 1 }],
      expect.any(Object),
    )
    first.view.dispose()
    expect(socket.sent.filter(hasMethod('textDocument/didClose'))).toHaveLength(0)

    const edit = createEditorBufferSession(buffer)
    edit.applyEdits([{ from: 7, to: 7, text: '!' }])
    await flushPromises()
    expect(socket.sent.filter(hasMethod('textDocument/didChange'))).toHaveLength(1)
    const diagnostic = {
      ...publishDiagnosticsMessage(),
      params: {
        uri: 'file:///README.md',
        version: 1,
        diagnostics: [
          {
            severity: 1,
            message: 'updated while hidden',
            range: { start: { line: 0, character: 2 }, end: { line: 0, character: 3 } },
          },
        ],
      },
    }
    socket.receive(diagnostic)
    socket.receive(publishDiagnosticsMessage())
    const second = mount()
    expect(second.context.setRangeHighlight).toHaveBeenCalledWith(
      'editor-test-lsp-plugin-error',
      [{ start: 2, end: 3 }],
      expect.any(Object),
    )
    expect(socket.sent.filter(hasMethod('textDocument/didOpen'))).toHaveLength(1)
    const split = mount()
    second.view.dispose()
    expect(socket.sent.filter(hasMethod('textDocument/didClose'))).toHaveLength(0)
    split.view.dispose()
    document.dispose()
    document.dispose()
    await flushPromises()
    expect(socket.sent.filter(hasMethod('textDocument/didClose'))).toHaveLength(1)
    const sent = socket.sent.length
    edit.applyEdits([{ from: 8, to: 8, text: '?' }])
    await flushPromises()
    expect(socket.sent).toHaveLength(sent)
  })
  it('marks a retired pooled connection unusable and clears its diagnostics', async () => {
    const pool = new LspConnectionPool()
    const document = createLanguageServerDocument({
      buffer: createEditorTextBuffer('# Notes'),
      uri: 'file:///README.md',
      languageId: 'markdown',
      lanes: [
        {
          id: 'test',
          features: { diagnostics: 0 },
          webSocketRoute: 'ws://localhost/lsp',
          connectionProvider: pool.provider('test'),
          webSocketTransportOptions: { WebSocketCtor: FakeWebSocket },
        },
      ],
    })
    const socket = FakeWebSocket.instances.at(-1)!
    socket.open()
    await flushPromises()
    socket.receive(initializeResponse(jsonMessage(socket.sent[0])))
    await document.lanes[0]!.connection.ready
    socket.receive(publishDiagnosticsMessage())
    expect(document.lanes[0]!.sync.diagnostics).toHaveLength(1)
    socket.close()
    expect(document.lanes[0]!.status).toBe('error')
    expect(document.lanes[0]!.sync.diagnostics).toHaveLength(0)
    document.dispose()
    pool.dispose()
  })

  it('reconnects after the server goes away and re-opens the document on the new one', async () => {
    vi.useFakeTimers()
    const pool = new LspConnectionPool()
    const freshness: string[] = []
    const document = freshnessDocument(pool, (summary) => freshness.push(summary.freshness), {
      delaysMs: [100],
    })
    const first = FakeWebSocket.instances.at(-1)!
    first.open()
    await flushPromises()
    first.receive(initializeResponse(jsonMessage(first.sent[0])))
    await document.lanes[0]!.connection.ready
    first.receive(publishDiagnosticsMessage())
    expect(freshness.at(-1)).toBe('current')

    first.close()
    expect(document.lanes[0]!.sync.diagnostics).toHaveLength(0)
    expect(freshness.at(-1)).toBe('unavailable')
    expect(document.lanes[0]!.status).toBe('loading')
    await vi.advanceTimersByTimeAsync(100)

    const second = FakeWebSocket.instances.at(-1)!
    expect(second).not.toBe(first)
    second.open()
    await flushPromises()
    second.receive(initializeResponse(jsonMessage(second.sent[0])))
    await vi.advanceTimersByTimeAsync(0)
    expect(sentMethods(second)).toContain('textDocument/didOpen')
    expect(document.lanes[0]!.status).toBe('ready')
    expect(freshness.at(-1)).toBe('silent')
    second.receive(publishDiagnosticsMessage())
    expect(freshness.at(-1)).toBe('current')
    document.dispose()
    pool.dispose()
    vi.useRealTimers()
  })

  it('gives up once its reconnect attempts run out', async () => {
    vi.useFakeTimers()
    const pool = new LspConnectionPool()
    const document = freshnessDocument(pool, () => undefined, { delaysMs: [100] })
    const created = FakeWebSocket.instances.length
    const first = FakeWebSocket.instances.at(-1)!
    first.open()
    await flushPromises()
    first.receive(initializeResponse(jsonMessage(first.sent[0])))
    await document.lanes[0]!.connection.ready

    first.close()
    await vi.advanceTimersByTimeAsync(100)
    FakeWebSocket.instances.at(-1)!.close()
    await vi.advanceTimersByTimeAsync(1000)

    expect(document.lanes[0]!.status).toBe('error')
    expect(document.lanes[0]!.diagnosticsFreshness).toBe('unavailable')
    // One reconnect for the one delay, then nothing more.
    expect(FakeWebSocket.instances.length - created).toBe(1)
    document.dispose()
    pool.dispose()
    vi.useRealTimers()
  })

  it('says a push server that has not published is silent, never pending', async () => {
    const pool = new LspConnectionPool()
    const freshness: string[] = []
    const document = freshnessDocument(pool, (summary) => freshness.push(summary.freshness))
    const socket = FakeWebSocket.instances.at(-1)!
    socket.open()
    await flushPromises()
    socket.receive(initializeResponse(jsonMessage(socket.sent[0])))
    await document.lanes[0]!.connection.ready

    expect(document.lanes[0]!.diagnosticsFreshness).toBe('silent')
    socket.receive(publishDiagnosticsMessage())
    expect(freshness.at(-1)).toBe('current')
    socket.close()
    expect(freshness.at(-1)).toBe('unavailable')
    document.dispose()
    pool.dispose()
  })

  it('tells a pending pull apart from its answer, first and on refresh', async () => {
    const pool = new LspConnectionPool()
    const summaries: { freshness: string; total: number }[] = []
    const document = freshnessDocument(pool, (summary) =>
      summaries.push({ freshness: summary.freshness, total: summary.counts.total }),
    )
    const socket = FakeWebSocket.instances.at(-1)!
    socket.open()
    await flushPromises()
    socket.receive(
      initializeResponse(jsonMessage(socket.sent[0]), {
        diagnosticProvider: { interFileDependencies: true, workspaceDiagnostics: false },
      }),
    )
    await document.lanes[0]!.connection.ready
    await flushPromises()

    expect(summaries.at(-1)).toEqual({ freshness: 'awaiting', total: 0 })
    socket.receive(pullAnswer(socket, [diagnosticItem()]))
    await flushPromises()
    expect(summaries.at(-1)).toEqual({ freshness: 'current', total: 1 })

    socket.receive({ jsonrpc: '2.0', method: 'workspace/diagnostic/refresh' })
    await flushPromises()
    // The earlier answer stays on screen, marked as being re-asked rather than as current.
    expect(summaries.at(-1)).toEqual({ freshness: 'refreshing', total: 1 })
    socket.receive(pullAnswer(socket, []))
    await flushPromises()
    expect(summaries.at(-1)).toEqual({ freshness: 'current', total: 0 })
    document.dispose()
    pool.dispose()
  })

  it('reports freshness without a LanguageServerDocument', async () => {
    const transport = new FakeTransport()
    const freshness: string[] = []
    const { features, provider } = activatePlugin(
      createLanguageServerAdapterPlugin({
        name: 'editor.test-lsp',
        createTransport: () => transport,
        onDiagnostics: (summary) => freshness.push(summary.freshness),
        diagnostics: {
          minimapSourceId: 'editor.test-lsp.diagnostics',
          highlightNameNamespace: 'test-lsp',
          markerTimingNamePrefix: 'testLsp.marker',
        },
        completion: {
          editFeature: createEditorCapabilityToken<LanguageServerCompletionEditFeature>(
            'test.lsp-plugin.freshness',
          ),
          acceptTimingName: 'testLsp.completion.accept',
        },
        hoverDefinition: {
          linkHighlightNameNamespace: 'test-lsp',
          tooltipClassNamespace: 'test-lsp',
          navigationTimingNamePrefix: 'testLsp',
        },
      }),
      { applyEdits: vi.fn() },
    )
    provider.createContribution(viewContributionContext(editorSnapshot(), { features }))
    transport.receive(initializeResponse(jsonMessage(transport.sent[0])))
    await flushPromises()

    transport.receive(publishDiagnosticsMessage())
    expect(freshness.at(-1)).toBe('current')
  })
})

function freshnessDocument(
  pool: LspConnectionPool,
  onDiagnostics: (summary: LanguageServerDiagnosticSummary) => void,
  reconnect?: LspReconnectOptions,
) {
  return createLanguageServerDocument({
    buffer: createEditorTextBuffer('# Notes'),
    uri: 'file:///README.md',
    languageId: 'markdown',
    lanes: [
      {
        id: 'test',
        features: { diagnostics: 0 },
        webSocketRoute: 'ws://localhost/lsp',
        connectionProvider: pool.provider('test'),
        webSocketTransportOptions: { WebSocketCtor: FakeWebSocket },
        onDiagnostics,
        reconnect,
      },
    ],
  })
}

function pullAnswer(socket: FakeWebSocket, items: lsp.Diagnostic[]): JsonMessage {
  const request = socket.sent.map(jsonMessage).findLast((message) => {
    return message.method === 'textDocument/diagnostic'
  })
  if (!request) throw new Error('no pull request was sent')
  return { jsonrpc: '2.0', id: request.id, result: { kind: 'full', items } }
}

function diagnosticItem(): lsp.Diagnostic {
  return {
    severity: 1,
    message: 'heading',
    range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } },
  }
}

function activatePlugin(
  plugin: LanguageServerPlugin,
  options: ActivationOptions,
): {
  readonly provider: EditorViewContributionProvider
  readonly commands: ReadonlyMap<EditorAnyCommandId, EditorCommandHandler>
  readonly features: ReadonlyMap<unknown, unknown>
} {
  let provider: EditorViewContributionProvider | null = null
  const commands = new Map<EditorAnyCommandId, EditorCommandHandler>()
  const features = new Map<unknown, unknown>()
  plugin.activate(
    createTestPluginContext({
      registerViewContribution: (value) => {
        provider = value
        return { dispose: () => undefined }
      },
      registerCommandContribution: (value) => {
        value.createContribution(commandContributionContext(commands))
        return { dispose: () => undefined }
      },
      registerEditContribution: (value) => {
        value.createContribution(editContributionContext(features, options.applyEdits))
        return { dispose: () => undefined }
      },
    }),
  )

  if (!provider) throw new Error('missing provider')
  return { provider, commands, features }
}

function commandContributionContext(
  commands: Map<EditorAnyCommandId, EditorCommandHandler>,
): EditorCommandContributionContext {
  return {
    registerCommand: (commandId, handler) => {
      commands.set(commandId, handler)
      return { dispose: () => commands.delete(commandId) }
    },
  }
}

function editContributionContext(
  features: Map<unknown, unknown>,
  applyEdits: EditorEditContributionContext['applyEdits'],
): EditorEditContributionContext {
  return createTestEditContributionContext({
    materializeFullText: () => '',
    applyEdits,
    registerFeature: (id, feature) => {
      features.set(id, feature)
      return { dispose: () => features.delete(id) }
    },
  })
}

function command(
  commands: ReadonlyMap<EditorAnyCommandId, EditorCommandHandler>,
  commandId: EditorAnyCommandId,
): EditorCommandHandler {
  const handler = commands.get(commandId)
  if (!handler) throw new Error(`missing command ${commandId}`)
  return handler
}

function viewContributionContext(
  snapshot: EditorViewSnapshot,
  options: { readonly features: ReadonlyMap<unknown, unknown> },
): EditorViewContributionContext {
  const element = document.createElement('div')
  const getFeature = vi.fn((token: unknown): unknown | null => {
    const feature = options.features.get(token)
    return feature === undefined ? null : feature
  }) as EditorViewContributionContext['getFeature']
  return createTestViewContributionContext({
    container: element,
    scrollElement: element,
    contentElement: element,
    highlightPrefix: 'editor-test',
    getSnapshot: () => snapshot,
    getFeature,
    setSelection: vi.fn(),
    textOffsetFromPoint: vi.fn(() => 0),
    getRangeClientRect: vi.fn(() => new DOMRect(10, 20, 40, 18)),
    setRangeHighlight: vi.fn(),
  })
}

function editorSnapshot(fullText = '# Notes', documentId = 'README.md'): EditorViewSnapshot {
  const lineStarts = [0]
  for (let index = 0; index < fullText.length; index += 1) {
    if (fullText.charCodeAt(index) === 10) lineStarts.push(index + 1)
  }
  return {
    ...documentSyncSnapshotFields(1),
    ...viewSnapshotStructuralFields(),
    documentId,
    languageId: 'markdown',
    ...viewTextFields(fullText),
    textVersion: 1,
    tokens: EditorTokenStore.empty(),
    brackets: [],
    selections: [
      { anchorOffset: 0, headOffset: 0, startOffset: 0, endOffset: 0, affinity: 'after' },
    ],
    metrics: {} as EditorViewSnapshot['metrics'],
    lineCount: lineStarts.length,
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

function initializeResponse(
  request: JsonMessage,
  capabilities: lsp.ServerCapabilities = {},
): JsonMessage {
  return {
    jsonrpc: '2.0',
    id: request.id,
    result: {
      capabilities: {
        textDocumentSync: {
          openClose: true,
          change: 2,
        },
        ...capabilities,
      },
    },
  }
}

function publishDiagnosticsMessage(): JsonMessage {
  return {
    jsonrpc: '2.0',
    method: 'textDocument/publishDiagnostics',
    params: {
      uri: 'file:///README.md',
      version: 0,
      diagnostics: [
        {
          severity: 1,
          message: 'heading',
          range: {
            start: { line: 0, character: 0 },
            end: { line: 0, character: 1 },
          },
        },
      ],
    },
  }
}

function textDocumentFor(item: unknown): unknown {
  const params = jsonMessage(item).params as { readonly textDocument: unknown }
  return params.textDocument
}

function jsonMessage(item: unknown): JsonMessage {
  if (typeof item !== 'string') throw new Error('missing JSON message')
  return JSON.parse(item) as JsonMessage
}

function hasMethod(method: string): (item: string) => boolean {
  return (item) => jsonMessage(item).method === method
}

function sentMethods(socket: FakeWebSocket): readonly unknown[] {
  return socket.sent.map((message) => jsonMessage(message).method)
}

async function flushPromises(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
}

async function renameSettlement(
  result: ApplyWorkspaceEditResult,
): Promise<Awaited<ReturnType<typeof connectedEditor>>> {
  const editor = await connectedEditor('const value = 1', 8, {
    onApplyWorkspaceEdit: async () => result,
    onRequestRenameName: async () => 'renamed',
  })
  editor.runCommand('editor.action.rename')
  await flushPromises()
  editor.answerRename({ changes: { [DOCUMENT_URI]: [] } })
  await flushPromises()
  await flushPromises()
  return editor
}

function renameInputElement(): HTMLElement | null {
  return document.querySelector<HTMLElement>('.lsp-plugin-rename')
}

function deferred<T>(): { readonly promise: Promise<T>; resolve(value: T): void } {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((settle) => {
    resolve = settle
  })
  return { promise, resolve }
}
