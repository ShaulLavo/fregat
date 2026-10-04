import { expect } from 'vitest'
import { createEditorBufferSession } from '@singapore-editor/core/document'
import { Editor, type EditorDocumentAnalysis } from '@singapore-editor/core/editor'
import { EditorTokenStore } from '@singapore-editor/core/syntax'
import type { EditorHighlighterProvider } from '@singapore-editor/core/extensions'
import { createShikiWorkerOwner } from '@singapore-editor/core/shiki'
import {
  createTreeSitterSyntaxProvider,
  TreeSitterWorkerClient,
} from '@singapore-editor/tree-sitter'
import { TREE_SITTER_LANGUAGE_CONTRIBUTIONS } from '@singapore-editor/tree-sitter-languages'
import { emptyWorkspaceState } from '@/features/workspace/state/cache'
import { createApplicationRuntime } from '@/state/application-runtime'
import { primaryQueryClient } from '@/lib/environments/state/query-clients'
import { activeServerOrigin } from '@/lib/client'
import { useEnvironmentsStore } from '@/lib/environments/state/store'
import { createEnvironmentEntry } from '@workspace/client-core/environments/utils/connection'
import { filesystemPath } from '@/lib/documents/utils/identity'
import { settingsKeys } from '@workspace/client-core/settings/query-keys'
import { DEFAULT_SETTING_VALUES } from '@workspace/contracts'
import { editorMutationKeys } from '@/features/editor/utils/mutation-keys'
import { settingsSnapshot } from './settings'
import { fixtureEnvironmentId } from './chat'
import {
  inactiveBound,
  retentionFixtureText,
  type RetentionFixture,
} from './retention-count-policy-protocol'

type Analysis = EditorDocumentAnalysis
type Structural = NonNullable<ReturnType<Analysis['borrowStructural']>>
type Highlighter = NonNullable<ReturnType<Analysis['borrowHighlighter']>>
type Pair = { readonly structural: Structural; readonly highlighter: Highlighter }

export async function retentionCountHost(fixture: RetentionFixture) {
  const [language, theme] = await Promise.all([
    fixture.language === 'typescript'
      ? import('shiki/langs/typescript.mjs')
      : import('shiki/langs/markdown.mjs'),
    import('shiki/themes/github-dark.mjs'),
  ])
  const queries = primaryQueryClient()
  const previousSettings = queries.getQueryData(settingsKeys.document())
  const initialOrigin = activeServerOrigin()
  const previousEnvironments = useEnvironmentsStore.getState()
  let sequence = 0
  function setLimit(limit: number) {
    queries.setQueryData(
      settingsKeys.document(),
      settingsSnapshot({
        sequence: sequence++,
        values: { 'editor.inactiveAnalysisEntryLimit': limit },
      }),
    )
  }
  setLimit(DEFAULT_SETTING_VALUES['editor.inactiveAnalysisEntryLimit'])
  const application = createApplicationRuntime({
    workspaceCache: emptyWorkspaceState(),
    preparation: {
      appliedThemeContentHash: null,
      appliedThemeId: null,
      selectedThemeId: 'dark',
      syntaxHighlightingEnabled: false,
      analysisLimitMiCodeUnits: 10,
      tabSize: 4,
    },
  })
  const tree = new TreeSitterWorkerClient()
  const structuralProvider = createTreeSitterSyntaxProvider({ backend: tree })
  for (const contribution of TREE_SITTER_LANGUAGE_CONTRIBUTIONS)
    structuralProvider.registerLanguage(contribution)
  const shiki = createShikiWorkerOwner()
  const registrations = {
    languageRegistrations: language.default,
    themeRegistration: { ...theme.default, name: 'github-dark' },
    themeRegistrations: [],
  }
  const highlighterProvider: EditorHighlighterProvider = {
    createSession(options) {
      return shiki.createSession({
        ...options,
        lang: fixture.language,
        theme: 'github-dark',
        registrations,
      })
    },
  }
  const failedHighlighterProvider: EditorHighlighterProvider = {
    createSession(options) {
      return shiki.createSession({
        ...options,
        lang: 'retention-unregistered-language',
        theme: 'github-dark',
        registrations,
      })
    },
  }
  const source = retentionFixtureText(fixture)
  function createDocument(name: string) {
    return application
      .getSnapshot()
      .editor.documentStore.getState()
      .ensureLiveEditorDocument({
        path: filesystemPath(
          `retention-${fixture.id}-${name}.${fixture.language === 'markdown' ? 'md' : 'ts'}`,
        ),
        content: source,
        mtimeMs: 0,
        size: source.length,
        version: `${fixture.id}-${name}`,
      })
  }
  const a = createDocument('a')
  const savedSnapshot = a.buffer.getSnapshot()
  const working = [createDocument('c'), createDocument('d'), createDocument('e')]
  // The second retained environment has an external identity fixture and shared syntax workers.
  const survivorOrigin = new URL(initialOrigin)
  survivorOrigin.hostname = survivorOrigin.hostname === 'localhost' ? '127.0.0.1' : 'localhost'
  useEnvironmentsStore.setState((state) => ({
    entries: {
      ...state.entries,
      [survivorOrigin.origin]: {
        ...createEnvironmentEntry(survivorOrigin.origin, survivorOrigin.origin),
        environmentId: fixtureEnvironmentId(2),
      },
    },
  }))
  application.activateEnvironment(survivorOrigin.origin)
  const survivorEditor = application.getSnapshot().editor
  const b = createDocument('b')
  application.activateEnvironment(initialOrigin)
  const aSession = createEditorBufferSession(a.buffer)
  const bSession = createEditorBufferSession(b.buffer)
  aSession.setSelection(0)
  aSession.applyText('dirty ')
  const dirtyRevision = a.buffer.getRevision()
  const dirtySnapshot = a.buffer.getSnapshot()
  const views = new Set<{ dispose(): void }>()

  function borrow(analysis: Analysis, tag = 'fixed'): Pair {
    const structural = analysis.borrowStructural({
      provider: structuralProvider,
      languageId: fixture.language,
      configurationTag: [tag],
    })
    const highlighter = analysis.borrowHighlighter({
      provider: highlighterProvider,
      languageId: fixture.language,
      configurationTag: [tag],
    })
    if (!structural || !highlighter) throw new TypeError('Real syntax providers refused a fixture')
    return { structural, highlighter }
  }
  function release(pair: Pair) {
    pair.structural.dispose()
    pair.highlighter.dispose()
  }
  function createView(name: string, document = a) {
    const wrapper = window.document.createElement('div')
    const container = window.document.createElement('div')
    wrapper.dataset.retentionView = name
    wrapper.style.height = '240px'
    wrapper.style.width = '600px'
    wrapper.append(container)
    window.document.body.append(wrapper)
    const editor = new Editor(container, {
      plugins: [
        {
          activate(context) {
            return [
              context.registerSyntaxProvider(structuralProvider),
              context.registerHighlighter(highlighterProvider),
            ]
          },
        },
      ],
    })
    editor.attachSession(createEditorBufferSession(document.buffer), {
      analysis: document.analysis,
      documentId: document.analysis.documentId,
      languageId: fixture.language,
      structuralConfigurationTag: ['actual-view'],
      highlighterConfigurationTag: ['actual-view'],
    })
    const view = {
      editor,
      dispose() {
        views.delete(view)
        try {
          editor.dispose()
        } finally {
          wrapper.remove()
        }
      },
    }
    views.add(view)
    return view
  }
  async function refresh(pair: Pair, analysis: Analysis) {
    await Promise.all([
      pair.structural.refresh(analysis.buffer.getTextSnapshot()),
      pair.highlighter.refresh(analysis.buffer.getTextSnapshot()),
    ])
    await pair.structural.queryRange({ startIndex: 0, endIndex: 2048 })
  }
  async function settle() {
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
    await Promise.resolve()
    await expect
      .poll(() =>
        queries
          .getMutationCache()
          .findAll({
            mutationKey: editorMutationKeys.analysisRetention(),
          })
          .some((mutation) => mutation.state.status === 'pending'),
      )
      .toBe(false)
    await expect
      .poll(() => tree.inspect().pendingRequests + shiki.inspect().pendingRequests)
      .toBe(0)
    await Promise.all([tree.awaitIdleFence(), shiki.awaitIdleFence()])
    await Promise.resolve()
    await expect
      .poll(() =>
        queries
          .getMutationCache()
          .findAll({
            mutationKey: editorMutationKeys.analysisRetention(),
          })
          .some((mutation) => mutation.state.status === 'pending'),
      )
      .toBe(false)
  }
  function census() {
    const owners = Array.from(new Set(application.enumerateRetainedEditorAnalyses()))
    const inspections = owners.map((analysis) => ({
      documentId: analysis.documentId,
      ...analysis.inspectRetention(),
    }))
    const entries = inspections.flatMap((inspection) =>
      Array.from(
        new Map(inspection.entries.map((entry) => [entry.runtimeSessionId, entry])).values(),
      ),
    )
    return {
      ownerCount: owners.length,
      inspections,
      entryCount: entries.length,
      activeEntries: entries.filter((entry) => entry.leaseCount > 0).length,
      inactiveEntries: entries.filter((entry) => entry.leaseCount === 0).length,
    }
  }
  async function sample(arm: string, cycle: number, pairs: readonly Pair[] = []) {
    await settle()
    const generationsBefore = [tree.inspect().workerGeneration, shiki.inspect().workerGeneration]
    const [treeWorker, shikiWorker] = await Promise.all([
      tree.inspectRetention(),
      shiki.inspectRetention(),
    ])
    await settle()
    const generationsAfter = [tree.inspect().workerGeneration, shiki.inspect().workerGeneration]
    expect(generationsAfter).toEqual(generationsBefore)
    const tokenStores = pairs.flatMap((pair) => {
      const read = pair.highlighter.read()
      return read.kind === 'ready' ? [read.result.tokens] : []
    })
    const count = census()
    return {
      arm,
      cycle,
      fixture: fixture.id,
      ...count,
      fixtureOwnedViews: views.size,
      workerGenerations: {
        beforeInspectors: generationsBefore,
        afterFrameAndWorkerFences: generationsAfter,
      },
      bound: inactiveBound(
        count.inactiveEntries,
        DEFAULT_SETTING_VALUES['editor.inactiveAnalysisEntryLimit'],
      ),
      treeOwner: tree.inspect(),
      treeWorker,
      shikiOwner: shiki.inspect(),
      shikiWorker,
      queriedTokenBacking: EditorTokenStore.inspectRetention(tokenStores),
      retentionMutations: queries
        .getMutationCache()
        .findAll({ mutationKey: editorMutationKeys.analysisRetention() })
        .map((mutation) => ({ status: mutation.state.status, data: mutation.state.data })),
      queryObserverRegistrations: queries
        .getQueryCache()
        .getAll()
        .reduce((sum, query) => sum + query.getObserversCount(), 0),
      unknown: [
        'global-cross-analysis-unique-backing',
        'unqueried-token-backing',
        'mutation-observer-count',
        'unique-observer-objects',
        'javascript-object-bytes',
        'worker-heap-bytes',
        'wasm-committed-bytes',
        'wasm-allocator-live-bytes',
      ],
      a: { revision: a.buffer.getRevision(), dirty: a.buffer.isDirty() },
      b: { revision: b.buffer.getRevision(), dirty: b.buffer.isDirty() },
    }
  }
  return {
    application,
    a,
    b,
    working,
    borrow,
    release,
    createView,
    refresh,
    settle,
    census,
    sample,
    setLimit,
    structuralProvider,
    highlighterProvider,
    failedHighlighterProvider,
    aSession,
    bSession,
    dirtyRevision,
    savedSnapshot,
    dirtySnapshot,
    survivorEditor,
    tree,
    shiki,
    async dispose() {
      try {
        for (const view of views) view.dispose()
        application.dispose()
      } finally {
        await Promise.all([tree.dispose(), shiki.dispose()])
        useEnvironmentsStore.setState(previousEnvironments, true)
        if (previousSettings === undefined)
          queries.removeQueries({ queryKey: settingsKeys.document(), exact: true })
        else queries.setQueryData(settingsKeys.document(), previousSettings)
      }
    },
  }
}
