/*
 * An editor with a language server behind it, for the suites that cannot ask a completion question
 * without one: the answer arrives over a wire, is drawn into the page, and is steered by keystrokes.
 *
 * It lives in one module rather than one per suite because a copied harness drifts from its
 * original, and a drifted harness lets two suites disagree about what the editor does while both
 * stay green.
 */

import { EditorTokenStore } from '@singapore-editor/core/syntax'
import {
  type DocumentSessionChange,
  type SelectionAffinity,
  type TextEdit,
  type TextReadSnapshot,
} from '@singapore-editor/core/document'
import type { EditorAnyCommandId } from '@singapore-editor/core/editor'
import type {
  EditorCommandHandler,
  EditorEditContributionContext,
  EditorLanguageFeatureSelector,
  EditorLanguageFeatureToken,
  EditorViewContribution,
  EditorViewContributionContext,
  EditorViewContributionProvider,
  EditorViewSnapshot,
} from '@singapore-editor/core/extensions'
import { createHoverPlugin } from '@singapore-editor/plugin-ui'
import type { LspManagedTransport, LspTransportHandler } from '@singapore-editor/lsp'
import { vi } from 'vitest'
import type * as lsp from 'vscode-languageserver-protocol'

import { createLanguageServerAdapterPlugin } from '../src/plugin'
import { createTestKeymap } from '@singapore-editor/core/testing'
import type {
  ApplyWorkspaceEditRequest,
  ApplyWorkspaceEditResult,
  LanguageServerPluginOptions,
  LanguageServerRenamePrompt,
} from '../src/types'
import {
  documentSyncSnapshotFields,
  viewSnapshotStructuralFields,
  viewText,
  viewTextFields,
} from './documentSyncSnapshot'
import {
  createTestEditContributionContext,
  createTestPluginContext,
  createTestViewContributionContext,
} from '@singapore-editor/core/testing'

type JsonMessage = Record<string, unknown>

export const COMPLETION_ACCEPT_TIMING_NAME = 'testLsp.completion.accept'

/** What `documentId` below resolves to once the plugin has turned the path into a document uri. */
export const DOCUMENT_URI = 'file:///src/index.ts'

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

  public close(): void {
    this.handlers.clear()
  }

  public receive(message: unknown): void {
    for (const handler of this.handlers) handler(JSON.stringify(message))
  }
}

export type ConnectedEditor = {
  readonly applyEdits: ReturnType<typeof vi.fn<EditorEditContributionContext['applyEdits']>>
  readonly focusEditor: ReturnType<typeof vi.fn>
  dispose(): void
  type(character: string): void
  backspace(): void
  moveCaret(offset: number): void
  selectRange(start: number, end: number): void
  scroll(by: number): void
  /** The same anchor movement a scroll makes, reported as the view being laid out again. */
  relayout(by: number): void
  pointerMove(clientX: number, clientY: number, modifiers?: PointerEventInit): void
  editElsewhere(edit: TextEdit): void
  pressKey(key: string, modifiers?: KeyboardEventInit): KeyboardEvent
  breakAcceptance(): void
  answerCompletion(items: readonly lsp.CompletionItem[], isIncomplete?: boolean): void
  answerResolve(item: lsp.CompletionItem): void
  answerHover(hover: lsp.Hover | null): void
  answerDefinition(definition: readonly lsp.Location[]): void
  answerSignatureHelp(help: lsp.SignatureHelp | null): void
  /** Waits for a request a lazily loaded controller only sends once its module has landed. */
  awaitRequest(method: string): Promise<void>
  answerCodeAction(actions: readonly (lsp.Command | lsp.CodeAction)[] | null): void
  answerCodeActionResolve(action: lsp.CodeAction): void
  answerRename(edit: unknown): void
  publishDiagnostics(diagnostics: readonly lsp.Diagnostic[], version?: number): void
  runCommand(commandId: EditorAnyCommandId): boolean
  completionElement(): HTMLElement
  completionLabels(): readonly string[]
  focusedCompletionLabel(): string | null
  completionRequests(): readonly lsp.CompletionParams[]
  hoverRequests(): readonly lsp.HoverParams[]
  codeActionRequests(): readonly lsp.CodeActionParams[]
  renameRequests(): readonly lsp.RenameParams[]
  initializeParams(): lsp.InitializeParams
  reportedErrors(): readonly unknown[]
  workspaceEditRequests(): readonly ApplyWorkspaceEditRequest[]
  textSnapshot(): TextReadSnapshot
  /** The tab stops each accepted snippet handed the host, newest last. */
  startedSnippetSessions(): readonly (readonly SnippetStopRange[])[]
}

/** A stop and, where the snippet writes it more than once, the copies that have to follow it. */
type SnippetStopRange = {
  readonly start: number
  readonly end: number
  readonly mirrors?: readonly {
    readonly start: number
    readonly end: number
    readonly transform?: (value: string) => string
  }[]
}

export type ConnectedEditorOptions = {
  readonly capabilities?: lsp.ServerCapabilities
  readonly acceptOnCommitCharacter?: boolean
  readonly affinity?: SelectionAffinity
  readonly onApplyWorkspaceEdit?: (
    request: ApplyWorkspaceEditRequest,
  ) => Promise<ApplyWorkspaceEditResult>
  readonly onRequestRenameName?: (prompt: LanguageServerRenamePrompt) => Promise<string | null>
  readonly onDefinitionLinkHover?: LanguageServerPluginOptions['onDefinitionLinkHover']
  readonly onConnectionCreated?: LanguageServerPluginOptions['onConnectionCreated']
  /** Commands another contribution would have registered, reachable through the same keymap. */
  readonly commands?: ReadonlyMap<EditorAnyCommandId, EditorCommandHandler>
}

/**
 * The plugin driven the way the editor drives it: one coalesced content update per keystroke, a
 * live view snapshot, and the completion edit feature the edit contribution registers.
 */
export async function connectedEditor(
  text: string,
  caretOffset: number,
  options: ConnectedEditorOptions = {},
): Promise<ConnectedEditor> {
  const transport = new FakeTransport()
  const applyEdits = vi.fn<EditorEditContributionContext['applyEdits']>()
  const focusEditor = vi.fn()
  const features = new Map<unknown, unknown>()
  const element = document.createElement('div')
  let snapshot = editorSnapshot(text, caretOffset, 1, options.affinity ?? 'after')
  let anchorRect = new DOMRect(10, 20, 40, 18)

  const commands = new Map<EditorAnyCommandId, EditorCommandHandler>(options.commands)
  const errors: unknown[] = []
  const workspaceEditRequests: ApplyWorkspaceEditRequest[] = []
  const snippetSessions: (readonly SnippetStopRange[])[] = []
  const provider = activateProvider(
    transport,
    features,
    commands,
    applyEdits,
    errors,
    options,
    snippetSessions,
    workspaceEditRequests,
  )
  // The editor reports the keystroke separately from the edit it caused, because auto-closing and
  // typing over a closer both make the edit a poor stand-in for it.
  const typedTextListeners = new Set<(text: string) => void>()
  const keymap = createTestKeymap(element, commands)
  const context = viewContributionContext({
    element,
    registerKeymapContextKey: keymap.registerKeymapContextKey,
    getSnapshot: () => snapshot,
    getRangeClientRect: () => anchorRect,
    getFeature: (token) => features.get(token) ?? null,
    focusEditor,
    onDidType: (listener) => {
      typedTextListeners.add(listener)
      return () => typedTextListeners.delete(listener)
    },
  })
  // The hover is the host's, so the harness installs it the way an application would.
  const hover = activateHoverPlugin(commands).createContribution(context)
  const languageServer = provider.createContribution(context)
  if (!hover || !languageServer) throw new Error('missing contribution')
  const contribution: EditorViewContribution = {
    update: (next, kind, change) => {
      hover.update(next, kind, change)
      languageServer.update(next, kind, change)
    },
    dispose: () => {
      languageServer.dispose()
      hover.dispose()
    },
  }

  transport.receive({
    jsonrpc: '2.0',
    id: jsonMessage(transport.sent[0]).id,
    result: {
      capabilities: {
        codeActionProvider: true,
        completionProvider: {},
        definitionProvider: true,
        documentFormattingProvider: true,
        documentHighlightProvider: true,
        hoverProvider: true,
        implementationProvider: true,
        referencesProvider: true,
        renameProvider: true,
        signatureHelpProvider: {},
        textDocumentSync: { openClose: true, change: 2 },
        typeDefinitionProvider: true,
        ...options.capabilities,
      },
    },
  })
  await flushPromises()

  const awaitRequest = async (method: string): Promise<void> => {
    for (let turn = 0; turn < 100; turn++) {
      if (transport.sent.map(jsonMessage).some((sent) => sent.method === method)) return
      await new Promise((resolve) => setTimeout(resolve, 0))
    }
    throw new Error(`no ${method} request after waiting`)
  }

  const answer = (method: string, result: unknown): void => {
    const request = transport.sent.map(jsonMessage).findLast((sent) => sent.method === method)
    if (!request) throw new Error(`missing request ${method}`)
    transport.receive({ jsonrpc: '2.0', id: request.id, result })
  }

  const moveView = (by: number, kind: 'viewport' | 'layout'): void => {
    anchorRect = new DOMRect(anchorRect.x, anchorRect.y - by, anchorRect.width, anchorRect.height)
    contribution.update(snapshot, kind, null)
  }

  const applyChange = (edit: TextEdit, caretOffset: number): void => {
    const next = `${viewText(snapshot).slice(0, edit.from)}${edit.text}${viewText(snapshot).slice(edit.to)}`
    snapshot = editorSnapshot(
      next,
      caretOffset,
      snapshot.textVersion + 1,
      caretAffinityOf(snapshot),
    )
    contribution.update(snapshot, 'content', documentChange([edit]))
  }

  return {
    applyEdits,
    focusEditor,
    dispose: () => {
      contribution.dispose()
      keymap.dispose()
    },
    type: (character) => {
      const at = caretOffsetOf(snapshot)
      applyChange({ from: at, to: at, text: character }, at + character.length)
      for (const listener of [...typedTextListeners]) listener(character)
    },
    backspace: () => {
      const at = caretOffsetOf(snapshot)
      applyChange({ from: at - 1, to: at, text: '' }, at - 1)
    },
    editElsewhere: (edit) => applyChange(edit, caretOffsetOf(snapshot)),
    moveCaret: (offset) => {
      snapshot = editorSnapshot(
        viewText(snapshot),
        offset,
        snapshot.textVersion,
        caretAffinityOf(snapshot),
      )
      contribution.update(snapshot, 'selection', null)
    },
    selectRange: (start, end) => {
      snapshot = editorSnapshot(
        viewText(snapshot),
        end,
        snapshot.textVersion,
        caretAffinityOf(snapshot),
        start,
      )
      contribution.update(snapshot, 'selection', null)
    },
    scroll: (by) => moveView(by, 'viewport'),
    relayout: (by) => moveView(by, 'layout'),
    pointerMove: (clientX, clientY, modifiers = {}) => {
      element.dispatchEvent(
        new PointerEvent('pointermove', {
          bubbles: true,
          buttons: 0,
          clientX,
          clientY,
          ...modifiers,
        }),
      )
    },
    pressKey: (key, modifiers = {}) => {
      const event = new KeyboardEvent('keydown', {
        key,
        bubbles: true,
        cancelable: true,
        ...modifiers,
      })
      element.dispatchEvent(event)
      return event
    },
    // Takes the edit feature away, which is what an acceptance needs to apply an item at all — the
    // state a session can genuinely be in when the document stops being editable under it.
    breakAcceptance: () => features.clear(),
    answerCompletion: (items, isIncomplete = false) =>
      answer('textDocument/completion', { isIncomplete, items }),
    answerResolve: (item) => answer('completionItem/resolve', item),
    answerHover: (hover) => answer('textDocument/hover', hover),
    answerDefinition: (definition) => answer('textDocument/definition', definition),
    answerSignatureHelp: (help) => answer('textDocument/signatureHelp', help),
    awaitRequest,
    answerCodeAction: (actions) => answer('textDocument/codeAction', actions),
    answerCodeActionResolve: (action) => answer('codeAction/resolve', action),
    answerRename: (edit) => answer('textDocument/rename', edit),
    publishDiagnostics: (diagnostics, version) =>
      transport.receive({
        jsonrpc: '2.0',
        method: 'textDocument/publishDiagnostics',
        params: { diagnostics, uri: DOCUMENT_URI, version },
      }),
    runCommand: (commandId) => {
      const handler = commands.get(commandId)
      if (!handler) throw new Error(`missing command ${commandId}`)
      return handler({})
    },
    completionElement: () => {
      const widget = document.querySelector<HTMLElement>('.editor-test-lsp-completion')
      if (!widget) throw new Error('missing completion widget')
      return widget
    },
    completionLabels: () =>
      Array.from(
        document.querySelectorAll<HTMLElement>('.editor-test-lsp-completion [role="option"]'),
        (row) => row.children[1]?.textContent ?? '',
      ),
    focusedCompletionLabel: () =>
      document.querySelector<HTMLElement>('.editor-test-lsp-completion [aria-selected="true"]')
        ?.children[1]?.textContent ?? null,
    completionRequests: () =>
      transport.sent
        .map(jsonMessage)
        .filter((sent) => sent.method === 'textDocument/completion')
        .map((sent) => sent.params as lsp.CompletionParams),
    hoverRequests: () =>
      transport.sent
        .map(jsonMessage)
        .filter((sent) => sent.method === 'textDocument/hover')
        .map((sent) => sent.params as lsp.HoverParams),
    codeActionRequests: () =>
      transport.sent
        .map(jsonMessage)
        .filter((sent) => sent.method === 'textDocument/codeAction')
        .map((sent) => sent.params as lsp.CodeActionParams),
    renameRequests: () =>
      transport.sent
        .map(jsonMessage)
        .filter((sent) => sent.method === 'textDocument/rename')
        .map((sent) => sent.params as lsp.RenameParams),
    initializeParams: () => {
      const sent = transport.sent.map(jsonMessage).find((entry) => entry.method === 'initialize')
      if (!sent) throw new Error('missing initialize request')
      return sent.params as lsp.InitializeParams
    },
    reportedErrors: () => errors,
    workspaceEditRequests: () => workspaceEditRequests,
    textSnapshot: () => snapshot.textSnapshot,
    startedSnippetSessions: () => snippetSessions,
  }
}

export async function flushPromises(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
}

export function singleLineRange(start: number, end: number): lsp.Range {
  return { start: { line: 0, character: start }, end: { line: 0, character: end } }
}

function activateProvider(
  transport: LspManagedTransport,
  features: Map<unknown, unknown>,
  commands: Map<EditorAnyCommandId, EditorCommandHandler>,
  applyEdits: EditorEditContributionContext['applyEdits'],
  errors: unknown[],
  options: ConnectedEditorOptions,
  snippetSessions: (readonly SnippetStopRange[])[],
  workspaceEditRequests: ApplyWorkspaceEditRequest[],
): EditorViewContributionProvider {
  let provider: EditorViewContributionProvider | null = null
  const disposable = { dispose: () => undefined }
  createLanguageServerAdapterPlugin({
    name: 'editor.test-lsp',
    createTransport: () => transport,
    completion: {
      acceptTimingName: COMPLETION_ACCEPT_TIMING_NAME,
      widgetClassNamespace: 'test-lsp',
      acceptOnCommitCharacter: options.acceptOnCommitCharacter ?? false,
    },
    onError: (error) => errors.push(error),
    onApplyWorkspaceEdit: async (request) => {
      workspaceEditRequests.push(request)
      return options.onApplyWorkspaceEdit?.(request) ?? { status: 'applied' }
    },
    onRequestRenameName: options.onRequestRenameName,
    onDefinitionLinkHover: options.onDefinitionLinkHover,
    onConnectionCreated: options.onConnectionCreated,
    onRequestError: (_serverId, _method, error) => errors.push(error),
  }).activate(
    createTestPluginContext({
      registerViewContribution: (value) => {
        provider = value
        return disposable
      },
      registerCommandContribution: (value) => {
        value.createContribution({
          registerCommand: (commandId, handler) => {
            commands.set(commandId, handler)
            return { dispose: () => commands.delete(commandId) }
          },
        })
        return disposable
      },
      registerEditContribution: (value) => {
        value.createContribution(
          createTestEditContributionContext({
            materializeFullText: () => '',
            focusEditor: vi.fn(),
            applyEdits,
            startSnippetSession: (ranges) => snippetSessions.push(ranges),
            registerFeature: (id, feature) => {
              features.set(id, feature)
              return { dispose: () => features.delete(id) }
            },
          }),
        )
        return disposable
      },
    }),
  )

  if (!provider) throw new Error('missing provider')
  return provider
}

function activateHoverPlugin(
  commands: Map<EditorAnyCommandId, EditorCommandHandler>,
): EditorViewContributionProvider {
  let provider: EditorViewContributionProvider | null = null
  const disposable = { dispose: () => undefined }
  createHoverPlugin({ classNamespace: 'test' }).activate(
    createTestPluginContext({
      registerViewContribution: (value) => {
        provider = value
        return disposable
      },
      registerCommandContribution: (value) => {
        value.createContribution({
          registerCommand: (commandId, handler) => {
            commands.set(commandId, handler)
            return { dispose: () => commands.delete(commandId) }
          },
        })
        return disposable
      },
    }),
  )

  if (!provider) throw new Error('missing hover provider')
  return provider
}

/** The core registry, reduced to what a single-document harness needs: order of registration. */
function providerRegistry(): Pick<
  Required<EditorViewContributionContext>,
  'registerProvider' | 'getProviders'
> {
  const providers = new Map<string, unknown[]>()
  return {
    registerProvider: <T>(
      token: EditorLanguageFeatureToken<T>,
      _selector: EditorLanguageFeatureSelector,
      provider: T,
    ) => {
      const list = providers.get(token.id) ?? []
      list.push(provider)
      providers.set(token.id, list)
      return {
        dispose: () => {
          const index = list.indexOf(provider)
          if (index !== -1) list.splice(index, 1)
        },
      }
    },
    getProviders: <T>(token: EditorLanguageFeatureToken<T>) =>
      (providers.get(token.id) ?? []) as readonly T[],
  }
}

function viewContributionContext(options: {
  element: HTMLDivElement
  getSnapshot(): EditorViewSnapshot
  getRangeClientRect(): DOMRect
  getFeature(token: unknown): unknown
  focusEditor(): void
  onDidType(listener: (text: string) => void): () => void
  registerKeymapContextKey: EditorViewContributionContext['registerKeymapContextKey']
}): EditorViewContributionContext {
  return createTestViewContributionContext({
    ...providerRegistry(),
    registerKeymapContextKey: options.registerKeymapContextKey,
    onDidType: (listener) => ({ dispose: options.onDidType(listener) }),
    container: options.element,
    scrollElement: options.element,
    contentElement: options.element,
    highlightPrefix: 'editor-test',
    getSnapshot: options.getSnapshot,
    getFeature: options.getFeature as EditorViewContributionContext['getFeature'],
    focusEditor: options.focusEditor,
    textOffsetFromPoint: vi.fn(() => 0),
    getRangeClientRect: () => options.getRangeClientRect(),
  })
}

function editorSnapshot(
  fullText: string,
  caretOffset: number,
  textVersion: number,
  affinity: SelectionAffinity,
  anchorOffset = caretOffset,
): EditorViewSnapshot {
  return {
    ...documentSyncSnapshotFields(textVersion),
    ...viewSnapshotStructuralFields(),
    documentId: 'src/index.ts',
    languageId: 'typescript',
    ...viewTextFields(fullText),
    textVersion,
    tokens: EditorTokenStore.empty(),
    brackets: [],
    selections: [
      {
        anchorOffset,
        headOffset: caretOffset,
        startOffset: Math.min(anchorOffset, caretOffset),
        endOffset: Math.max(anchorOffset, caretOffset),
        affinity,
      },
    ],
    metrics: {} as EditorViewSnapshot['metrics'],
    lineCount: lineStartsOf(fullText).length,
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

/** Real ones, so a suite can hand the harness a document with more than one line in it. */
function lineStartsOf(fullText: string): readonly number[] {
  const starts = [0]
  for (
    let index = fullText.indexOf('\n');
    index !== -1;
    index = fullText.indexOf('\n', index + 1)
  ) {
    starts.push(index + 1)
  }
  return starts
}

function caretOffsetOf(snapshot: EditorViewSnapshot): number {
  const selection = snapshot.selections[0]
  if (!selection) throw new Error('missing selection')
  return selection.headOffset
}

function caretAffinityOf(snapshot: EditorViewSnapshot): SelectionAffinity {
  return snapshot.selections[0]!.affinity
}

function documentChange(edits: readonly TextEdit[]): DocumentSessionChange {
  return { kind: 'edit', edits } as unknown as DocumentSessionChange
}

function jsonMessage(item: unknown): JsonMessage {
  if (typeof item !== 'string') throw new Error('missing JSON message')
  return JSON.parse(item) as JsonMessage
}
