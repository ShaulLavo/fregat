import { isTypeScriptFileName } from './shared/file-type'
import { canReadPath, openDocumentForFileName } from './shared/boundary'
import { samePath } from '../../utils/path'
import { normalizeNativePath } from '../../utils/path'
import { isSameOrDescendant } from '../../fs/path'
import { existsSync } from 'node:fs'
import path from 'node:path'

import {
  tsDiagnosticMessageText,
  tsDiagnosticToLspDiagnostic,
} from '@singapore-editor/typescript-lsp/ts-diagnostics'
import type { PublishDiagnosticsNotificationParams } from '@singapore-editor/lsp/types'
import { isRecord } from '@workspace/utils/objects'
import ts from 'typescript-language-service'
import type * as lsp from 'vscode-languageserver-protocol'

import { handleCodeAction } from './handlers/code-action'
import { handleCompletion } from './handlers/completion'
import { handleDefinition } from './handlers/definition'
import { handleDidChange } from './handlers/did-change'
import { handleDidClose } from './handlers/did-close'
import { handleDidOpen } from './handlers/did-open'
import { handleDocumentSymbol } from './handlers/document-symbol'
import { handleHover } from './handlers/hover'
import { handleInitialize } from './handlers/initialize'
import { handlePrepareRename } from './handlers/prepare-rename'
import { handleReferences } from './handlers/references'
import { handleRename } from './handlers/rename'
import { handleSignatureHelp } from './handlers/signature-help'
import {
  errorMessage,
  JSON_RPC_INTERNAL_ERROR,
  toResponseError,
  type JsonRpcError,
} from './shared/error'
import {
  invalidateForFileContentChange,
  invalidateForProjectConfigChange,
  type InvalidationState,
} from './shared/invalidation'
import { createScriptVersionRegistry, type ScriptVersionRegistry } from './shared/script-versions'
import type {
  OpenDocument,
  SessionContext,
  SessionInitializationOptions,
  WorkspaceEditClientCapabilities,
} from './shared/context'

const JSON_RPC_VERSION = '2.0'
const METHOD_NOT_FOUND = -32601
const DEFAULT_DIAGNOSTIC_DELAY_MS = 150

export type TypeScriptLspSessionOptions = {
  root: string
  workspaceRoot?: string
  diagnosticDelayMs?: number
  send(message: string): void
}

type ProjectConfig = {
  configFileName: string | null
  compilerOptions: ts.CompilerOptions
  fileNames: readonly string[]
}

export class TypeScriptLspSession {
  readonly root: string
  readonly workspaceRoot: string
  private readonly sendMessage: (message: string) => void
  private readonly documents = new Map<lsp.DocumentUri, OpenDocument>()
  private readonly diagnosticTimers = new Map<lsp.DocumentUri, ReturnType<typeof setTimeout>>()
  private readonly scriptVersions: ScriptVersionRegistry = createScriptVersionRegistry()
  private readonly invalidationState: InvalidationState
  private compilerOptionsOverride: ts.CompilerOptions = {}
  private workspaceEditCapabilities: WorkspaceEditClientCapabilities = {
    changeAnnotationSupport: false,
    documentChanges: false,
    resourceOperations: [],
  }
  private diagnosticDelayMs: number
  private service: ts.LanguageService | null = null
  private serviceFailed = false
  private serviceFailureMessage = 'TypeScript language service unavailable'
  private projectVersion = 0
  private shutdown = false

  constructor(options: TypeScriptLspSessionOptions) {
    this.root = normalizeNativePath(options.root)
    this.workspaceRoot = normalizeNativePath(options.workspaceRoot ?? options.root)
    this.sendMessage = options.send
    this.diagnosticDelayMs = options.diagnosticDelayMs ?? DEFAULT_DIAGNOSTIC_DELAY_MS
    this.invalidationState = this.createInvalidationState()
  }

  handleMessage(data: string | ArrayBuffer | Uint8Array): void {
    const message = parseIncomingMessage(data)
    if (isRequestMessage(message)) void this.handleRequest(message)
    if (isNotificationMessage(message)) this.handleNotification(message)
  }

  dispose(): void {
    for (const timer of this.diagnosticTimers.values()) clearTimeout(timer)
    this.diagnosticTimers.clear()
    this.documents.clear()
    this.disposeService()
  }

  private async handleRequest(message: lsp.RequestMessage): Promise<void> {
    try {
      this.postResponse(message.id ?? null, await this.requestResult(message))
    } catch (error) {
      this.postResponseError(message.id ?? null, error)
    }
  }

  private handleNotification(message: lsp.NotificationMessage): void {
    try {
      this.routeNotification(message)
    } catch (error) {
      this.postLogMessage(error)
    }
  }

  private requestResult(message: lsp.RequestMessage): unknown {
    const ctx = this.context()
    if (message.method === 'initialize') return handleInitialize(ctx, message.params)
    if (message.method === 'shutdown') return this.shutdownResult()
    if (message.method === 'textDocument/hover') return handleHover(ctx, message.params)
    if (message.method === 'textDocument/definition') return handleDefinition(ctx, message.params)
    if (message.method === 'textDocument/completion') return handleCompletion(ctx, message.params)
    if (message.method === 'textDocument/signatureHelp')
      return handleSignatureHelp(ctx, message.params)
    if (message.method === 'textDocument/references') return handleReferences(ctx, message.params)
    if (message.method === 'textDocument/documentSymbol')
      return handleDocumentSymbol(ctx, message.params)
    if (message.method === 'textDocument/prepareRename')
      return handlePrepareRename(ctx, message.params)
    if (message.method === 'textDocument/rename') return handleRename(ctx, message.params)
    if (message.method === 'textDocument/codeAction') return handleCodeAction(ctx, message.params)
    throw rpcError(METHOD_NOT_FOUND, `Method not implemented: ${message.method}`)
  }

  private routeNotification(message: lsp.NotificationMessage): void {
    const ctx = this.context()
    if (message.method === 'initialized' || message.method === '$/cancelRequest') return
    if (message.method === 'editor/typescript/setWorkspaceFiles') return
    if (message.method === 'exit') return this.dispose()
    if (message.method === 'textDocument/didOpen') return handleDidOpen(ctx, message.params)
    if (message.method === 'textDocument/didChange') return handleDidChange(ctx, message.params)
    if (message.method === 'textDocument/didClose') return handleDidClose(ctx, message.params)
  }

  private context(): SessionContext {
    return {
      root: this.root,
      workspaceRoot: this.workspaceRoot,
      documents: this.documents,
      getLanguageService: () => this.ensureService(),
      getProjectVersion: () => String(this.projectVersion),
      scheduleDiagnostics: (uri) => this.scheduleDiagnostics(uri),
      clearScheduledDiagnostics: (uri) => this.clearScheduledDiagnostics(uri),
      bumpScriptVersion: (fileName) => this.scriptVersions.bump(fileName),
      invalidateForFileContentChange: (fileName) =>
        invalidateForFileContentChange(this.invalidationState, fileName),
      invalidateForProjectConfigChange: () =>
        invalidateForProjectConfigChange(this.invalidationState),
      postDiagnostics: (uri, version, diagnostics) =>
        this.postDiagnostics(uri, version, diagnostics),
      postLogMessage: (error) => this.postLogMessage(error),
      postResponse: (id, result) => this.postResponse(id, result),
      postResponseError: (id, error) => this.postResponseError(id, error),
      compilerOptionsOverride: this.compilerOptionsOverride,
      workspaceEditCapabilities: this.workspaceEditCapabilities,
      applyInitializationOptions: (options) => this.applyInitializationOptions(options),
    }
  }

  private shutdownResult(): null {
    this.shutdown = true
    this.dispose()
    return null
  }

  private applyInitializationOptions(options: SessionInitializationOptions): void {
    this.compilerOptionsOverride = options.compilerOptions ?? {}
    this.diagnosticDelayMs = options.diagnosticDelayMs ?? DEFAULT_DIAGNOSTIC_DELAY_MS
    this.workspaceEditCapabilities = options.workspaceEditCapabilities
  }

  private ensureService(): ts.LanguageService {
    if (this.service) return this.service
    if (this.serviceFailed) throw rpcError(JSON_RPC_INTERNAL_ERROR, this.serviceFailureMessage)
    const priorProjectVersion = this.projectVersion
    try {
      this.service = ts.createLanguageService(
        this.languageServiceHost(this.projectConfig()),
        ts.createDocumentRegistry(),
      )
      return this.service
    } catch (error) {
      this.service = null
      this.projectVersion = priorProjectVersion
      this.serviceFailed = true
      this.serviceFailureMessage = errorMessage(error)
      throw rpcError(JSON_RPC_INTERNAL_ERROR, this.serviceFailureMessage)
    }
  }

  private projectConfig(): ProjectConfig {
    const configFileName = this.projectConfigFileName()
    if (!configFileName) return this.inferredProjectConfig()
    const parsed = this.parseProjectConfig(configFileName, true)
    if (!parsed) return this.inferredProjectConfig()
    return {
      configFileName,
      compilerOptions: parsed.options,
      fileNames: this.rootFileNames(parsed.fileNames),
    }
  }

  private inferredProjectConfig(): ProjectConfig {
    return {
      configFileName: null,
      compilerOptions: { ...defaultCompilerOptions(), ...this.compilerOptionsOverride },
      fileNames: this.rootFileNames([]),
    }
  }

  private rootFileNames(configFileNames: readonly string[]): readonly string[] {
    const files = new Set(configFileNames.map(normalizeNativePath))
    for (const document of this.documents.values()) files.add(document.fileName)
    return Array.from(files).filter(
      (fileName) => isTypeScriptFileName(fileName) && isSameOrDescendant(this.root, fileName),
    )
  }

  private projectConfigFileName(): string | null {
    for (const document of this.sortedDocuments()) {
      const config = this.configFileNameForDocument(document.fileName)
      if (config) return config
    }
    const rootConfig = path.join(this.root, 'tsconfig.json')
    return existsSync(rootConfig) ? normalizeNativePath(rootConfig) : null
  }

  private configFileNameForDocument(fileName: string): string | null {
    const configFileName = this.nearestConfigFile(fileName)
    if (!configFileName) return null
    const parsed = this.parseProjectConfig(configFileName, false)
    if (!parsed) return configFileName
    return (
      this.referencedConfigFileNameForDocument(parsed, configFileName, fileName) ?? configFileName
    )
  }

  private referencedConfigFileNameForDocument(
    parsed: ts.ParsedCommandLine,
    configFileName: string,
    fileName: string,
  ): string | null {
    for (const reference of parsed.projectReferences ?? []) {
      const referenceConfig = referencedConfigFileName(configFileName, reference)
      if (!isSameOrDescendant(this.root, referenceConfig)) continue
      if (this.configIncludesFile(referenceConfig, fileName)) return referenceConfig
    }
    return null
  }

  private configIncludesFile(configFileName: string, fileName: string): boolean {
    const parsed = this.parseProjectConfig(configFileName, false)
    if (!parsed) return false
    const normalized = normalizeNativePath(fileName)
    return parsed.fileNames.some((candidate) => samePath(candidate, normalized))
  }

  private parseProjectConfig(
    configFileName: string,
    report: boolean,
  ): ts.ParsedCommandLine | undefined {
    const parsed = ts.getParsedCommandLineOfConfigFile(
      configFileName,
      this.compilerOptionsOverride,
      {
        useCaseSensitiveFileNames: ts.sys.useCaseSensitiveFileNames,
        getCurrentDirectory: () => this.root,
        fileExists: (fileName) => this.fileExists(fileName),
        readFile: (fileName) => this.readFile(fileName),
        readDirectory: (rootDir, extensions, excludes, includes, depth) =>
          this.readDirectory(rootDir, extensions, excludes, includes, depth),
        onUnRecoverableConfigFileDiagnostic: (diagnostic) =>
          this.reportConfigDiagnostics([diagnostic]),
      },
    )
    if (report && parsed) this.reportConfigDiagnostics(parsed.errors)
    return parsed
  }

  private languageServiceHost(config: ProjectConfig): ts.LanguageServiceHost {
    return {
      getCompilationSettings: () => config.compilerOptions,
      getCurrentDirectory: () => this.root,
      getDefaultLibFileName: (options) => ts.getDefaultLibFilePath(options),
      getDirectories: (directoryName) => this.getDirectories(directoryName),
      getNewLine: () => ts.sys.newLine,
      getProjectVersion: () => String(this.projectVersion),
      getScriptFileNames: () => Array.from(config.fileNames),
      getScriptSnapshot: (fileName) => this.scriptSnapshot(fileName),
      getScriptVersion: (fileName) => this.scriptVersion(fileName),
      readDirectory: (rootDir, extensions, excludes, includes, depth) =>
        this.readDirectory(rootDir, extensions, excludes, includes, depth),
      readFile: (fileName) => this.readFile(fileName),
      fileExists: (fileName) => this.fileExists(fileName),
      directoryExists: (directoryName) => this.directoryExists(directoryName),
      realpath: (fileName) => this.realpath(fileName),
      useCaseSensitiveFileNames: () => ts.sys.useCaseSensitiveFileNames,
    }
  }

  private readFile(fileName: string): string | undefined {
    const normalized = normalizeNativePath(fileName)
    const openDocument = openDocumentForFileName(this.documents, normalized)
    if (openDocument) return openDocument.text
    if (!canReadPath(this, normalized)) return undefined
    return ts.sys.readFile(normalized)
  }

  private fileExists(fileName: string): boolean {
    const normalized = normalizeNativePath(fileName)
    if (openDocumentForFileName(this.documents, normalized)) return true
    if (!canReadPath(this, normalized)) return false
    return ts.sys.fileExists(normalized)
  }

  private readDirectory(
    rootDir: string,
    extensions?: readonly string[],
    excludes?: readonly string[],
    includes?: readonly string[],
    depth?: number,
  ): string[] {
    const normalized = normalizeNativePath(rootDir)
    if (!canReadPath(this, normalized)) return []
    return ts.sys
      .readDirectory(normalized, extensions, excludes, includes, depth)
      .map(normalizeNativePath)
      .filter((fileName) => canReadPath(this, fileName))
  }

  private directoryExists(directoryName: string): boolean {
    const normalized = normalizeNativePath(directoryName)
    if (!canReadPath(this, normalized)) return false
    return ts.sys.directoryExists(normalized)
  }

  private getDirectories(directoryName: string): string[] {
    const normalized = normalizeNativePath(directoryName)
    if (!canReadPath(this, normalized)) return []
    return ts.sys.getDirectories(normalized).map(normalizeNativePath)
  }

  private realpath(fileName: string): string {
    const normalized = normalizeNativePath(fileName)
    const real = normalizeNativePath(ts.sys.realpath?.(normalized) ?? normalized)
    return canReadPath(this, real) ? real : normalized
  }

  private scriptSnapshot(fileName: string): ts.IScriptSnapshot | undefined {
    const text = this.readFile(fileName)
    return text === undefined ? undefined : ts.ScriptSnapshot.fromString(text)
  }

  private scriptVersion(fileName: string): string {
    const normalized = normalizeNativePath(fileName)
    return String(
      openDocumentForFileName(this.documents, normalized)?.version ??
        this.scriptVersions.get(normalized),
    )
  }

  private sortedDocuments(): readonly OpenDocument[] {
    return Array.from(this.documents.values()).toSorted((left, right) =>
      left.fileName.localeCompare(right.fileName),
    )
  }

  private nearestConfigFile(fileName: string): string | null {
    let directory = path.dirname(fileName)
    while (isSameOrDescendant(this.root, directory)) {
      const config = path.join(directory, 'tsconfig.json')
      if (existsSync(config)) return normalizeNativePath(config)
      if (samePath(directory, this.root)) return null
      directory = path.dirname(directory)
    }
    return null
  }

  private scheduleDiagnostics(uri: lsp.DocumentUri): void {
    this.clearScheduledDiagnostics(uri)
    const timer = setTimeout(() => {
      this.diagnosticTimers.delete(uri)
      this.publishDiagnostics(uri)
    }, this.diagnosticDelayMs)
    this.diagnosticTimers.set(uri, timer)
  }

  private clearScheduledDiagnostics(uri: lsp.DocumentUri): void {
    const timer = this.diagnosticTimers.get(uri)
    if (!timer) return
    clearTimeout(timer)
    this.diagnosticTimers.delete(uri)
  }

  private publishDiagnostics(uri: lsp.DocumentUri): void {
    const document = this.documents.get(uri)
    if (!document) return
    try {
      const diagnostics = this.collectDiagnostics(document.fileName)
      this.postDiagnostics(uri, document.version, diagnostics)
    } catch (error) {
      this.postLogMessage(error)
    }
  }

  private collectDiagnostics(fileName: string): readonly lsp.Diagnostic[] {
    const service = this.ensureService()
    return [
      ...service.getSyntacticDiagnostics(fileName),
      ...service.getSemanticDiagnostics(fileName),
      ...service.getSuggestionDiagnostics(fileName),
    ].map((diagnostic) =>
      tsDiagnosticToLspDiagnostic(
        diagnostic,
        this.readFile(diagnosticFileName(diagnostic, fileName)) ?? '',
      ),
    )
  }

  private createInvalidationState(): InvalidationState {
    return {
      bumpProjectVersion: () => {
        this.projectVersion += 1
      },
      scriptVersions: this.scriptVersions,
      getLanguageService: () => this.service,
      setLanguageService: (service) => {
        this.service = service
        if (service === null) this.serviceFailed = false
      },
    }
  }

  private disposeService(): void {
    this.service?.dispose()
    this.service = null
  }

  private reportConfigDiagnostics(diagnostics: readonly ts.Diagnostic[]): void {
    for (const diagnostic of diagnostics) this.postLogMessage(tsDiagnosticMessageText(diagnostic))
  }

  private postDiagnostics(
    uri: lsp.DocumentUri,
    version: number | null,
    diagnostics: readonly lsp.Diagnostic[],
  ): void {
    const params: PublishDiagnosticsNotificationParams =
      version === null ? { uri, diagnostics } : { uri, version, diagnostics }
    this.postNotification('textDocument/publishDiagnostics', params)
  }

  private postResponse(id: lsp.RequestMessage['id'] | null, result: unknown): void {
    this.postMessage({ jsonrpc: JSON_RPC_VERSION, id, result })
  }

  private postResponseError(id: lsp.RequestMessage['id'] | null, error: unknown): void {
    this.postJsonRpcError(id, toResponseError(error))
  }

  private postJsonRpcError(id: lsp.RequestMessage['id'] | null, error: JsonRpcError): void {
    this.postMessage({ jsonrpc: JSON_RPC_VERSION, id, error })
  }

  private postNotification(method: string, params: unknown): void {
    if (this.shutdown && method !== 'window/logMessage') return
    this.postMessage({ jsonrpc: JSON_RPC_VERSION, method, params })
  }

  private postLogMessage(error: unknown): void {
    this.postNotification('window/logMessage', { type: 2, message: errorMessage(error) })
  }

  private postMessage(message: unknown): void {
    this.sendMessage(JSON.stringify(message))
  }
}

function defaultCompilerOptions(): ts.CompilerOptions {
  return {
    target: ts.ScriptTarget.ES2023,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    jsx: ts.JsxEmit.ReactJSX,
    strict: true,
    noEmit: true,
    allowJs: true,
    checkJs: false,
    allowImportingTsExtensions: true,
    esModuleInterop: true,
    skipLibCheck: true,
    resolveJsonModule: true,
  }
}

function diagnosticFileName(diagnostic: ts.Diagnostic, fallback: string): string {
  return diagnostic.file?.fileName ? normalizeNativePath(diagnostic.file.fileName) : fallback
}

function referencedConfigFileName(
  parentConfigFileName: string,
  reference: ts.ProjectReference,
): string {
  const basePath = path.resolve(path.dirname(parentConfigFileName), reference.path)
  if (path.extname(basePath) === '.json') return normalizeNativePath(basePath)
  return normalizeNativePath(path.join(basePath, 'tsconfig.json'))
}

function parseIncomingMessage(data: string | ArrayBuffer | Uint8Array): unknown {
  const text = incomingText(data)
  if (text === null) return null
  try {
    return JSON.parse(text) as unknown
  } catch {
    return null
  }
}

function incomingText(data: string | ArrayBuffer | Uint8Array): string | null {
  if (typeof data === 'string') return data
  if (data instanceof ArrayBuffer) return new TextDecoder().decode(data)
  if (data instanceof Uint8Array) return new TextDecoder().decode(data)
  return null
}

function isRequestMessage(message: unknown): message is lsp.RequestMessage {
  if (!isRecord(message)) return false
  return 'id' in message && typeof message.method === 'string'
}

function isNotificationMessage(message: unknown): message is lsp.NotificationMessage {
  if (!isRecord(message)) return false
  return !('id' in message) && typeof message.method === 'string'
}

function rpcError(code: number, message: string, data?: unknown): JsonRpcError {
  return data === undefined ? { code, message } : { code, message, data }
}
