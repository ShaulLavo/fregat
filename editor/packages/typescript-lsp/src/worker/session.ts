import { lspPositionToOffset } from '@singapore-editor/lsp'
import type { PublishDiagnosticsNotificationParams } from '@singapore-editor/lsp/types'
import ts from 'typescript'
import type * as lsp from 'vscode-languageserver-protocol'
import {
  documentUriToFileName,
  fileNameToDocumentUri,
  isTypeScriptLspSourceFileName,
  sourcePathToFileName,
} from '../paths'
import type { TypeScriptLspLibrarySource, TypeScriptLspSourceFile } from '../types'
import { codeActions, resolveCodeAction } from './codeActions'
import {
  completion,
  COMPLETION_TRIGGER_CHARACTERS,
  emptyCompletionList,
  resolveCompletionItem,
} from './completion'
import type { DocumentContext, ServiceContext, WorkerDocument } from './context'
import {
  DELETE_WORKSPACE_FILES,
  LIBRARY_FILES_REQUEST,
  SET_WORKSPACE_FILES,
  UPSERT_WORKSPACE_FILES,
} from './customMethods'
import { collectDiagnostics, documentDiagnosticReport } from './diagnostics'
import {
  defaultFormatSettings,
  formatSettingsFor,
  formatting,
  ON_TYPE_FORMATTING_FIRST_TRIGGER,
  ON_TYPE_FORMATTING_MORE_TRIGGERS,
  onTypeFormatting,
  rangeFormatting,
} from './formatting'
import { hover } from './hover'
import {
  loadLibraryFiles,
  readBundledLibraryFiles,
  readCdnLibraryFiles,
  type LibraryFileReader,
} from './libraries'
import { LineIndex } from './lineIndex'
import {
  definition,
  documentHighlight,
  implementation,
  references,
  typeDefinition,
} from './navigation'
import {
  isProjectShapeFile,
  mirrorPaths,
  projectFileMap,
  readProjectConfig,
  resolvedCompilerOptions,
  rootFileNames,
  workspaceFileNameForResult,
  workspacePackages,
  type ProjectConfig,
  type WorkspacePackage,
} from './project'
import { ProjectHost, type ProjectService } from './projectHost'
import {
  didChangeParams,
  errorMessage,
  isNotificationMessage,
  isRecord,
  isRequestMessage,
  JSON_RPC_VERSION,
  METHOD_NOT_FOUND,
  parseIncomingMessage,
  REQUEST_FAILED,
  requestId,
  responseErrorFromThrown,
  rpcError,
  textDocumentItemFromParams,
  textDocumentUri,
  type JsonRpcRequestId,
} from './protocol'
import { prepareRename, rename } from './rename'
import { SEMANTIC_TOKEN_LEGEND, semanticTokensFull, semanticTokensRange } from './semanticTokens'
import {
  SIGNATURE_HELP_RETRIGGER_CHARACTERS,
  SIGNATURE_HELP_TRIGGER_CHARACTERS,
  signatureHelp,
} from './signatureHelp'
import { documentSymbol, workspaceSymbol } from './symbols'

const TEXT_DOCUMENT_SYNC_INCREMENTAL = 2
const DEFAULT_DIAGNOSTIC_DELAY_MS = 150
const LOG_MESSAGE_ERROR = 1
const LINE_INDEX_CACHE_LIMIT = 256
const DIAGNOSTIC_REFRESH = 'workspace/diagnostic/refresh'
/** A host that never answers must not leave the program unbuilt forever; the next request retries. */
const SERVER_REQUEST_TIMEOUT_MS = 30_000

const CODE_ACTION_KINDS = [
  'quickfix',
  'refactor',
  'refactor.extract',
  'refactor.inline',
  'refactor.move',
  'refactor.rewrite',
  'source',
  'source.organizeImports',
]

const DEFAULT_PREFERENCES: ts.UserPreferences = {
  quotePreference: 'auto',
  importModuleSpecifierPreference: 'shortest',
  includeCompletionsForModuleExports: true,
  includeCompletionsForImportStatements: true,
  includePackageJsonAutoImports: 'auto',
  providePrefixAndSuffixTextForRename: true,
  allowRenameOfImportPath: false,
}

export type TypeScriptLanguageSessionOptions = {
  /** Sends one JSON-RPC message to the client. */
  post(message: unknown): void
  /** Overrides the `libraryFiles` initialization option; tests read the libs from disk. */
  readLibraryFiles?: LibraryFileReader
}

/** A TypeScript language server with no transport of its own: messages in, messages out. */
export type TypeScriptLanguageSession = {
  receive(data: unknown): void
  dispose(): void
}

type ServiceState = {
  readonly project: ProjectHost
  readonly config: ProjectConfig | null
}

type InitializationOptions = {
  readonly canonicalPaths?: Readonly<Record<string, string>>
  readonly compilerOptions?: ts.CompilerOptions
  readonly diagnosticDelayMs?: number
  readonly formatOptions?: ts.FormatCodeSettings
  readonly preferences?: ts.UserPreferences
  readonly libraryFiles?: TypeScriptLspLibrarySource
}

type RequestHandler = (params: unknown, id: JsonRpcRequestId | null) => unknown

type PendingServerRequest = {
  resolve(result: unknown): void
  reject(error: unknown): void
}

export function createTypeScriptLanguageSession(
  options: TypeScriptLanguageSessionOptions,
): TypeScriptLanguageSession {
  let canonicalPaths: Readonly<Record<string, string>> = {}
  let compilerOptionsOverride: ts.CompilerOptions = {}
  let diagnosticDelayMs = DEFAULT_DIAGNOSTIC_DELAY_MS
  let formatBase = defaultFormatSettings()
  let preferences = DEFAULT_PREFERENCES
  let librarySource: TypeScriptLspLibrarySource = 'bundled'
  let clientCapabilities: lsp.ClientCapabilities = {}
  let workspaceFiles = new Map<string, string>()
  let servicePromise: Promise<ServiceState> | null = null
  /** Changes only with a package.json, and every such change goes through `invalidateService`. */
  let packagesCache: readonly WorkspacePackage[] | null = null
  /** Bumped by every change that can change any file's diagnostics; pull reports carry it. */
  let projectRevision = 0
  let refreshTimer: ReturnType<typeof setTimeout> | null = null
  let serverRequestCount = 0
  const documents = new Map<lsp.DocumentUri, WorkerDocument>()
  const diagnosticTimers = new Map<lsp.DocumentUri, ReturnType<typeof setTimeout>>()
  const lineIndexes = new Map<string, LineIndex>()
  const serverRequests = new Map<string, PendingServerRequest>()
  /**
   * Requests that have been dispatched and not yet answered, so `$/cancelRequest` can take one back
   * out again before its answer is posted.
   *
   * An id is removed when its response is posted and when it is cancelled, whichever happens first,
   * so the set holds only what is genuinely in flight.
   */
  const inFlightRequests = new Set<JsonRpcRequestId>()

  const requests = new Map<string, RequestHandler>([
    ['initialize', (params) => initializeResult(params)],
    ['shutdown', () => shutdownResult()],
    [
      'textDocument/hover',
      (params, id) => withDocument(params, id, null, (ctx) => hover(ctx, params)),
    ],
    [
      'textDocument/completion',
      (params, id) =>
        withDocument(params, id, emptyCompletionList(), (ctx) => completion(ctx, params)),
    ],
    [
      'completionItem/resolve',
      (params, id) => withService(id, (ctx) => resolveCompletionItem(ctx, params)),
    ],
    [
      'textDocument/definition',
      (params, id) => withDocument(params, id, [], (ctx) => definition(ctx, params)),
    ],
    [
      'textDocument/references',
      (params, id) => withDocument(params, id, [], (ctx) => references(ctx, params)),
    ],
    [
      'textDocument/implementation',
      (params, id) => withDocument(params, id, [], (ctx) => implementation(ctx, params)),
    ],
    [
      'textDocument/typeDefinition',
      (params, id) => withDocument(params, id, [], (ctx) => typeDefinition(ctx, params)),
    ],
    [
      'textDocument/documentHighlight',
      (params, id) => withDocument(params, id, [], (ctx) => documentHighlight(ctx, params)),
    ],
    [
      'textDocument/signatureHelp',
      (params, id) =>
        withDocument(params, id, null, (ctx) =>
          signatureHelp(ctx, params, parameterLabelOffsets()),
        ),
    ],
    [
      'textDocument/documentSymbol',
      (params, id) =>
        withDocument(params, id, [], (ctx) => documentSymbol(ctx, hierarchicalSymbols())),
    ],
    ['workspace/symbol', (params, id) => withService(id, (ctx) => workspaceSymbol(ctx, params))],
    [
      'textDocument/prepareRename',
      (params, id) => withDocument(params, id, null, (ctx) => prepareRename(ctx, params)),
    ],
    [
      'textDocument/rename',
      (params, id) => withDocument(params, id, null, (ctx) => rename(ctx, params)),
    ],
    [
      'textDocument/codeAction',
      (params, id) => withDocument(params, id, [], (ctx) => codeActions(ctx, params)),
    ],
    [
      'codeAction/resolve',
      (params, id) => withService(id, (ctx) => resolveCodeAction(ctx, params)),
    ],
    [
      'textDocument/formatting',
      (params, id) => withFormatting(params, id, (ctx) => formatting(ctx)),
    ],
    [
      'textDocument/rangeFormatting',
      (params, id) => withFormatting(params, id, (ctx) => rangeFormatting(ctx, params)),
    ],
    [
      'textDocument/onTypeFormatting',
      (params, id) => withFormatting(params, id, (ctx) => onTypeFormatting(ctx, params)),
    ],
    ['textDocument/diagnostic', (params, id) => pullDiagnostics(params, id)],
    [
      'textDocument/semanticTokens/full',
      (params, id) => withDocument(params, id, null, (ctx) => semanticTokensFull(ctx)),
    ],
    [
      'textDocument/semanticTokens/range',
      (params, id) => withDocument(params, id, null, (ctx) => semanticTokensRange(ctx, params)),
    ],
  ])

  function receive(data: unknown): void {
    const message = parseIncomingMessage(data)
    if (!isRecord(message)) return
    if (isRequestMessage(message)) {
      void handleRequest(message)
      return
    }
    if (isNotificationMessage(message)) {
      handleNotification(message)
      return
    }
    settleServerRequest(message)
  }

  async function handleRequest(message: lsp.RequestMessage): Promise<void> {
    const id = requestId(message)
    if (id !== null) inFlightRequests.add(id)

    try {
      const handler = requests.get(message.method)
      if (!handler) throw rpcError(METHOD_NOT_FOUND, `Method not implemented: ${message.method}`)

      const result = await handler(message.params, id)
      if (!claimResponse(id)) return
      post({ jsonrpc: JSON_RPC_VERSION, id: message.id ?? null, result })
    } catch (error) {
      if (!claimResponse(id)) return
      post({
        jsonrpc: JSON_RPC_VERSION,
        id: message.id ?? null,
        error: responseErrorFromThrown(error),
      })
    }
  }

  /**
   * Whether a response for this id may still be posted.
   *
   * A cancelled request answers nothing at all. The protocol also allows a `RequestCancelled` error
   * response, but by the time `$/cancelRequest` reaches this worker the client has already rejected
   * that request locally and forgotten its id (`LspClient.abortRequest`), so a late error has nowhere
   * to land — and a cancellation that abandons real work is the point of §C8, not response
   * suppression.
   */
  function claimResponse(id: JsonRpcRequestId | null): boolean {
    if (id === null) return true
    return inFlightRequests.delete(id)
  }

  function isCancelled(id: JsonRpcRequestId | null): boolean {
    return id !== null && !inFlightRequests.has(id)
  }

  function handleNotification(message: lsp.NotificationMessage): void {
    try {
      routeNotification(message)
    } catch (error) {
      postLogMessage(errorMessage(error))
    }
  }

  function routeNotification(message: lsp.NotificationMessage): void {
    if (message.method === '$/cancelRequest') return handleCancelRequest(message.params)
    if (message.method === 'exit') return shutdownState()
    if (message.method === 'textDocument/didOpen') return handleDidOpen(message.params)
    if (message.method === 'textDocument/didChange') return handleDidChange(message.params)
    if (message.method === 'textDocument/didClose') return handleDidClose(message.params)
    if (message.method === SET_WORKSPACE_FILES) return handleSetWorkspaceFiles(message.params)
    if (message.method === UPSERT_WORKSPACE_FILES) return handleUpsertFiles(message.params)
    if (message.method === DELETE_WORKSPACE_FILES) return handleDeleteFiles(message.params)
  }

  function handleCancelRequest(params: unknown): void {
    if (!isRecord(params)) return

    const id = params.id
    if (typeof id !== 'number' && typeof id !== 'string') return
    inFlightRequests.delete(id)
  }

  function initializeResult(params: unknown): lsp.InitializeResult {
    const initializationOptions = readInitializationOptions(params)
    canonicalPaths = initializationOptions.canonicalPaths ?? {}
    compilerOptionsOverride = initializationOptions.compilerOptions ?? {}
    diagnosticDelayMs = initializationOptions.diagnosticDelayMs ?? DEFAULT_DIAGNOSTIC_DELAY_MS
    formatBase = { ...defaultFormatSettings(), ...initializationOptions.formatOptions }
    preferences = { ...DEFAULT_PREFERENCES, ...initializationOptions.preferences }
    librarySource = initializationOptions.libraryFiles ?? 'bundled'
    clientCapabilities = readClientCapabilities(params)
    invalidateService()

    return {
      capabilities: {
        textDocumentSync: {
          openClose: true,
          change: TEXT_DOCUMENT_SYNC_INCREMENTAL,
        },
        diagnosticProvider: {
          interFileDependencies: true,
          workspaceDiagnostics: false,
        },
        hoverProvider: true,
        completionProvider: {
          resolveProvider: true,
          triggerCharacters: Array.from(COMPLETION_TRIGGER_CHARACTERS),
        },
        signatureHelpProvider: {
          triggerCharacters: SIGNATURE_HELP_TRIGGER_CHARACTERS,
          retriggerCharacters: SIGNATURE_HELP_RETRIGGER_CHARACTERS,
        },
        definitionProvider: true,
        referencesProvider: true,
        implementationProvider: true,
        typeDefinitionProvider: true,
        documentHighlightProvider: true,
        documentSymbolProvider: true,
        workspaceSymbolProvider: true,
        codeActionProvider: { codeActionKinds: CODE_ACTION_KINDS, resolveProvider: true },
        documentFormattingProvider: true,
        documentRangeFormattingProvider: true,
        documentOnTypeFormattingProvider: {
          firstTriggerCharacter: ON_TYPE_FORMATTING_FIRST_TRIGGER,
          moreTriggerCharacter: ON_TYPE_FORMATTING_MORE_TRIGGERS,
        },
        renameProvider: { prepareProvider: true },
        semanticTokensProvider: {
          legend: SEMANTIC_TOKEN_LEGEND,
          full: true,
          range: true,
        },
      },
    }
  }

  function shutdownResult(): null {
    shutdownState()
    return null
  }

  function shutdownState(): void {
    for (const timer of diagnosticTimers.values()) clearTimeout(timer)
    diagnosticTimers.clear()
    if (refreshTimer) clearTimeout(refreshTimer)
    refreshTimer = null
    for (const pending of serverRequests.values()) pending.reject(new Error('Session shut down'))
    serverRequests.clear()
    documents.clear()
    workspaceFiles.clear()
    invalidateService()
  }

  function handleDidOpen(params: unknown): void {
    const textDocument = textDocumentItemFromParams(params)
    if (!textDocument) return

    const fileName = canonicalName(documentUriToFileName(textDocument.uri))
    if (!fileName) return
    if (!isTypeScriptLspSourceFileName(fileName)) return

    const document = {
      uri: textDocument.uri,
      fileName,
      languageId: textDocument.languageId,
      version: textDocument.version,
      text: textDocument.text,
    }
    documents.set(document.uri, document)
    void withProject((project) =>
      project.setOpen(
        documentUriToFileName(document.uri) ?? document.fileName,
        document.text,
        document.uri,
      ),
    )
    documentChanged(document.uri)
  }

  function handleDidChange(params: unknown): void {
    const change = didChangeParams(params)
    if (!change) return

    const current = documents.get(change.uri)
    if (!current) return

    const document = {
      ...current,
      version: change.version,
      text: applyContentChanges(current.text, change.contentChanges),
    }
    documents.set(document.uri, document)
    void withProject((project) =>
      project.setOpen(
        documentUriToFileName(document.uri) ?? document.fileName,
        document.text,
        document.uri,
      ),
    )
    documentChanged(document.uri)
  }

  function handleDidClose(params: unknown): void {
    const uri = textDocumentUri(params)
    if (!uri) return

    const document = documents.get(uri)
    documents.delete(uri)
    clearScheduledDiagnostics(uri)
    projectRevision += 1
    if (pushesDiagnostics()) postDiagnostics(uri, document?.version ?? null, [])
    if (document)
      void withProject((project) =>
        project.closeOpen(documentUriToFileName(document.uri) ?? document.fileName, document.uri),
      )
  }

  function handleSetWorkspaceFiles(params: unknown): void {
    workspaceFiles = new Map(
      filesFromParams(params).map((file) => [sourcePathToFileName(file.path), file.text]),
    )
    invalidateService()
    workspaceChanged()
  }

  function handleUpsertFiles(params: unknown): void {
    const fileNames: string[] = []
    let added = false
    for (const file of filesFromParams(params)) {
      const fileName = sourcePathToFileName(file.path)
      added ||= !workspaceFiles.has(fileName)
      workspaceFiles.set(fileName, file.text)
      fileNames.push(fileName)
    }
    applyWorkspaceChange(fileNames, added)
  }

  function handleDeleteFiles(params: unknown): void {
    const fileNames = pathsFromParams(params)
      .map(sourcePathToFileName)
      .filter((fileName) => workspaceFiles.has(fileName))
    for (const fileName of fileNames) workspaceFiles.delete(fileName)
    applyWorkspaceChange(fileNames, true)
  }

  /**
   * Applies changed workspace files to the running program, one file at a time. A file that decides
   * the project's shape — a tsconfig, a package.json — rebuilds it instead, and so does anything
   * that arrives before the program exists, which then simply starts from the new files.
   */
  function applyWorkspaceChange(fileNames: readonly string[], membershipChanged: boolean): void {
    if (fileNames.length === 0) return
    if (fileNames.some(isProjectShapeFile)) {
      invalidateService()
      workspaceChanged()
      return
    }

    void withProject((project, state) => {
      for (const fileName of fileNames) updateProjectFile(project, fileName)
      if (membershipChanged) project.setRoots(projectRoots(state.config !== null))
    })
    workspaceChanged()
  }

  function updateProjectFile(project: ProjectHost, fileName: string): void {
    const text = workspaceFiles.get(fileName)
    for (const target of [fileName, ...mirrorPaths(workspacePackageList(), fileName)]) {
      if (text === undefined) project.deleteFile(target)
      else project.setFile(target, text)
    }
  }

  /** Once per batch that adds or removes files: the tsconfig's patterns decide whether they count. */
  function projectRoots(hasConfig: boolean): string[] {
    const current = hasConfig ? readProjectConfig(workspaceFiles, reportConfigDiagnostic) : null
    return rootFileNames(workspaceFiles, current)
  }

  function workspacePackageList(): readonly WorkspacePackage[] {
    packagesCache ??= workspacePackages(workspaceFiles)
    return packagesCache
  }

  function workspaceChanged(): void {
    projectRevision += 1
    if (pushesDiagnostics()) {
      for (const uri of documents.keys()) scheduleDiagnostics(uri)
      return
    }
    scheduleDiagnosticRefresh()
  }

  function documentChanged(uri: lsp.DocumentUri): void {
    projectRevision += 1
    if (pushesDiagnostics()) {
      scheduleDiagnostics(uri)
      return
    }
    // The client pulls for the document it just changed; any other open one may have changed too.
    if (documents.size > 1) scheduleDiagnosticRefresh()
  }

  /** Runs against the program once it exists; before then the next build starts from current state. */
  async function withProject(
    run: (project: ProjectHost, state: ServiceState) => void,
  ): Promise<void> {
    if (!servicePromise) return

    try {
      const state = await ensureService()
      run(state.project, state)
    } catch (error) {
      postLogMessage(errorMessage(error))
    }
  }

  /** Clients that pull are never pushed to: the same diagnostics would be computed twice per edit. */
  function pushesDiagnostics(): boolean {
    return clientCapabilities.textDocument?.diagnostic === undefined
  }

  function scheduleDiagnostics(uri: lsp.DocumentUri): void {
    clearScheduledDiagnostics(uri)
    // @justification Debounces diagnostics per document inside the worker, off the main thread; the
    // handle is kept per URI and cleared on the next edit or close.
    const timer = setTimeout(() => {
      diagnosticTimers.delete(uri)
      void publishDiagnosticsForUri(uri)
    }, diagnosticDelayMs)
    diagnosticTimers.set(uri, timer)
  }

  function clearScheduledDiagnostics(uri: lsp.DocumentUri): void {
    const timer = diagnosticTimers.get(uri)
    if (!timer) return

    clearTimeout(timer)
    diagnosticTimers.delete(uri)
  }

  async function publishDiagnosticsForUri(uri: lsp.DocumentUri): Promise<void> {
    const scheduledDocument = documents.get(uri)
    if (!scheduledDocument) return

    try {
      const state = await ensureService()
      const currentDocument = documents.get(uri)
      if (!isCurrentDocument(scheduledDocument, currentDocument)) return

      const diagnostics = collectDiagnostics(state.project, currentDocument.fileName)
      postDiagnostics(currentDocument.uri, currentDocument.version, diagnostics)
    } catch (error) {
      postLogMessage(errorMessage(error))
    }
  }

  function scheduleDiagnosticRefresh(): void {
    if (clientCapabilities.workspace?.diagnostics?.refreshSupport !== true) return
    if (refreshTimer) clearTimeout(refreshTimer)
    // @justification Coalesces diagnostic refresh requests inside the worker; one handle, cleared
    // before every reschedule.
    refreshTimer = setTimeout(() => {
      refreshTimer = null
      void requestClient(DIAGNOSTIC_REFRESH, undefined).catch(() => undefined)
    }, diagnosticDelayMs)
  }

  /**
   * Waits out the same delay a push would, so a burst of keystrokes costs one computation: each
   * keystroke's pull cancels the one before it, and a cancelled pull stops here.
   */
  async function pullDiagnostics(
    params: unknown,
    id: JsonRpcRequestId | null,
  ): Promise<lsp.DocumentDiagnosticReport> {
    await delay(diagnosticDelayMs)
    const empty: lsp.DocumentDiagnosticReport = { kind: 'full', items: [] }
    if (isCancelled(id)) return empty

    const revision = projectRevision
    return withDocument(params, id, empty, (ctx) => documentDiagnosticReport(ctx, params, revision))
  }

  /**
   * Runs a document request against the service and the document together, once both have settled —
   * or answers `empty` if the document moved out from under the request while we waited.
   *
   * `ensureService()` can suspend for a long time — the first call loads the lib set, and a
   * workspace reset invalidates the service so that recurs — and notifications are routed the
   * moment they arrive, with nothing serialising them behind an in-flight request. So a `didChange`
   * lands freely inside that window, and a handler still holding the document it captured before
   * the await would read positions from one version against a program built from another: an
   * answer consistent with neither, which no host-side version check can reconcile.
   */
  async function withDocument<R>(
    params: unknown,
    id: JsonRpcRequestId | null,
    empty: R,
    run: (ctx: DocumentContext) => R,
  ): Promise<R> {
    const uri = textDocumentUri(params)
    const requested = uri ? documentForUri(uri) : null
    if (!requested) return empty

    const state = await ensureService()
    const current = documentForUri(requested.uri)
    if (!current || !isCurrentDocument(requested, current)) return empty
    if (isCancelled(id)) return empty

    return run(
      documentContext(
        state.project,
        current,
        id,
        formatSettingsFor(formatBase, null, current.text),
      ),
    )
  }

  /** A formatting request also teaches the session the editor's indentation for later edits. */
  function withFormatting(
    params: unknown,
    id: JsonRpcRequestId | null,
    run: (ctx: DocumentContext) => lsp.TextEdit[],
  ): Promise<lsp.TextEdit[]> {
    formatBase = formatSettingsFor(formatBase, params, '')
    return withDocument(params, id, [], run)
  }

  async function withService<R>(
    id: JsonRpcRequestId | null,
    run: (ctx: ServiceContext) => R,
  ): Promise<R> {
    const state = await ensureService()
    return run(serviceContext(state.project, id, formatBase))
  }

  function serviceContext(
    project: ProjectService,
    id: JsonRpcRequestId | null,
    formatSettings: ts.FormatCodeSettings,
  ): ServiceContext {
    return {
      env: project,
      formatSettings,
      preferences,
      documentChanges: clientCapabilities.workspace?.workspaceEdit?.documentChanges === true,
      linesOf: (fileName) => linesOf(project, fileName),
      uriOf,
      fileNameOf: (uri) => documents.get(uri)?.fileName ?? documentUriToFileName(uri),
      versionOf: (uri) => documents.get(uri)?.version ?? null,
      cancelled: () => isCancelled(id),
    }
  }

  function documentContext(
    project: ProjectService,
    document: WorkerDocument,
    id: JsonRpcRequestId | null,
    formatSettings: ts.FormatCodeSettings,
  ): DocumentContext {
    return {
      ...serviceContext(project, id, formatSettings),
      document,
      lines: lineIndexFor(document.fileName, document.text),
    }
  }

  function linesOf(project: ProjectService, fileName: string): LineIndex | null {
    const text = textOf(project, fileName)
    if (text === null) return null
    return lineIndexFor(fileName, text)
  }

  function textOf(project: ProjectService, fileName: string): string | null {
    const workspaceName = canonicalName(
      workspaceFileNameForResult(workspaceFiles, workspacePackageList(), fileName),
    )!
    const openDocument = documentForFileName(workspaceName)
    if (openDocument) return openDocument.text

    const workspaceText = workspaceFiles.get(workspaceName)
    if (workspaceText !== undefined) return workspaceText

    return project.getSourceFile(sourcePathToFileName(fileName))?.text ?? null
  }

  function lineIndexFor(fileName: string, text: string): LineIndex {
    const cached = lineIndexes.get(fileName)
    if (cached?.text === text) return cached

    lineIndexes.delete(fileName)
    if (lineIndexes.size >= LINE_INDEX_CACHE_LIMIT) {
      const oldest = lineIndexes.keys().next().value
      if (oldest !== undefined) lineIndexes.delete(oldest)
    }
    const index = new LineIndex(text)
    lineIndexes.set(fileName, index)
    return index
  }

  function uriOf(fileName: string): lsp.DocumentUri {
    const workspaceName = canonicalName(
      workspaceFileNameForResult(workspaceFiles, workspacePackageList(), fileName),
    )!
    return documentForFileName(workspaceName)?.uri ?? fileNameToDocumentUri(workspaceName)
  }

  function documentForUri(uri: lsp.DocumentUri): WorkerDocument | null {
    const openDocument = documents.get(uri)
    if (openDocument) return openDocument

    const fileName = canonicalName(documentUriToFileName(uri))
    if (!fileName) return null

    const text = workspaceFiles.get(fileName)
    if (text === undefined) return null

    return { uri, fileName, languageId: 'typescript', version: 0, text }
  }

  function canonicalName(fileName: string | null): string | null {
    return fileName === null ? null : (canonicalPaths[fileName] ?? fileName)
  }

  function documentForFileName(fileName: string): WorkerDocument | null {
    for (const document of documents.values()) {
      if (document.fileName === fileName) return document
    }
    return null
  }

  function ensureService(): Promise<ServiceState> {
    if (servicePromise) return servicePromise

    servicePromise = createService().catch((error: unknown) => {
      servicePromise = null
      throw error
    })
    return servicePromise
  }

  async function createService(): Promise<ServiceState> {
    const config = readProjectConfig(workspaceFiles, reportConfigDiagnostic)
    const compilerOptions = resolvedCompilerOptions(config, compilerOptionsOverride)
    const libraryFiles = await loadLibraryFiles(compilerOptions, libraryReader())
    const project = new ProjectHost(
      projectFileMap(libraryFiles, workspaceFiles),
      rootFileNames(workspaceFiles, config),
      compilerOptions,
      canonicalPaths,
    )
    for (const document of documents.values())
      project.setOpen(
        documentUriToFileName(document.uri) ?? document.fileName,
        document.text,
        document.uri,
      )
    return { project, config }
  }

  function libraryReader(): LibraryFileReader {
    if (options.readLibraryFiles) return options.readLibraryFiles
    if (librarySource === 'cdn') return readCdnLibraryFiles
    if (librarySource === 'host') return readHostLibraryFiles
    return readBundledLibraryFiles
  }

  async function readHostLibraryFiles(names: readonly string[]): Promise<Map<string, string>> {
    const result = await requestClient(LIBRARY_FILES_REQUEST, { names, version: ts.version })
    // Building without a standard library would flag every file; failing says why instead.
    if (!isRecord(result) || !isRecord(result.files)) {
      throw rpcError(REQUEST_FAILED, `The host answered ${LIBRARY_FILES_REQUEST} without files`)
    }
    const files = result.files
    return new Map(
      Object.entries(files).filter(
        (entry): entry is [string, string] => typeof entry[1] === 'string',
      ),
    )
  }

  function requestClient(method: string, params: unknown): Promise<unknown> {
    serverRequestCount += 1
    const id = `typescript-lsp-${serverRequestCount}`
    return new Promise((resolve, reject) => {
      // @justification A request timeout inside the worker: it only rejects the pending request, and
      // the answer clears it.
      const timer = setTimeout(() => {
        serverRequests.delete(id)
        reject(rpcError(REQUEST_FAILED, `The host did not answer ${method}`))
      }, SERVER_REQUEST_TIMEOUT_MS)
      const settle = (): void => clearTimeout(timer)
      serverRequests.set(id, {
        resolve: (result) => {
          settle()
          resolve(result)
        },
        reject: (error) => {
          settle()
          reject(error)
        },
      })
      post({ jsonrpc: JSON_RPC_VERSION, id, method, ...(params === undefined ? {} : { params }) })
    })
  }

  function settleServerRequest(message: Record<string, unknown>): void {
    if (typeof message.id !== 'string') return
    const pending = serverRequests.get(message.id)
    if (!pending) return

    serverRequests.delete(message.id)
    if (message.error !== undefined) pending.reject(message.error)
    else pending.resolve(message.result)
  }

  function invalidateService(): void {
    servicePromise = null
    packagesCache = null
    lineIndexes.clear()
  }

  function reportConfigDiagnostic(diagnostic: ts.Diagnostic): void {
    postLogMessage(ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'))
  }

  function parameterLabelOffsets(): boolean {
    return (
      clientCapabilities.textDocument?.signatureHelp?.signatureInformation?.parameterInformation
        ?.labelOffsetSupport === true
    )
  }

  function hierarchicalSymbols(): boolean {
    return (
      clientCapabilities.textDocument?.documentSymbol?.hierarchicalDocumentSymbolSupport === true
    )
  }

  function postDiagnostics(
    uri: lsp.DocumentUri,
    version: number | null,
    diagnostics: readonly lsp.Diagnostic[],
  ): void {
    const params: PublishDiagnosticsNotificationParams =
      version === null ? { uri, diagnostics } : { uri, version, diagnostics }
    post({ jsonrpc: JSON_RPC_VERSION, method: 'textDocument/publishDiagnostics', params })
  }

  function postLogMessage(message: string): void {
    post({
      jsonrpc: JSON_RPC_VERSION,
      method: 'window/logMessage',
      params: { type: LOG_MESSAGE_ERROR, message },
    })
  }

  function post(message: unknown): void {
    options.post(message)
  }

  return { receive, dispose: shutdownState }
}

function isCurrentDocument(
  scheduled: WorkerDocument,
  current: WorkerDocument | undefined | null,
): current is WorkerDocument {
  if (!current) return false
  return current.uri === scheduled.uri && current.version === scheduled.version
}

function applyContentChanges(
  text: string,
  changes: readonly lsp.TextDocumentContentChangeEvent[],
): string {
  let nextText = text
  for (const change of changes) nextText = applyContentChange(nextText, change)
  return nextText
}

function applyContentChange(text: string, change: lsp.TextDocumentContentChangeEvent): string {
  if (!('range' in change) || !change.range) return change.text

  const start = lspPositionToOffset(text, change.range.start)
  const end = lspPositionToOffset(text, change.range.end)
  return `${text.slice(0, start)}${change.text}${text.slice(end)}`
}

function filesFromParams(params: unknown): readonly TypeScriptLspSourceFile[] {
  if (!isRecord(params)) return []
  if (!Array.isArray(params.files)) return []
  return params.files.flatMap(parseSourceFile)
}

function pathsFromParams(params: unknown): readonly string[] {
  if (!isRecord(params)) return []
  if (!Array.isArray(params.paths)) return []
  return params.paths.filter((path): path is string => typeof path === 'string')
}

function parseSourceFile(value: unknown): readonly TypeScriptLspSourceFile[] {
  if (!isRecord(value)) return []
  if (typeof value.path !== 'string') return []
  if (typeof value.text !== 'string') return []
  return [{ path: value.path, text: value.text }]
}

function readInitializationOptions(params: unknown): InitializationOptions {
  if (!isRecord(params)) return {}
  const options = params.initializationOptions
  if (!isRecord(options)) return {}

  return {
    canonicalPaths: isRecord(options.canonicalPaths)
      ? Object.fromEntries(
          Object.entries(options.canonicalPaths).filter(
            (entry): entry is [string, string] => typeof entry[1] === 'string',
          ),
        )
      : undefined,
    compilerOptions: isRecord(options.compilerOptions)
      ? (options.compilerOptions as ts.CompilerOptions)
      : undefined,
    diagnosticDelayMs:
      typeof options.diagnosticDelayMs === 'number' ? options.diagnosticDelayMs : undefined,
    formatOptions: isRecord(options.formatOptions)
      ? (options.formatOptions as ts.FormatCodeSettings)
      : undefined,
    preferences: isRecord(options.preferences)
      ? (options.preferences as ts.UserPreferences)
      : undefined,
    libraryFiles: librarySourceOption(options.libraryFiles),
  }
}

function librarySourceOption(value: unknown): TypeScriptLspLibrarySource | undefined {
  if (value === 'bundled' || value === 'cdn' || value === 'host') return value
  return undefined
}

function readClientCapabilities(params: unknown): lsp.ClientCapabilities {
  if (!isRecord(params)) return {}
  return isRecord(params.capabilities) ? (params.capabilities as lsp.ClientCapabilities) : {}
}

function delay(milliseconds: number): Promise<void> {
  // @justification Only resolves an awaited promise inside the worker; nothing renders from it.
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}
