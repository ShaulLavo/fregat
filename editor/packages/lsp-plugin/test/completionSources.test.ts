import { EditorTokenStore } from '@singapore-editor/core/syntax'
import type { DocumentSessionChange, TextEdit } from '@singapore-editor/core/document'
import { createEditorLanguageFeatureToken } from '@singapore-editor/core/extensions'
import type {
  EditorCommandHandler,
  EditorDisposable,
  EditorEditContributionContext,
  EditorViewContributionContext,
  EditorViewContributionProvider,
  EditorViewSnapshot,
} from '@singapore-editor/core/extensions'
import type { LspManagedTransport, LspTransportHandler } from '@singapore-editor/lsp'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type * as lsp from 'vscode-languageserver-protocol'

import {
  LanguageServerCompletionSources,
  type EditorCompletionSource,
} from '../src/completionProviders'
import { createLanguageServerAdapterPlugin } from '../src/plugin'
import { createTestKeymap, type TestKeymap } from '@singapore-editor/core/testing'
import type { EditorAnyCommandId } from '@singapore-editor/core/editor'
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

const COMPLETION_ACCEPT_TIMING_NAME = 'testLsp.completion.accept'

// Named, not imported: a source shipped outside this package reaches the same list by restating the
// id, and a test that shares the constant would never notice if the two drifted apart.
const COMPLETION_SOURCES =
  createEditorLanguageFeatureToken<EditorCompletionSource>('editor.completionSource')

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

// Each harness's keymap listens on the document too, so it goes with the test that made it.
const keymaps: TestKeymap[] = []

describe('a completion list built from several sources', () => {
  afterEach(() => {
    vi.useRealTimers()
    document.body.replaceChildren()
    for (const keymap of keymaps.splice(0)) keymap.dispose()
  })

  it('keeps ambient providers when the server set contributes no completion lane', () => {
    const ambient = itemSource([{ label: 'snippet' }])
    const getProviders = vi.fn(() => [ambient])
    const sources = new LanguageServerCompletionSources(
      createTestViewContributionContext({
        getProviders: getProviders as EditorViewContributionContext['getProviders'],
      }),
      [],
    )

    expect(sources.forLanguage('typescript')).toEqual([ambient])
    expect(getProviders).toHaveBeenCalledWith(COMPLETION_SOURCES, 'typescript')
  })

  it('shows what every source registered for the feature answered, as one list', async () => {
    vi.useFakeTimers()
    const editor = await connectedEditor({
      sources: [itemSource([{ label: 'snippetForEach' }])],
    })

    editor.type('.')
    await vi.advanceTimersByTimeAsync(90)
    editor.answerCompletion([{ label: 'serverValue' }])
    await flushPromises()

    // The one registered first is asked first, and the widget is handed the two answers joined
    // rather than whichever arrived last.
    expect(editor.completionLabels()).toEqual(['snippetForEach', 'serverValue'])
    // Asked on behalf of the document's own language, which is what decides who answers at all.
    expect(editor.askedLanguages()).toContain('typescript')
  })

  it('answers from the other sources while the server has not finished connecting', async () => {
    vi.useFakeTimers()
    const editor = await connectedEditor({
      connect: false,
      sources: [itemSource([{ label: 'snippetForEach' }])],
    })

    editor.type('.')
    await vi.advanceTimersByTimeAsync(90)
    await flushPromises()

    expect(editor.completionLabels()).toEqual(['snippetForEach'])
    expect(editor.requests('textDocument/completion')).toHaveLength(0)
  })

  it('leaves the list standing when one source fails and another answers', async () => {
    vi.useFakeTimers()
    const failures: unknown[] = []
    const editor = await connectedEditor({
      onError: (error) => failures.push(error),
      sources: [
        { provideCompletionItems: () => Promise.reject(new Error('index unavailable')) },
        itemSource([{ label: 'snippetForEach' }]),
      ],
    })

    editor.type('.')
    await vi.advanceTimersByTimeAsync(90)
    editor.answerCompletion([{ label: 'serverValue' }])
    await flushPromises()

    expect(editor.completionLabels()).toEqual(['snippetForEach', 'serverValue'])
    expect(failures).toHaveLength(1)
  })

  // Which items need a second round-trip is a fact about the source that sent them, not about the
  // one connection the widget happens to sit next to.
  it('applies an item from a source that resolves nothing, though the server resolves', async () => {
    vi.useFakeTimers()
    const editor = await connectedEditor({
      capabilities: { completionProvider: { resolveProvider: true } },
      sources: [itemSource([{ label: 'snippetForEach' }])],
    })

    editor.type('.')
    await vi.advanceTimersByTimeAsync(90)
    editor.answerCompletion([{ label: 'serverValue' }])
    await flushPromises()
    editor.pressEnter()

    expect(editor.applyEdits).toHaveBeenCalledWith(
      [{ from: 9, to: 9, text: 'snippetForEach' }],
      COMPLETION_ACCEPT_TIMING_NAME,
      { anchor: 23, head: 23, affinity: 'after' },
    )
    expect(editor.requests('completionItem/resolve')).toHaveLength(0)
  })

  it('stops asking a source once its registration is disposed', async () => {
    vi.useFakeTimers()
    const editor = await connectedEditor({
      sources: [itemSource([{ label: 'snippetForEach' }])],
    })

    editor.disposeSource(0)
    editor.type('.')
    await vi.advanceTimersByTimeAsync(90)
    editor.answerCompletion([{ label: 'serverValue' }])
    await flushPromises()

    expect(editor.completionLabels()).toEqual(['serverValue'])
  })
})

function itemSource(items: readonly lsp.CompletionItem[]): EditorCompletionSource {
  return { provideCompletionItems: () => items }
}

type ConnectedEditor = {
  readonly applyEdits: ReturnType<typeof vi.fn<EditorEditContributionContext['applyEdits']>>
  type(character: string): void
  pressEnter(): void
  disposeSource(index: number): void
  askedLanguages(): readonly (string | null)[]
  answerCompletion(items: readonly lsp.CompletionItem[]): void
  completionLabels(): readonly string[]
  requests(method: string): readonly JsonMessage[]
}

/**
 * The plugin on a host that has the provider channel, with sources of the caller's own already
 * registered — which is the shape a snippet set or a second server arrives in.
 */
async function connectedEditor(options: {
  readonly sources: readonly EditorCompletionSource[]
  readonly capabilities?: lsp.ServerCapabilities
  readonly connect?: boolean
  readonly onError?: (error: unknown) => void
}): Promise<ConnectedEditor> {
  const transport = new FakeTransport()
  const applyEdits = vi.fn<EditorEditContributionContext['applyEdits']>()
  const features = new Map<unknown, unknown>()
  const element = document.createElement('div')
  const channel = providerChannel()
  let snapshot = editorSnapshot('const va', 8, 1)

  // Registered before the plugin's own, so the order the widget shows is the order they were
  // registered in rather than the order they answered in.
  const registrations = options.sources.map((source) =>
    channel.registerProvider(COMPLETION_SOURCES, { language: '*' }, source),
  )

  const commands = new Map<EditorAnyCommandId, EditorCommandHandler>()
  const provider = activateProvider(transport, features, applyEdits, commands, options.onError)
  const keymap = createTestKeymap(element, commands)
  keymaps.push(keymap)
  const contribution = provider.createContribution(
    createTestViewContributionContext({
      registerKeymapContextKey: keymap.registerKeymapContextKey,
      container: element,
      scrollElement: element,
      contentElement: element,
      highlightPrefix: 'editor-test',
      getSnapshot: () => snapshot,
      getFeature: ((token: unknown) =>
        features.get(token) ?? null) as EditorViewContributionContext['getFeature'],
      getProviders: channel.getProviders,
      registerProvider: channel.registerProvider,
      textOffsetFromPoint: vi.fn(() => 0),
      getRangeClientRect: vi.fn(() => new DOMRect(10, 20, 40, 18)),
    }),
  )
  if (!contribution) throw new Error('missing contribution')

  if (options.connect !== false) {
    transport.receive({
      jsonrpc: '2.0',
      id: jsonMessage(transport.sent[0]).id,
      result: {
        capabilities: {
          completionProvider: {},
          textDocumentSync: { openClose: true, change: 2 },
          ...options.capabilities,
        },
      },
    })
    await flushPromises()
  }

  const requests = (method: string): readonly JsonMessage[] =>
    transport.sent.map(jsonMessage).filter((sent) => sent.method === method)

  return {
    applyEdits,
    type: (character) => {
      const at = snapshot.selections[0]?.headOffset ?? 0
      const next = `${viewText(snapshot).slice(0, at)}${character}${viewText(snapshot).slice(at)}`
      snapshot = editorSnapshot(next, at + character.length, snapshot.textVersion + 1)
      contribution.update(
        snapshot,
        'content',
        documentChange([{ from: at, to: at, text: character }]),
      )
    },
    pressEnter: () => {
      element.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
      )
    },
    disposeSource: (index) => registrations[index]?.dispose(),
    askedLanguages: () => channel.askedLanguages,
    answerCompletion: (items) => {
      const request = requests('textDocument/completion').at(-1)
      if (!request) throw new Error('missing completion request')
      transport.receive({ jsonrpc: '2.0', id: request.id, result: { isIncomplete: false, items } })
    },
    completionLabels: () =>
      Array.from(
        document.querySelectorAll<HTMLElement>('.editor-test-lsp-completion [role="option"]'),
        (row) => row.children[1]?.textContent ?? '',
      ),
    requests,
  }
}

/**
 * The host side of the provider channel, keyed by token id and handing the sources back in the
 * order they registered. What a selector does to that order belongs to the editor's own registry
 * and is settled there.
 */
function providerChannel(): {
  readonly askedLanguages: readonly (string | null)[]
  getProviders: NonNullable<EditorViewContributionContext['getProviders']>
  registerProvider: NonNullable<EditorViewContributionContext['registerProvider']>
} {
  const entries: { readonly id: string; readonly provider: unknown }[] = []
  const askedLanguages: (string | null)[] = []

  return {
    askedLanguages,
    getProviders: ((token: { readonly id: string }, languageId: string | null) => {
      askedLanguages.push(languageId)
      return entries.filter((entry) => entry.id === token.id).map((entry) => entry.provider)
    }) as NonNullable<EditorViewContributionContext['getProviders']>,
    registerProvider: ((token: { readonly id: string }, _selector: unknown, provider: unknown) => {
      const entry = { id: token.id, provider }
      entries.push(entry)
      return {
        dispose: () => {
          const index = entries.indexOf(entry)
          if (index !== -1) entries.splice(index, 1)
        },
      }
    }) as NonNullable<EditorViewContributionContext['registerProvider']>,
  }
}

function activateProvider(
  transport: LspManagedTransport,
  features: Map<unknown, unknown>,
  applyEdits: EditorEditContributionContext['applyEdits'],
  commands: Map<EditorAnyCommandId, EditorCommandHandler>,
  onError?: (error: unknown) => void,
): EditorViewContributionProvider {
  let provider: EditorViewContributionProvider | null = null
  const disposable: EditorDisposable = { dispose: () => undefined }
  createLanguageServerAdapterPlugin({
    name: 'editor.test-lsp',
    createTransport: () => transport,
    completion: {
      acceptTimingName: COMPLETION_ACCEPT_TIMING_NAME,
      widgetClassNamespace: 'test-lsp',
    },
    onError,
  }).activate(
    createTestPluginContext({
      registerHighlighter: () => disposable,
      registerSyntaxProvider: () => disposable,
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
      registerCapabilityContribution: () => disposable,
      registerEditContribution: (value) => {
        value.createContribution(
          createTestEditContributionContext({
            materializeFullText: () => '',
            applyEdits,
            registerFeature: (id, feature) => {
              features.set(id, feature)
              return { dispose: () => features.delete(id) }
            },
          }),
        )
        return disposable
      },
      registerDecorationContribution: () => disposable,
      registerGutterContribution: () => disposable,
      registerInjectedTextRowProvider: () => disposable,
    }),
  )

  if (!provider) throw new Error('missing provider')
  return provider
}

function editorSnapshot(
  fullText: string,
  caretOffset: number,
  textVersion: number,
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
        anchorOffset: caretOffset,
        headOffset: caretOffset,
        startOffset: caretOffset,
        endOffset: caretOffset,
        affinity: 'after',
      },
    ],
    metrics: {} as EditorViewSnapshot['metrics'],
    lineCount: 1,
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

function documentChange(edits: readonly TextEdit[]): DocumentSessionChange {
  return { kind: 'edit', edits } as unknown as DocumentSessionChange
}

function jsonMessage(item: unknown): JsonMessage {
  if (typeof item !== 'string') throw new Error('missing JSON message')
  return JSON.parse(item) as JsonMessage
}

async function flushPromises(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
}
