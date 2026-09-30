import { createOnigurumaEngine } from '@shikijs/engine-oniguruma'
import wasm from '@shikijs/engine-oniguruma/wasm-inlined'
import {
  createHighlighterCore,
  type HighlighterGeneric,
  type LanguageRegistration,
  type ThemeRegistrationAny,
} from 'shiki/core'
import { createIncrementalTokenizer, type CreateIncrementalTokenizerResult } from './tokenizer'
import { packTokenLines, snapshotToPackedEditorTokens } from './editor-tokens'
import type { EditorTheme } from '../theme'
import { packedEditorTokenTransfers } from '../syntax/packedTokens'
import { editorThemeFromShikiTheme, type ShikiThemeLike } from './theme-extract'
import type {
  ShikiWorkerDocumentOptions,
  ShikiWorkerEditRequest,
  ShikiWorkerLanguageRegistration,
  ShikiWorkerOpenRequest,
  ShikiWorkerPreloadRequest,
  ShikiWorkerRequest,
  ShikiWorkerResponse,
  ShikiWorkerTransportResult,
  ShikiWorkerThemeRegistration,
  ShikiWorkerThemeRequest,
  ShikiWorkerRecolorRequest,
} from './workerTypes'

type DocumentState = {
  readonly documentId: string
  readonly runtimeSessionId: string
  readonly lang: string
  theme: string
  themeRegistration: ShikiWorkerThemeRegistration
  readonly highlighter: HighlighterGeneric<string, string>
  readonly tokenizer: CreateIncrementalTokenizerResult['tokenizer']
}

const documents = new Map<string, DocumentState>()
const documentTasks = new Map<string, Promise<ShikiWorkerTransportResult | undefined>>()
const disposedRuntimeSessions = new Set<string>()
const activeWorkerTasks = new Set<Promise<void>>()
const highlighterPromises = new Map<string, Promise<HighlighterGeneric<string, string>>>()
const backgroundLanguages = new WeakMap<HighlighterGeneric<string, string>, Set<string>>()
const MAX_DISPOSED_RUNTIME_SESSIONS = 1_024

self.onmessage = (event: MessageEvent<ShikiWorkerRequest>): void => {
  const task = handleRequest(event.data)
  if (event.data.payload.type === 'idleFence') return

  trackWorkerTask(task)
}

const trackWorkerTask = (task: Promise<void>): void => {
  activeWorkerTasks.add(task)
  void task.finally(() => activeWorkerTasks.delete(task)).catch(() => undefined)
}

const handleRequest = async (request: ShikiWorkerRequest): Promise<void> => {
  try {
    const result = await runRequest(request.payload)
    postResponse({ id: request.id, ok: true, result })
  } catch (error) {
    postResponse({ id: request.id, ok: false, error: createErrorMessage(error) })
  }
}

const runRequest = (
  payload: ShikiWorkerRequest['payload'],
): Promise<ShikiWorkerTransportResult | undefined> => {
  if (payload.type === 'open') {
    return runDocumentTask(payload.runtimeSessionId, () => openDocument(payload))
  }
  if (payload.type === 'edit') {
    return runDocumentTask(payload.runtimeSessionId, () => editDocument(payload))
  }
  if (payload.type === 'recolor') {
    return runDocumentTask(payload.runtimeSessionId, () => recolorDocument(payload))
  }
  if (payload.type === 'disposeDocument') {
    return runDocumentTask(payload.runtimeSessionId, () => {
      disposeDocument(payload.runtimeSessionId)
      return Promise.resolve(undefined)
    })
  }
  if (payload.type === 'runtimeBarrier') {
    return runDocumentTask(payload.runtimeSessionId, () => Promise.resolve(undefined))
  }
  if (payload.type === 'idleFence') {
    return Promise.allSettled(Array.from(activeWorkerTasks)).then(() => undefined)
  }
  if (payload.type === 'theme') {
    return loadTheme(payload)
  }
  if (payload.type === 'preload') {
    return preloadRegistrations(payload)
  }

  return Promise.allSettled(Array.from(activeWorkerTasks)).then(() => {
    disposeAll()
    return undefined
  })
}

const runDocumentTask = (
  runtimeSessionId: string,
  task: () => Promise<ShikiWorkerTransportResult | undefined>,
): Promise<ShikiWorkerTransportResult | undefined> => {
  const previous = documentTasks.get(runtimeSessionId) ?? Promise.resolve(undefined)
  const next = previous.catch(() => undefined).then(task)
  documentTasks.set(runtimeSessionId, next)
  void next.finally(() => clearDocumentTask(runtimeSessionId, next)).catch(() => undefined)
  return next
}

const clearDocumentTask = (
  runtimeSessionId: string,
  task: Promise<ShikiWorkerTransportResult | undefined>,
): void => {
  if (documentTasks.get(runtimeSessionId) !== task) return
  documentTasks.delete(runtimeSessionId)
}

const openDocument = async (
  payload: ShikiWorkerOpenRequest,
): Promise<ShikiWorkerTransportResult> => {
  if (disposedRuntimeSessions.has(payload.runtimeSessionId)) {
    return { documentId: payload.documentId }
  }

  const highlighter = await ensureHighlighter(payload)
  const { tokenizer } = await createIncrementalTokenizer({
    lang: payload.lang,
    theme: payload.theme,
    code: payload.text,
    highlighter,
  })

  const state = {
    documentId: payload.documentId,
    runtimeSessionId: payload.runtimeSessionId,
    lang: payload.lang,
    theme: payload.theme,
    themeRegistration: payload.themeRegistration,
    highlighter,
    tokenizer,
  }
  if (!disposedRuntimeSessions.has(payload.runtimeSessionId)) {
    documents.set(payload.runtimeSessionId, state)
  }
  return resultFromState(state)
}

const editDocument = async (
  payload: ShikiWorkerEditRequest,
): Promise<ShikiWorkerTransportResult> => {
  const existing = documents.get(payload.runtimeSessionId)
  if (!existing) throw new Error('Unable to edit unopened Shiki document without text')
  if (!documentMatches(existing, payload)) {
    throw new Error('Unable to reopen Shiki document without text')
  }

  const patches = existing.tokenizer.applyEdits(payload.edits)
  return {
    documentId: existing.documentId,
    patchesPacked: patches.map((patch) => ({
      fromOffset: patch.fromOffset,
      oldEndOffset: patch.oldEndOffset,
      newEndOffset: patch.newEndOffset,
      tokensPacked: packTokenLines(patch.lines, patch.fromOffset),
    })),
    theme: editorThemeFromHighlighter(
      existing.highlighter,
      existing.theme,
      existing.themeRegistration,
    ),
  }
}

const recolorDocument = async (
  payload: ShikiWorkerRecolorRequest,
): Promise<ShikiWorkerTransportResult | undefined> => {
  const state = documents.get(payload.runtimeSessionId)
  if (!state) return undefined

  await state.highlighter.loadTheme(payload.themeRegistration as ThemeRegistrationAny)
  state.tokenizer.setTheme(payload.theme)
  state.theme = payload.theme
  state.themeRegistration = payload.themeRegistration
  return resultFromState(state)
}

/**
 * The highlighter for a document, with that document's grammar loaded and nothing else waited on.
 *
 * Loading the host's whole preload set up front measured 1 280–1 780 ms for 53 grammars, all of it
 * ahead of the first paint of a single TypeScript file. The set is still loaded — a language switch
 * should not stall either — but behind the answer rather than in front of it.
 */
const ensureHighlighter = async (
  options: ShikiWorkerDocumentOptions,
): Promise<HighlighterGeneric<string, string>> => {
  const languages = uniqueLanguageRegistrations(options.languageRegistrations)
  const themes = uniqueThemeRegistrations([
    options.themeRegistration,
    ...options.themeRegistrations,
  ])
  const highlighter = await ensureHighlighterFor(languages, themes)
  await ensureLanguages(highlighter, languages)

  return highlighter
}

const ensureLanguages = async (
  highlighter: HighlighterGeneric<string, string>,
  registrations: readonly ShikiWorkerLanguageRegistration[],
): Promise<void> => {
  const loaded = new Set(highlighter.getLoadedLanguages())
  const missing = registrations.filter((registration) => !loaded.has(registration.name))
  if (missing.length === 0) return

  await highlighter.loadLanguage(...(missing as unknown as LanguageRegistration[]))
}

/**
 * Once per language and highlighter, on a timer rather than a microtask.
 *
 * A microtask here runs *between* the tokenizer's awaits and competes with it for the one worker
 * thread — measured at 526 ms of tokenization becoming 1 187 ms. The delay puts the whole preload
 * set behind the paint that matters instead of inside it. A failure costs a stall on some later
 * language switch, never a paint. A later preload with other languages (a workspace switch)
 * schedules only the ones no earlier preload asked for.
 */
const scheduleBackgroundLanguages = (
  highlighter: HighlighterGeneric<string, string>,
  registrations: readonly ShikiWorkerLanguageRegistration[],
): void => {
  const scheduled = backgroundLanguages.get(highlighter) ?? new Set<string>()
  backgroundLanguages.set(highlighter, scheduled)
  const fresh = registrations.filter((registration) => !scheduled.has(registration.name))
  if (fresh.length === 0) return

  for (const registration of fresh) scheduled.add(registration.name)
  const task = new Promise<void>((resolve) => {
    setTimeout(() => {
      const complete = () => resolve()
      void ensureLanguages(highlighter, fresh).then(complete, complete)
    }, 1_000)
  })
  trackWorkerTask(task)
}

const ensureHighlighterFor = (
  languages: readonly ShikiWorkerLanguageRegistration[],
  themes: readonly ShikiWorkerThemeRegistration[],
): Promise<HighlighterGeneric<string, string>> => {
  const key = highlighterKey(themes)
  const existing = highlighterPromises.get(key)
  if (existing) return existing

  const promise = createHighlighterCore({
    engine: createOnigurumaEngine(wasm),
    langs: languages as unknown as LanguageRegistration[],
    themes: themes as unknown as ThemeRegistrationAny[],
  }) as Promise<HighlighterGeneric<string, string>>
  highlighterPromises.set(key, promise)
  return promise
}

const loadTheme = async (payload: ShikiWorkerThemeRequest): Promise<ShikiWorkerTransportResult> => {
  const themes = uniqueThemeRegistrations([
    payload.themeRegistration,
    ...payload.themeRegistrations,
  ])
  const highlighter = await ensureHighlighterFor([], themes)
  return {
    theme: editorThemeFromHighlighter(highlighter, payload.theme, payload.themeRegistration),
  }
}

const preloadRegistrations = async (payload: ShikiWorkerPreloadRequest): Promise<undefined> => {
  const themes = uniqueThemeRegistrations(payload.themeRegistrations)
  const highlighter = await ensureHighlighterFor([], themes)
  scheduleBackgroundLanguages(
    highlighter,
    uniqueLanguageRegistrations(payload.languageRegistrations),
  )
  return undefined
}

const resultFromState = (state: DocumentState): ShikiWorkerTransportResult => ({
  documentId: state.documentId,
  tokensPacked: snapshotToPackedEditorTokens(state.tokenizer.getSnapshot()),
  theme: editorThemeFromHighlighter(state.highlighter, state.theme, state.themeRegistration),
})

const documentMatches = (state: DocumentState, payload: ShikiWorkerEditRequest): boolean =>
  state.lang === payload.lang && state.theme === payload.theme

const disposeDocument = (runtimeSessionId: string): void => {
  markRuntimeSessionDisposed(runtimeSessionId)
  documents.delete(runtimeSessionId)
}

const markRuntimeSessionDisposed = (runtimeSessionId: string): void => {
  disposedRuntimeSessions.add(runtimeSessionId)
  if (disposedRuntimeSessions.size <= MAX_DISPOSED_RUNTIME_SESSIONS) return

  const oldest = disposedRuntimeSessions.values().next().value
  if (oldest) disposedRuntimeSessions.delete(oldest)
}

const disposeAll = (): void => {
  documents.clear()
  documentTasks.clear()
  activeWorkerTasks.clear()
  disposedRuntimeSessions.clear()
  for (const promise of highlighterPromises.values()) {
    void promise.then((highlighter) => highlighter.dispose()).catch(() => undefined)
  }
  highlighterPromises.clear()
}

const postResponse = (response: ShikiWorkerResponse): void => {
  const transfers = responseTransfers(response)
  const workerScope = self as unknown as {
    postMessage(response: ShikiWorkerResponse, transfer?: Transferable[]): void
  }
  if (transfers.length === 0) {
    workerScope.postMessage(response)
    return
  }
  workerScope.postMessage(response, transfers)
}

function responseTransfers(response: ShikiWorkerResponse): Transferable[] {
  if (!response.ok || !response.result) return []
  const result = response.result
  const transfers = result.tokensPacked ? packedEditorTokenTransfers(result.tokensPacked) : []
  for (const patch of result.patchesPacked ?? []) {
    transfers.push(...packedEditorTokenTransfers(patch.tokensPacked))
  }
  return transfers
}

/**
 * Themes only. Languages are loaded into whichever highlighter a theme-registration set already
 * has, so keying on them too would rebuild and reload the whole grammar set for each document.
 */
const highlighterKey = (themes: readonly ShikiWorkerThemeRegistration[]): string =>
  JSON.stringify(themes.map(themeRegistrationKey).toSorted())

const themeRegistrationKey = (theme: ShikiWorkerThemeRegistration): string => JSON.stringify(theme)

const uniqueLanguageRegistrations = (
  registrations: readonly ShikiWorkerLanguageRegistration[],
): ShikiWorkerLanguageRegistration[] =>
  uniqueBy(registrations, (registration) => `${registration.name}\u0000${registration.scopeName}`)

const uniqueThemeRegistrations = (
  registrations: readonly ShikiWorkerThemeRegistration[],
): ShikiWorkerThemeRegistration[] => uniqueBy(registrations, themeRegistrationKey)

const uniqueBy = <T>(items: readonly T[], keyFor: (item: T) => string): T[] => {
  const seen = new Set<string>()
  const unique: T[] = []
  for (const item of items) {
    const key = keyFor(item)
    if (seen.has(key)) continue

    seen.add(key)
    unique.push(item)
  }
  return unique
}

const createErrorMessage = (error: unknown): string => {
  if (error instanceof Error) return error.message
  return String(error)
}

function editorThemeFromHighlighter(
  highlighter: HighlighterGeneric<string, string>,
  themeName: string,
  registration: ShikiWorkerThemeRegistration,
): EditorTheme | undefined {
  const getTheme = (highlighter as Partial<Pick<HighlighterGeneric<string, string>, 'getTheme'>>)
    .getTheme
  if (getTheme) {
    const theme = getTheme.call(highlighter, themeName) as ShikiThemeLike | undefined
    if (theme) return editorThemeFromShikiTheme(theme)
  }

  if (registration.name === themeName) {
    return editorThemeFromShikiTheme(registration)
  }
  return undefined
}
