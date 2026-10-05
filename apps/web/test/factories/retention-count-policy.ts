import { expect, vi } from 'vitest'
import {
  EditorSecondaryViewScheduler,
  type EditorSecondaryScheduleWorkOptions,
  type EditorSecondaryScheduledWorkHandle,
} from '@singapore-editor/core/secondary-views'
import { createEditorBufferSession } from '@singapore-editor/core/document'
import {
  Editor,
  createEditorPreparedDocument,
  type EditorDocumentAnalysis,
  type EditorInitialPaintEvent,
  type EditorPreparedDocument,
  type EditorPreparedDocumentMatch,
  type EditorPreparedDocumentPayload,
  type EditorPreparedStageOutcome,
} from '@singapore-editor/core/editor'
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
  RETENTION_COUNT_PROTOCOL,
  retentionFixtureText,
  type RetentionFixture,
} from './retention-count-policy-protocol'

type Analysis = EditorDocumentAnalysis
type Structural = NonNullable<ReturnType<Analysis['borrowStructural']>>
type Highlighter = NonNullable<ReturnType<Analysis['borrowHighlighter']>>
type Pair = { readonly structural: Structural; readonly highlighter: Highlighter }

function observeRetentionWork() {
  const handles = new Set<EditorSecondaryScheduledWorkHandle>()
  const frames = new Set<number>()
  const requests: {
    family: string
    type: string
    runtimeSessionId: string | null
    provenance: string
    scheduledKeys: string[]
  }[] = []
  const reads: {
    fullTextReads: number
    sourceBytesRead: number
    provenance: string
    stack: string | null
  }[] = []
  const attachments: { prepared: boolean }[] = []
  let generation = 0
  let provenance = 'application'
  const previousTrace = Reflect.get(globalThis, '__editorPerfTrace')
  const previousDiagnostics = Reflect.get(globalThis, '__EDITOR_PERFORMANCE_DIAGNOSTICS__')
  Reflect.set(globalThis, '__editorPerfTrace', {})
  Reflect.set(globalThis, '__EDITOR_PERFORMANCE_DIAGNOSTICS__', (input: unknown) => {
    if (typeof previousDiagnostics === 'function') previousDiagnostics(input)
    if (
      typeof input === 'object' &&
      input !== null &&
      'name' in input &&
      input.name === 'editor.document.attach' &&
      'detail' in input &&
      typeof input.detail === 'object' &&
      input.detail !== null &&
      'prepared' in input.detail &&
      typeof input.detail.prepared === 'boolean'
    )
      attachments.push({ prepared: input.detail.prepared })
    if (
      typeof input !== 'object' ||
      input === null ||
      !('name' in input) ||
      input.name !== 'textSnapshot.read'
    )
      return
    if (!('detail' in input) || typeof input.detail !== 'object' || input.detail === null) return
    const detail = input.detail
    if (!('fullTextReads' in detail) || typeof detail.fullTextReads !== 'number') return
    if (!('sourceBytesRead' in detail) || typeof detail.sourceBytesRead !== 'number') return
    reads.push({
      fullTextReads: detail.fullTextReads,
      sourceBytesRead: detail.sourceBytesRead,
      provenance,
      stack:
        detail.fullTextReads > 0
          ? (new TypeError('Full source read diagnostic').stack ?? null)
          : null,
    })
  })
  const schedule = EditorSecondaryViewScheduler.prototype.schedule
  const scheduleSpy = vi
    .spyOn(EditorSecondaryViewScheduler.prototype, 'schedule')
    .mockImplementation(function <T>(
      this: EditorSecondaryViewScheduler,
      options: EditorSecondaryScheduleWorkOptions<T>,
    ) {
      const handle = schedule.bind(this)(options)
      handles.add(handle)
      generation++
      return handle
    })
  const nativeFrame = globalThis.requestAnimationFrame.bind(globalThis)
  const nativeCancel = globalThis.cancelAnimationFrame.bind(globalThis)
  const frameSpy = vi.spyOn(globalThis, 'requestAnimationFrame').mockImplementation((callback) => {
    let id = 0
    id = nativeFrame((time) => {
      frames.delete(id)
      generation++
      try {
        callback(time)
      } finally {
        generation++
      }
    })
    frames.add(id)
    generation++
    return id
  })
  const cancelSpy = vi.spyOn(globalThis, 'cancelAnimationFrame').mockImplementation((id) => {
    if (frames.delete(id)) generation++
    nativeCancel(id)
  })
  const nativeMark = performance.mark.bind(performance)
  const markSpy = vi.spyOn(performance, 'mark').mockImplementation((name, options) => {
    const mark = nativeMark(name, options)
    if (name !== 'editor.worker.request') return mark
    const detail: unknown = mark.detail
    if (
      typeof detail !== 'object' ||
      detail === null ||
      !('family' in detail) ||
      !('type' in detail)
    )
      return mark
    if (typeof detail.family !== 'string' || typeof detail.type !== 'string') return mark
    const runtimeSessionId =
      'runtimeSessionId' in detail && typeof detail.runtimeSessionId === 'string'
        ? detail.runtimeSessionId
        : null
    const inspector = detail.type === 'idleFence' || detail.type === 'runtimeBarrier'
    requests.push({
      family: detail.family,
      type: detail.type,
      runtimeSessionId,
      provenance: inspector ? 'verifier-inspector' : provenance,
      scheduledKeys: Array.from(handles)
        .filter((handle) => handle.isActive())
        .map((handle) => handle.key),
    })
    if (!inspector) generation++
    return mark
  })
  function snapshot() {
    for (const handle of handles) if (!handle.isActive()) handles.delete(handle)
    return {
      generation,
      frames: frames.size,
      scheduled: Array.from(handles, (handle) => ({
        key: handle.key,
        token: handle.token,
        active: handle.isActive(),
      })),
      issuedRequests: requests.length,
      sourceReads: reads.length,
    }
  }
  return {
    snapshot,
    receipt: () => ({ requests, reads, attachments, state: snapshot() }),
    publication() {
      generation++
    },
    frame: () => new Promise<void>((resolve) => nativeFrame(() => resolve())),
    verifierRead<T>(read: () => T) {
      const previous = provenance
      provenance = 'verifier-source-read'
      try {
        return read()
      } finally {
        provenance = previous
      }
    },
    async interval<T>(run: () => T, settle: () => Promise<void>) {
      const requestStart = requests.length
      const readStart = reads.length
      const attachmentStart = attachments.length
      provenance = 'attachment-causal-work'
      try {
        const value = run()
        await settle()
        return {
          value,
          requests: requests.slice(requestStart),
          reads: reads.slice(readStart),
          attachments: attachments.slice(attachmentStart),
          observation: snapshot(),
        }
      } finally {
        provenance = 'application'
      }
    },
    calibrate() {
      const scheduler = new EditorSecondaryViewScheduler()
      const handle = scheduler.schedule({
        key: 'verification-delayed-control',
        taskClass: 'idle-cache',
        delayMs: 120,
        run: () => undefined,
      })
      const delayed = snapshot()
      handle.cancel()
      scheduler.dispose()
      expect(
        delayed.scheduled.some(
          (work) => work.key === 'verification-delayed-control' && work.active,
        ),
      ).toBe(true)
      return delayed
    },
    restore() {
      scheduleSpy.mockRestore()
      frameSpy.mockRestore()
      cancelSpy.mockRestore()
      markSpy.mockRestore()
      Reflect.set(globalThis, '__editorPerfTrace', previousTrace)
      Reflect.set(globalThis, '__EDITOR_PERFORMANCE_DIAGNOSTICS__', previousDiagnostics)
    },
  }
}

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
  const observation = observeRetentionWork()
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
  const secondaryWorking = [createDocument('x'), createDocument('y')]
  application.activateEnvironment(initialOrigin)
  const aSession = createEditorBufferSession(a.buffer)
  const bSession = createEditorBufferSession(b.buffer)
  aSession.setSelection(0)
  aSession.applyText('dirty ')
  const dirtyRevision = a.buffer.getRevision()
  const dirtySnapshot = a.buffer.getSnapshot()
  const stopPublications = Array.from(application.enumerateRetainedEditorAnalyses(), (analysis) =>
    analysis.subscribeRetention(() => observation.publication()),
  )
  const views = new Set<{ dispose(): void; geometry(): ReturnType<typeof viewGeometry> }>()
  const referenceIds = new WeakMap<object, number>()
  let nextReferenceId = 1
  function referenceId(value: object) {
    const existing = referenceIds.get(value)
    if (existing !== undefined) return existing
    const id = nextReferenceId++
    referenceIds.set(value, id)
    return id
  }
  type PreparedView = {
    readonly prepared: EditorPreparedDocument
    readonly abortController: AbortController
    readonly snapshot: ReturnType<typeof a.buffer.getSnapshot>
    readonly textSnapshot: ReturnType<typeof a.buffer.getTextSnapshot>
    readonly revision: number
    readonly range: { readonly startIndex: number; readonly endIndex: number }
    readonly themeCohort: readonly {
      readonly provider: EditorHighlighterProvider
      readonly loadTheme: EditorHighlighterProvider['loadTheme']
    }[]
    stages:
      | { readonly state: 'pending' }
      | {
          readonly state: 'settled'
          readonly structural: EditorPreparedStageOutcome
          readonly highlighter: EditorPreparedStageOutcome
          readonly runtimeSessionIds: ReturnType<EditorPreparedDocument['runtimeSessionIds']>
          readonly fallbackReady: boolean
        }
    readonly acquisitions: ReturnType<typeof preparedAcquisition>[]
  }
  const preparedViews = new Map<Analysis, PreparedView>()

  function preparedAcquisition(
    owner: PreparedView,
    match: EditorPreparedDocumentMatch,
    payload: EditorPreparedDocumentPayload | null,
  ) {
    const structural = payload?.structural
    const highlighter = payload?.highlighter
    const structuralRead = structural?.session.read(structural.range)
    const highlighterRead = highlighter?.session.read()
    return {
      source: {
        snapshot: referenceId(match.snapshot),
        matchesColdSnapshot: match.snapshot === owner.snapshot,
        revision: owner.revision,
      },
      match: {
        documentId: match.documentId,
        languageId: match.languageId,
        configuredTabSize: match.configuredTabSize,
        tabSizePolicy: match.tabSizePolicy,
        documentConfigurationTag: match.documentConfigurationTag,
        structuralConfigurationTag: match.structuralConfigurationTag,
        highlighterConfigurationTag: match.highlighterConfigurationTag,
        structuralConfiguration: match.structuralConfiguration,
        matchesStructuralProvider: match.structuralProvider === structuralProvider,
        matchesHighlighterProvider: match.highlighterProvider === highlighterProvider,
        themeCohort: (match.highlighterThemeProviders ?? []).map((provider) => ({
          provider: referenceId(provider),
          loader: provider.loadTheme ? referenceId(provider.loadTheme) : null,
        })),
        matchesColdThemeCohort:
          match.highlighterThemeProviders?.length === owner.themeCohort.length &&
          owner.themeCohort.every(
            (member, index) =>
              member.provider === match.highlighterThemeProviders?.[index] &&
              member.loadTheme === match.highlighterThemeProviders?.[index]?.loadTheme,
          ),
      },
      structural: structural
        ? {
            runtimeSessionId: structural.runtimeSessionId,
            configuration: structural.configuration,
            configurationTag: structural.configurationTag,
            range: structural.range,
            ready: structural.readyResult !== null,
            sourceMatchesColdSnapshot:
              structuralRead?.kind === 'ready' && structuralRead.snapshot === owner.textSnapshot,
            resultMatchesRead:
              structuralRead?.kind === 'ready' && structuralRead.result === structural.readyResult,
          }
        : null,
      highlighter: highlighter
        ? {
            runtimeSessionId: highlighter.runtimeSessionId,
            configurationTag: highlighter.configurationTag,
            range: highlighter.range,
            ready: highlighter.readyResult !== null,
            sourceMatchesColdSnapshot:
              highlighterRead?.kind === 'ready' && highlighterRead.snapshot === owner.textSnapshot,
            resultMatchesRead:
              highlighterRead?.kind === 'ready' &&
              highlighterRead.result === highlighter.readyResult,
            tokenCount: highlighter.readyResult?.tokens.length ?? 0,
            providerTheme:
              highlighterRead?.kind === 'ready'
                ? {
                    kind: highlighterRead.providerTheme.kind,
                    theme:
                      highlighterRead.providerTheme.kind === 'ready' &&
                      highlighterRead.providerTheme.theme
                        ? referenceId(highlighterRead.providerTheme.theme)
                        : null,
                  }
                : null,
          }
        : null,
      fallbackTransferred: payload?.fallbackFoldIndex !== null && payload !== null,
    }
  }

  function createPreparedView(document: typeof a) {
    const snapshot = document.buffer.getSnapshot()
    const textSnapshot = document.buffer.getTextSnapshot()
    const prepared = createEditorPreparedDocument({
      analysis: document.analysis,
      buffer: document.buffer,
      documentId: document.analysis.documentId,
      languageId: fixture.language,
      configuredTabSize: 4,
      tabSizePolicy: 'detect-indentation',
      documentConfigurationTag: ['actual-view'],
    })
    const owner: PreparedView = {
      prepared,
      abortController: new AbortController(),
      snapshot,
      textSnapshot,
      revision: document.buffer.getRevision(),
      range: { startIndex: 0, endIndex: Math.min(snapshot.length, 65_536) },
      themeCohort: [{ provider: highlighterProvider, loadTheme: highlighterProvider.loadTheme }],
      stages: { state: 'pending' },
      acquisitions: [],
    }
    const borrow = prepared.borrow.bind(prepared)
    prepared.borrow = (match) => {
      const payload = borrow(match)
      owner.acquisitions.push(preparedAcquisition(owner, match, payload))
      return payload
    }
    return owner
  }

  async function metadataOnlyControl() {
    const owner = createPreparedView(a)
    try {
      await owner.prepared.fallbackReady
      const payload = owner.prepared.borrow({
        configuredTabSize: 4,
        tabSizePolicy: 'detect-indentation',
        documentId: a.analysis.documentId,
        languageId: fixture.language,
        snapshot: owner.snapshot,
        documentConfigurationTag: ['actual-view'],
        structuralProvider,
        highlighterProvider,
        highlighterThemeProviders: [highlighterProvider],
        structuralConfiguration: {
          includeCaptures: false,
          includeHighlights: false,
          syntaxMode: 'range',
        },
        structuralConfigurationTag: ['actual-view'],
        highlighterConfigurationTag: ['actual-view'],
      })
      return {
        metadataMatched: payload !== null,
        stages: owner.stages,
        runtimeSessionIds: owner.prepared.runtimeSessionIds(),
        acquisition: owner.acquisitions.at(-1) ?? null,
        observation: observation.snapshot(),
      }
    } finally {
      owner.abortController.abort()
      owner.prepared.dispose()
    }
  }

  async function prepareViewMetadata() {
    for (const document of [a, b]) {
      if (preparedViews.has(document.analysis))
        throw new TypeError('Cold metadata is already retained')
      const owner = createPreparedView(document)
      preparedViews.set(document.analysis, owner)
      const structural = owner.prepared.startStage({
        family: 'structural',
        provider: structuralProvider,
        configuration: { includeCaptures: false, includeHighlights: false, syntaxMode: 'range' },
        configurationTag: ['actual-view'],
        range: owner.range,
        abortSignal: owner.abortController.signal,
      })
      const highlighter = owner.prepared.startStage({
        family: 'highlighter',
        provider: highlighterProvider,
        themeProviders: owner.themeCohort.map((member) => member.provider),
        configurationTag: ['actual-view'],
        range: 'full',
        abortSignal: owner.abortController.signal,
      })
      if (!structural || !highlighter) throw new TypeError('Cold ready stages did not start')
      const [structuralOutcome, highlighterOutcome, fallbackReady] = await Promise.all([
        structural,
        highlighter,
        owner.prepared.fallbackReady,
      ])
      owner.stages = {
        state: 'settled',
        structural: structuralOutcome,
        highlighter: highlighterOutcome,
        runtimeSessionIds: owner.prepared.runtimeSessionIds(),
        fallbackReady,
      }
    }
  }
  function metadataReceipt() {
    return Array.from(preparedViews, ([analysis, owner]) => ({
      documentId: analysis.documentId,
      source: {
        snapshot: referenceId(owner.snapshot),
        textSnapshot: referenceId(owner.textSnapshot),
        revision: owner.revision,
        current: analysis.buffer.getSnapshot() === owner.snapshot,
      },
      configuration: {
        documentConfigurationTag: ['actual-view'],
        structuralConfigurationTag: ['actual-view'],
        highlighterConfigurationTag: ['actual-view'],
        structural: { includeCaptures: false, includeHighlights: false, syntaxMode: 'range' },
        structuralRange: owner.range,
        highlighterRange: 'full',
        configuredTabSize: 4,
        tabSizePolicy: 'detect-indentation',
        structuralProvider: referenceId(structuralProvider),
        highlighterProvider: referenceId(highlighterProvider),
        themeCohort: owner.themeCohort.map((member) => ({
          provider: referenceId(member.provider),
          loader: member.loadTheme ? referenceId(member.loadTheme) : null,
        })),
        loaderCount: owner.themeCohort.filter((member) => member.loadTheme).length,
      },
      stages: owner.stages,
      acquisitions: owner.acquisitions.slice(),
      estimatedBytes: owner.prepared.estimatedBytes,
      runtimeSessionIds: owner.prepared.runtimeSessionIds(),
      entries: analysis.inspectRetention().entries,
    }))
  }
  function releaseViewMetadata() {
    for (const owner of preparedViews.values()) {
      owner.abortController.abort()
      owner.prepared.dispose()
    }
    preparedViews.clear()
  }

  function viewGeometry(container: HTMLElement, name: string) {
    const scroll = container.querySelector('.editor-virtualized')
    if (!(scroll instanceof HTMLElement))
      throw new TypeError('The real Editor scroll element is unavailable')
    return {
      name,
      containerHeight: container.clientHeight,
      scrollClientHeight: scroll.clientHeight,
      scrollBoxHeight: scroll.getBoundingClientRect().height,
      scrollHeight: scroll.scrollHeight,
      renderedRows: scroll.querySelectorAll('.editor-virtualized-row').length,
    }
  }

  function assertGeometry() {
    const geometry = viewGeometries()
    for (const value of geometry) {
      expect(value.containerHeight).toBe(RETENTION_COUNT_PROTOCOL.geometry.height)
      expect(value.scrollBoxHeight).toBe(RETENTION_COUNT_PROTOCOL.geometry.height)
      expect(value.scrollClientHeight).toBeGreaterThan(0)
      expect(value.scrollClientHeight).toBeLessThanOrEqual(RETENTION_COUNT_PROTOCOL.geometry.height)
      expect(value.renderedRows).toBeGreaterThan(0)
      expect(value.renderedRows).toBeLessThanOrEqual(
        RETENTION_COUNT_PROTOCOL.geometry.maximumRenderedRows,
      )
    }
    return geometry
  }
  function viewGeometries() {
    return Array.from(views, (view) => view.geometry())
  }

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
    const owner = preparedViews.get(document.analysis)
    if (!owner)
      throw new TypeError('The actual cold prepared metadata is required for this host mount')
    const wrapper = window.document.createElement('div')
    const container = window.document.createElement('div')
    wrapper.dataset.retentionView = name
    wrapper.style.height = `${RETENTION_COUNT_PROTOCOL.geometry.height}px`
    wrapper.style.width = `${RETENTION_COUNT_PROTOCOL.geometry.width}px`
    container.style.cssText =
      'display: flex; height: 100%; min-height: 0; min-width: 0; overflow: hidden; width: 100%;'
    wrapper.append(container)
    window.document.body.append(wrapper)
    const paints: EditorInitialPaintEvent[] = []
    const editor = new Editor(container, {
      onInitialPaint: (event) => paints.push(event),
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
    const scroll = container.querySelector('.editor-virtualized')
    if (!(scroll instanceof HTMLElement))
      throw new TypeError('The real Editor scroll element is unavailable')
    scroll.style.minHeight = '0'
    scroll.style.minWidth = '0'
    editor.attachSession(createEditorBufferSession(document.buffer), {
      analysis: document.analysis,
      preparedDocument: owner.prepared,
      documentConfigurationTag: ['actual-view'],
      documentId: document.analysis.documentId,
      languageId: fixture.language,
      structuralConfigurationTag: ['actual-view'],
      highlighterConfigurationTag: ['actual-view'],
    })
    const attachment = {
      name,
      state: editor.getState(),
      paints: paints.slice(),
      readyPaintCaptured: editor.captureSnapshot() !== null,
      sourceMatchesColdSnapshot: editor.getTextSnapshot() === owner.textSnapshot,
      acquisition: owner.acquisitions.at(-1) ?? null,
      originalStageRuntimeIds:
        owner.stages.state === 'settled' ? owner.stages.runtimeSessionIds : null,
      observationAtReturn: observation.snapshot(),
    }
    const view = {
      editor,
      attachment,
      geometry: () => viewGeometry(container, name),
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
  function hasPendingRetentionMutation() {
    return queries
      .getMutationCache()
      .findAll({ mutationKey: editorMutationKeys.analysisRetention() })
      .some((mutation) => mutation.state.status === 'pending')
  }
  async function settle() {
    await observation.frame()
    await Promise.resolve()
    await expect.poll(hasPendingRetentionMutation).toBe(false)
    await Promise.all([tree.awaitIdleFence(), shiki.awaitIdleFence()])
    await expect
      .poll(() => tree.inspect().pendingRequests + shiki.inspect().pendingRequests)
      .toBe(0)
    await Promise.resolve()
    await expect.poll(hasPendingRetentionMutation).toBe(false)
    await expect
      .poll(() => {
        const state = observation.snapshot()
        return state.frames + state.scheduled.length
      })
      .toBe(0)
    await Promise.all([tree.awaitIdleFence(), shiki.awaitIdleFence()])
    await expect
      .poll(() => tree.inspect().pendingRequests + shiki.inspect().pendingRequests)
      .toBe(0)
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
    let settlementFailure: string | null = null
    try {
      await settle()
    } catch (error) {
      settlementFailure = String(error)
    }
    const consistentGeneration = observation.snapshot().generation
    const generationsBefore = [tree.inspect().workerGeneration, shiki.inspect().workerGeneration]
    const [treeWorker, shikiWorker] = await Promise.all([
      tree.inspectRetention(),
      shiki.inspectRetention(),
    ])
    const generationsAfter = [tree.inspect().workerGeneration, shiki.inspect().workerGeneration]
    const finalObservation = observation.snapshot()
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
      viewGeometry: viewGeometries(),
      observation: finalObservation,
      point: {
        consistent:
          settlementFailure === null &&
          finalObservation.generation === consistentGeneration &&
          finalObservation.scheduled.length === 0 &&
          finalObservation.frames === 0 &&
          generationsAfter.every((generation, index) => generation === generationsBefore[index]),
        generationBeforeInspectors: consistentGeneration,
        generationAfterInspectors: finalObservation.generation,
        settlementFailure,
      },
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
  let disposal: Promise<void> | null = null
  function dispose() {
    disposal ??= disposeHost()
    return disposal
  }
  async function disposeHost() {
    try {
      for (const view of views) view.dispose()
      releaseViewMetadata()
      application.dispose()
    } finally {
      for (const stop of stopPublications) stop()
      await Promise.all([tree.dispose(), shiki.dispose()])
      useEnvironmentsStore.setState(previousEnvironments, true)
      if (previousSettings === undefined)
        queries.removeQueries({ queryKey: settingsKeys.document(), exact: true })
      else queries.setQueryData(settingsKeys.document(), previousSettings)
      observation.restore()
    }
  }
  return {
    application,
    a,
    b,
    working,
    secondaryWorking,
    fixtureId: fixture.id,
    expectedSource: source,
    observation,
    borrow,
    release,
    createView,
    metadataOnlyControl,
    prepareViewMetadata,
    metadataReceipt,
    releaseViewMetadata,
    assertGeometry,
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
    dispose,
  }
}
