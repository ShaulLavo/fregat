import { LanguageServerDocument, type DocumentLanguageServerLane } from './document'
import type { LanguageServerDocumentPluginOptions } from './types'
import type { EditorCommandId } from '@singapore-editor/core/editor'
import type {
  EditorContributionChange,
  EditorCapabilityToken,
  EditorCommandContributionContext,
  EditorDisposable,
  EditorEditContribution,
  EditorEditContributionContext,
  EditorViewContribution,
  EditorViewContributionContext,
  EditorViewContributionUpdateKind,
  EditorViewSnapshot,
} from '@singapore-editor/core/extensions'
import type {
  LspClient,
  LspNotificationHandler,
  LspServerRequestHandler,
} from '@singapore-editor/lsp'
import type * as lsp from 'vscode-languageserver-protocol'

import {
  LANGUAGE_SERVER_COMPLETION_EDIT_FEATURE,
  createCompletionEditFeature,
  type LanguageServerCompletionEditFeature,
} from './completion'
import {
  anchoredSurfaceFollowsUpdate,
  isInsideEditorPopup,
} from '@singapore-editor/plugin-ui/anchored-surface'
import { EDITOR_HOVER_PARTICIPANT } from '@singapore-editor/plugin-ui/hover-participant'
import { hoverControllerFor } from '@singapore-editor/plugin-ui/hover-registry'
import { CodeActionController } from './codeActions'
import type { OffsetRange } from '@singapore-editor/plugin-ui/offset-range'
import { CompletionController } from './completionController'
import {
  COMPLETION_KEY_COMMANDS,
  SIGNATURE_HELP_KEY_COMMANDS,
  type CompletionKeyCommand,
  type SignatureHelpKeyCommand,
} from './keyCommands'
import {
  createLanguageServerCompletionSource,
  LanguageServerCompletionSources,
} from './completionProviders'
import { CompositeDiagnosticsPresenter, DiagnosticsPresenter } from './diagnosticsPresenter'
import { activeDocumentForSnapshot, DocumentSync } from './documentSync'
import { FormatOnTypeController } from './formatOnType'
import { DefinitionLinkController } from './definitionLinkController'
import { createLanguageServerHoverParticipant } from './hoverParticipant'
import type {
  SignatureHelpController,
  SignatureHelpControllerOptions,
} from './signatureHelpController'
import { signatureHelpTriggerFromTypedText } from './signatureHelp'
import { DocumentHighlightController } from './documentHighlightController'
import {
  SemanticTokenLayerOwner,
  type LanguageServerSemanticTokensFactory,
  type LanguageServerSemanticTokensOptions,
  type LanguageServerSemanticTokensOwnerOptions,
} from './semanticTokens'
import { createRenameWidgetController, type RenameWidgetController } from './renameWidget'
import { parseWorkspaceEdit } from './workspaceEdit'
import { currentWorkspaceEditOrigin } from './workspaceEditProvenance'
import { wordRangeAtOffset } from '@singapore-editor/core/document'
import {
  lspPositionToOffsetInSnapshot,
  offsetToLspPositionInSnapshot,
  type LspTextDocumentSnapshot,
} from '@singapore-editor/lsp'
import { rangeAroundOffset } from './sourceText'
import type { LspConnectionProvider, LspConnectionTransportFactory } from './lspConnection'
import { resolveLanguageServerLaneOptions, type LanguageServerResolvedLaneOptions } from './lane'
import {
  allLanguageServerFeatures,
  captureWorkspaceEditOriginGuard,
  LanguageServerSet,
  rankedLanguageServerLanes,
  type LanguageServerSetLane,
} from './serverSet'
import type {
  ActiveDocument,
  DiagnosticMarkerDirection,
  LanguageServerNavigationCommand,
} from './pluginTypes'
import { formattingChangesText, formattingOptions, prepareFormattingEdits } from './formatting'
import type { TextEdit } from '@singapore-editor/core'
import type {
  LanguageServerConnectionContext,
  LanguageServerDefinitionTarget,
  LanguageServerDiagnosticActions,
  LanguageServerDiagnosticMarkerClaim,
  LanguageServerDiagnosticMarkerEvent,
  LanguageServerDiagnosticSummary,
  LanguageServerDocumentSyncOptions,
  LanguageServerNavigationOptions,
  LanguageServerPlugin,
  LanguageServerLaneOptions,
  LanguageServerLaneHostOptions,
  LanguageServerPluginOptions,
  LanguageServerRenamePrompt,
  LanguageServerSetPluginOptions,
  LanguageServerReferencesResult,
  LanguageServerStatus,
  WorkspaceEditOriginGuard,
} from './types'
// Re-exported so `@singapore-editor/lsp-plugin` keeps handing this out from where it always did; it is
// defined in `types.ts` because the narrow factory's options need it and a shared vocabulary module
// that imports the module consuming it is a cycle.
export type { LanguageServerConnectionContext } from './types'

export type { LanguageServerResolvedOptions } from './pluginTypes'

const DEFAULT_PLUGIN_NAME = 'editor.lsp-plugin'
const DEFAULT_NAMESPACE = 'lsp-plugin'
const DEFAULT_TIMING_PREFIX = 'lspPlugin'
const DEFAULT_DIAGNOSTICS_SOURCE_ID = 'editor.lsp-plugin.diagnostics'
const DEFAULT_COMPLETION_ACCEPT_TIMING_NAME = 'lspPlugin.completion.accept'

export type LanguageServerCommandTarget = {
  goToDefinitionFromSelection(): boolean
  runNavigationCommand(command: LanguageServerNavigationCommand): boolean
  moveDiagnosticMarker(direction: DiagnosticMarkerDirection): boolean
  formatDocument(): boolean
  renameSymbol(): boolean
  applyAutoFix(): boolean
  completionCommand(command: CompletionKeyCommand): boolean
  signatureHelpCommand(command: SignatureHelpKeyCommand): boolean
}

export type LanguageServerCommandSpec = {
  readonly id: EditorCommandId
  run(target: LanguageServerCommandTarget): boolean
}

export type LanguageServerAdapterPluginOptions = LanguageServerLaneHostOptions & {
  readonly name: string
  /**
   * Asks the host for a new symbol name. Supply this to use the application's own dialog; without
   * it the editor shows its own small input at the symbol.
   */
  readonly onRequestRenameName?: (prompt: LanguageServerRenamePrompt) => Promise<string | null>
  readonly rootUri?: lsp.DocumentUri | null
  readonly initializationOptions?: unknown
  readonly timeoutMs?: number
  /** See LanguageServerPluginOptions.capabilities. */
  readonly capabilities?: lsp.ClientCapabilities
  /** See LanguageServerPluginOptions.clientInfo. */
  readonly clientInfo?: lsp.InitializeParams['clientInfo']
  /** See LanguageServerPluginOptions.notificationHandlers. Merged, never replacing. */
  readonly notificationHandlers?: Readonly<Record<string, LspNotificationHandler<LspClient>>>
  /** See LanguageServerPluginOptions.serverRequestHandlers. */
  readonly serverRequestHandlers?: Readonly<Record<string, LspServerRequestHandler<LspClient>>>
  createTransport(): ReturnType<LspConnectionTransportFactory>
  /** Borrows the connection instead of constructing one per view. See LspConnectionProvider. */
  readonly connectionProvider?: LspConnectionProvider
  readonly documentSync?: LanguageServerDocumentSyncOptions
  readonly diagnostics?: {
    readonly minimapSourceId?: string
    readonly highlightNameNamespace?: string
    readonly markerTimingNamePrefix?: string
  }
  readonly completion?: {
    readonly editFeature?: EditorCapabilityToken<LanguageServerCompletionEditFeature>
    readonly acceptTimingName?: string
    readonly widgetClassNamespace?: string
    /**
     * Accepts the focused suggestion when one of the characters the item declares as committing it is
     * typed, inserting that character too. Off by default: a server whose sets are wrong turns
     * ordinary typing into unwanted completions, which is worse than no shortcut at all.
     */
    readonly acceptOnCommitCharacter?: boolean
  }
  /**
   * Corrects the caret's row as a block-closing delimiter is typed. On by default: without it every
   * closed block is left a level too deep, and the correction is the language's own indentation
   * rules applied to one row, not a formatter deciding how the file should look.
   */
  readonly formatOnType?: boolean
  readonly hoverDefinition?: {
    readonly linkHighlightNameNamespace?: string
    readonly tooltipClassNamespace?: string
    readonly navigationTimingNamePrefix?: string
  }
  readonly commands?: readonly LanguageServerCommandSpec[]
  /**
   * Turns on the semantic token layer. Supplying nothing here creates no layer and fires no demand
   * signal, so a host that paints no semantic colour pays nothing for the feature existing.
   */
  readonly semanticTokens?: LanguageServerSemanticTokensOptions
  onConnectionCreated?(context: LanguageServerConnectionContext): EditorDisposable | void
  onConnected?(context: LanguageServerConnectionContext): void
  readonly onStatusChange?: (status: LanguageServerStatus) => void
  readonly onDiagnostics?: (summary: LanguageServerDiagnosticSummary) => void
  readonly getDiagnosticActions?: LanguageServerDiagnosticActions
  readonly onDidNavigateDiagnostic?: (
    event: LanguageServerDiagnosticMarkerEvent,
  ) => LanguageServerDiagnosticMarkerClaim
  readonly onInteractiveReady?: () => void
  readonly onRequestError?: (serverId: string, method: string, error: unknown) => void
  readonly onDefinitionLinkHover?: (target: LanguageServerDefinitionTarget) => void
  readonly onOpenDefinition?: (
    target: LanguageServerDefinitionTarget,
    options?: LanguageServerNavigationOptions,
  ) => void | boolean
  readonly onOpenReferences?: (result: LanguageServerReferencesResult) => void | boolean
  readonly onError?: (error: unknown) => void
}

type LanguageServerResolvedAdapterOptions = {
  readonly name: string
  readonly document?: LanguageServerDocument
  readonly onRequestRenameName?: (prompt: LanguageServerRenamePrompt) => Promise<string | null>
  readonly lanes: readonly LanguageServerResolvedLaneOptions[]
  readonly documentSync: LanguageServerDocumentSyncOptions
  readonly diagnostics: {
    readonly minimapSourceId: string
    readonly highlightNameNamespace: string
    readonly markerTimingNamePrefix: string
  }
  readonly completion: {
    readonly editFeature: EditorCapabilityToken<LanguageServerCompletionEditFeature>
    readonly acceptTimingName: string
    readonly widgetClassNamespace?: string
    readonly acceptOnCommitCharacter: boolean
  }
  readonly formatOnType: boolean
  readonly hoverDefinition: {
    readonly linkHighlightNameNamespace: string
    readonly tooltipClassNamespace: string
    readonly navigationTimingNamePrefix: string
  }
  readonly commands: readonly LanguageServerCommandSpec[]
  readonly semanticTokens?: LanguageServerSemanticTokensFactory
  readonly onDiagnostics?: (summary: LanguageServerDiagnosticSummary) => void
  readonly getDiagnosticActions?: LanguageServerDiagnosticActions
  readonly onDidNavigateDiagnostic?: (
    event: LanguageServerDiagnosticMarkerEvent,
  ) => LanguageServerDiagnosticMarkerClaim
  readonly onInteractiveReady?: () => void
  readonly onRequestError?: (serverId: string, method: string, error: unknown) => void
  readonly onApplyWorkspaceEdit?: LanguageServerLaneHostOptions['onApplyWorkspaceEdit']
  readonly onDefinitionLinkHover?: (target: LanguageServerDefinitionTarget) => void
  readonly onOpenDefinition?: (
    target: LanguageServerDefinitionTarget,
    options?: LanguageServerNavigationOptions,
  ) => void | boolean
  readonly onOpenReferences?: (result: LanguageServerReferencesResult) => void | boolean
  readonly onError?: (error: unknown) => void
}

export function createLanguageServerPlugin(
  options: LanguageServerPluginOptions,
): LanguageServerPlugin
export function createLanguageServerPlugin(
  options: LanguageServerDocumentPluginOptions,
): LanguageServerPlugin
export function createLanguageServerPlugin(
  options: LanguageServerPluginOptions | LanguageServerDocumentPluginOptions,
): LanguageServerPlugin {
  if ('document' in options) return createLanguageServerSetPlugin(options)
  return createLanguageServerSetPlugin({
    lanes: [languageServerLaneFromPluginOptions(options)],
    onApplyWorkspaceEdit: options.onApplyWorkspaceEdit,
    documentSync: options.documentSync,
    semanticTokens: options.semanticTokens ? () => options.semanticTokens! : undefined,
    onDiagnostics: options.onDiagnostics,
    onDidNavigateDiagnostic: options.onDidNavigateDiagnostic,
    getDiagnosticActions: options.getDiagnosticActions,
    onDefinitionLinkHover: options.onDefinitionLinkHover,
    onOpenDefinition: options.onOpenDefinition,
    onOpenReferences: options.onOpenReferences,
    onRequestError: options.onRequestError,
    onError: options.onError,
  })
}

export function createLanguageServerSetPlugin(
  options: LanguageServerSetPluginOptions,
): LanguageServerPlugin {
  return createResolvedLanguageServerPlugin(resolveLanguageServerSetOptions(options))
}

export function createLanguageServerAdapterPlugin(
  options: LanguageServerAdapterPluginOptions,
): LanguageServerPlugin {
  return createResolvedLanguageServerPlugin(resolveAdapterOptions(options))
}

function createResolvedLanguageServerPlugin(
  resolved: LanguageServerResolvedAdapterOptions,
): LanguageServerPlugin {
  return {
    name: resolved.name,
    activate(context) {
      // This editor's views only: a command reached this editor's router, so a rename or a list
      // open in another editor sharing the plugin is not what it is about.
      const views = new LanguageServerViews()
      return [
        context.registerViewContribution({
          createContribution: (contributionContext) =>
            new LanguageServerContribution(contributionContext, views, resolved),
        }),
        context.registerCommandContribution({
          createContribution: (contributionContext) =>
            new LanguageServerCommandContribution(contributionContext, views, resolved.commands),
        }),
        context.registerEditContribution({
          createContribution: (contributionContext) =>
            new LanguageServerCompletionEditContribution(contributionContext, resolved.completion),
        }),
      ]
    },
  }
}

/** The views of one editor, answering its commands: the first view that acts claims the key. */
class LanguageServerViews implements LanguageServerCommandTarget {
  private readonly views = new Set<LanguageServerContribution>()

  public register(view: LanguageServerContribution): void {
    this.views.add(view)
  }

  public unregister(view: LanguageServerContribution): void {
    this.views.delete(view)
  }

  public goToDefinitionFromSelection(): boolean {
    return this.runNavigationCommand({ kind: 'definition', openMode: 'default' })
  }

  public runNavigationCommand(command: LanguageServerNavigationCommand): boolean {
    return this.some((view) => view.runNavigationCommand(command))
  }

  public moveDiagnosticMarker(direction: DiagnosticMarkerDirection): boolean {
    return this.some((view) => view.moveDiagnosticMarker(direction))
  }

  public formatDocument(): boolean {
    return this.some((view) => view.formatDocument())
  }

  public renameSymbol(): boolean {
    return this.some((view) => view.renameSymbol())
  }

  public applyAutoFix(): boolean {
    return this.some((view) => view.applyAutoFix())
  }

  public completionCommand(command: CompletionKeyCommand): boolean {
    return this.some((view) => view.completionCommand(command))
  }

  public signatureHelpCommand(command: SignatureHelpKeyCommand): boolean {
    return this.some((view) => view.signatureHelpCommand(command))
  }

  private some(run: (view: LanguageServerContribution) => boolean): boolean {
    for (const view of this.views) {
      if (run(view)) return true
    }
    return false
  }
}

class LanguageServerCommandContribution implements EditorDisposable {
  private readonly commands: readonly EditorDisposable[]

  public constructor(
    context: EditorCommandContributionContext,
    views: LanguageServerViews,
    commands: readonly LanguageServerCommandSpec[],
  ) {
    this.commands = commands.map((command) =>
      context.registerCommand(command.id, () => command.run(views)),
    )
  }

  public dispose(): void {
    for (const command of this.commands) command.dispose()
  }
}

class LanguageServerCompletionEditContribution implements EditorEditContribution {
  private readonly completionFeature: EditorDisposable

  public constructor(
    context: EditorEditContributionContext,
    options: LanguageServerResolvedAdapterOptions['completion'],
  ) {
    this.completionFeature = context.registerFeature(
      options.editFeature,
      createCompletionEditFeature(context, options.acceptTimingName),
    )
  }

  public dispose(): void {
    this.completionFeature.dispose()
  }
}

type ViewLanguageServerLane = LanguageServerSetLane & {
  readonly subscription: EditorDisposable
  readonly sync: DocumentSync
}

type RenameWorkspaceEditDispatch = {
  readonly active: ActiveDocument
  readonly currentName: string
  readonly edit: unknown
  readonly guard: WorkspaceEditOriginGuard
  readonly nextName: string
  readonly owner: LanguageServerSetLane
  readonly signal: AbortSignal
}

class LanguageServerContribution implements EditorViewContribution {
  private readonly document: LanguageServerDocument
  private readonly lanes: readonly ViewLanguageServerLane[]
  private readonly servers: LanguageServerSet
  private readonly diagnostics: CompositeDiagnosticsPresenter
  private readonly completionSources: LanguageServerCompletionSources
  private readonly completion: CompletionController
  private readonly definitionLink: DefinitionLinkController
  private readonly hoverParticipantRegistration: EditorDisposable | null
  /**
   * Loaded on the first `(` or `,` typed, not at boot. The surface it shares with the hover carries
   * a Markdown renderer and its parser, which an editor that never opens an argument list has no
   * reason to download.
   */
  private readonly signatureHelpOptions: SignatureHelpControllerOptions
  private signatureHelp: SignatureHelpController | null = null
  private signatureHelpLoad: Promise<SignatureHelpController> | null = null
  private readonly typedTextRegistration: EditorDisposable | null
  private readonly documentHighlights: DocumentHighlightController
  private readonly codeActions: CodeActionController
  /** Absent rather than idle when switched off, so nothing watches the typing at all. */
  private readonly formatOnType: FormatOnTypeController | null
  /** Absent unless the host asked for semantic colour; see LanguageServerSemanticTokensOptions. */
  private semanticTokens: SemanticTokenLayerOwner | null = null
  private semanticTokensOptions: LanguageServerSemanticTokensOwnerOptions | null = null
  private semanticTokensOwner: ViewLanguageServerLane | null = null
  private rename: RenameWidgetController | null = null
  private renameOperation: AbortController | null = null
  private renameActiveDocument: ActiveDocument | null = null
  /** The symbol an open prompt is renaming, which is what the prompt has to stay beside. */
  private renamePromptRange: OffsetRange | null = null
  private viewDocument: ActiveDocument | null = null
  private disposed = false

  public constructor(
    private readonly context: EditorViewContributionContext,
    private readonly views: LanguageServerViews,
    private readonly options: LanguageServerResolvedAdapterOptions,
  ) {
    const presenter = new DiagnosticsPresenter(context, context.highlightPrefix, {
      ...options.diagnostics,
      onDidNavigateDiagnostic: options.onDidNavigateDiagnostic,
      onError: options.onError,
    })
    this.diagnostics = new CompositeDiagnosticsPresenter(
      presenter,
      rankedLanguageServerLanes(options.lanes, 'diagnostics').map((lane) => lane.id),
      options.onDiagnostics,
    )
    this.document =
      options.document ??
      new LanguageServerDocument(
        {
          getSnapshot: () => context.getSnapshot(),
        },
        { lanes: options.lanes, documentSync: options.documentSync },
      )
    this.lanes = this.document.lanes.map((lane) => this.createLane(lane))
    this.servers = new LanguageServerSet(this.lanes)
    this.completionSources = new LanguageServerCompletionSources(
      context,
      this.servers
        .declared('completion')
        .map((lane) =>
          createLanguageServerCompletionSource(
            lane.connection.client,
            () => this.servers.ready('completion').includes(lane),
            lane.onInteractiveReady,
            lane.onRequestError,
          ),
        ),
    )
    this.completion = new CompletionController({
      context,
      completionSources: this.completionSources,
      completionEditFeature: options.completion.editFeature,
      completionWidgetClassNamespace: options.completion.widgetClassNamespace,
      completionAcceptOnCommitCharacter: options.completion.acceptOnCommitCharacter,
      getActiveDocument: () => this.activeDocument(),
      ignorePointerTarget: isInsideEditorPopup,
      onBeforeShow: () => {
        hoverControllerFor(context.scrollElement)?.hide()
        this.definitionLink.clearPointerUi()
      },
      onRequestSuccess: () => options.onInteractiveReady?.(),
      onRequestError: (error) => this.handleRequestError(error),
    })
    this.definitionLink = new DefinitionLinkController({
      context,
      router: this.servers,
      linkHighlightNameNamespace: options.hoverDefinition.linkHighlightNameNamespace,
      navigationTimingNamePrefix: options.hoverDefinition.navigationTimingNamePrefix,
      getActiveDocument: () => this.activeDocument(),
      onDefinitionLinkHover: options.onDefinitionLinkHover,
      onOpenDefinition: options.onOpenDefinition,
      onOpenReferences: options.onOpenReferences,
      onRequestError: (error) => this.handleRequestError(error),
    })
    // Every document: which server answers is the router's call, not the selector's.
    this.hoverParticipantRegistration =
      context.registerProvider(
        EDITOR_HOVER_PARTICIPANT,
        { language: '*' },
        createLanguageServerHoverParticipant({
          router: this.servers,
          requestHover: (params, requestOptions, onUpdate) =>
            this.servers.requestHover(params, requestOptions, onUpdate),
          getActiveDocument: () => this.activeDocument(),
          getDiagnostics: () => this.diagnostics.diagnostics,
          getDiagnosticActions: options.getDiagnosticActions,
          openLocation: (target) => {
            options.onOpenDefinition?.(target)
          },
          onRequestSuccess: () => options.onInteractiveReady?.(),
          onRequestError: (error) => this.handleRequestError(error),
        }),
      ) ?? null
    this.typedTextRegistration = context.onDidType((text) => this.handleTypedText(text))
    this.signatureHelpOptions = {
      router: this.servers,
      context,
      getActiveDocument: () => this.activeDocument(),
      onRequestError: (error) => this.handleRequestError(error),
      onRequestSuccess: () => options.onInteractiveReady?.(),
      tooltipClassNamespace: options.hoverDefinition.tooltipClassNamespace,
    }
    this.documentHighlights = new DocumentHighlightController({
      router: this.servers,
      context,
      getActiveDocument: () => this.activeDocument(),
      highlightName: `${context.highlightPrefix}-document-highlight`,
      onRequestError: (error) => this.handleRequestError(error),
    })
    this.codeActions = new CodeActionController({
      router: this.servers,
      context,
      getActiveDocument: () => this.activeDocument(),
      getDiagnostics: () => this.diagnostics.diagnostics,
      onRequestError: (error) => this.handleRequestError(error),
    })
    this.formatOnType = options.formatOnType
      ? new FormatOnTypeController({ context, editFeature: options.completion.editFeature })
      : null
    this.views.register(this)
    this.update(context.getSnapshot(), 'document', null)
  }

  public update(
    snapshot: EditorViewSnapshot,
    kind: EditorViewContributionUpdateKind,
    change?: EditorContributionChange | null,
  ): void {
    if (this.disposed) return

    this.updateViewDocument(snapshot, kind)
    this.abortRenameOnDocumentDrift()
    this.definitionLink.update(snapshot, kind)
    if (anchoredSurfaceFollowsUpdate(kind)) this.reanchorRenamePrompt()
    if (!this.options.document) this.document.synchronize(change ?? null, kind)
    this.completion.update(snapshot, kind, change ?? null)
    this.signatureHelp?.update(snapshot, kind)
    this.documentHighlights.update(snapshot, kind)
    this.codeActions.update(kind)
    this.formatOnType?.update(snapshot, kind, change ?? null)
    this.syncSemanticTokens(snapshot, kind)
    if (kind === 'tokens') this.diagnostics.updateTheme(snapshot.theme ?? null)
  }

  public dispose(): void {
    if (this.disposed) return

    this.disposed = true
    this.views.unregister(this)
    this.definitionLink.dispose()
    this.hoverParticipantRegistration?.dispose()
    this.completion.hide()
    for (const lane of this.lanes) lane.subscription.dispose()
    if (!this.options.document) this.document.dispose()
    this.diagnostics.clear()
    this.completionSources.dispose()
    this.completion.dispose()
    this.typedTextRegistration?.dispose()
    // Disposing twice is a no-op, so a load still in flight is safe to settle into.
    void this.signatureHelpLoad?.then((controller) => controller.dispose())
    this.documentHighlights.dispose()
    this.codeActions.dispose()
    this.formatOnType?.dispose()
    this.semanticTokens?.dispose()
    this.semanticTokensOptions?.dispose?.()
    this.semanticTokensOptions = null
    this.semanticTokensOwner = null
    this.cancelRename()
    this.rename?.dispose()
  }

  public goToDefinitionFromSelection(): boolean {
    return this.runNavigationCommand({
      kind: 'definition',
      openMode: 'default',
    })
  }

  public runNavigationCommand(command: LanguageServerNavigationCommand): boolean {
    return this.definitionLink.runNavigationCommand(command)
  }

  public completionCommand(command: CompletionKeyCommand): boolean {
    return this.completion.runKeyCommand(command)
  }

  /** Before the first `(` there is no controller, and so no hint for these to act on. */
  public signatureHelpCommand(command: SignatureHelpKeyCommand): boolean {
    return this.signatureHelp?.runKeyCommand(command) ?? false
  }

  public moveDiagnosticMarker(direction: DiagnosticMarkerDirection): boolean {
    return this.diagnostics.moveMarker(this.activeDocument(), direction)
  }

  /**
   * Formats the whole document through the language server.
   *
   * Reports handled as soon as the request is on its way: the answer arrives asynchronously, and
   * returning false would let the keystroke fall through to another binding.
   */
  public formatDocument(): boolean {
    const active = this.activeDocument()
    if (!active) return false
    if (!this.servers.hasReady('formatting', 'textDocument/formatting')) return false

    void this.requestFormatting(active)
    return true
  }

  /**
   * Renames the symbol under the caret.
   *
   * The new name comes from the host when it supplies `onRequestRenameName`, and otherwise from the
   * editor's own input widget, so the engine is usable standalone without dictating a dialog to an
   * application that has one.
   */
  public renameSymbol(): boolean {
    const active = this.activeDocument()
    if (!active) return false
    if (!this.servers.hasReady('rename', 'textDocument/rename')) return false

    this.cancelRename()
    const abort = new AbortController()
    this.renameOperation = abort
    this.renameActiveDocument = active
    void this.runRename(active, abort).finally(() => this.finishRename(abort))
    return true
  }

  /** Applies the preferred quick fix the oracle already found for the caret. */
  public applyAutoFix(): boolean {
    return this.codeActions.applyAutoFix()
  }

  private createLane(documentLane: DocumentLanguageServerLane): ViewLanguageServerLane {
    const options = documentLane.options
    const diagnostics = this.diagnostics.forLane(options.id)
    const subscription = documentLane.attach(
      {
        clear: () => diagnostics.clear(),
        render: (document, items) => diagnostics.render(document, items),
        publishSummary: (uri, version, items, freshness) => {
          diagnostics.publishSummary(uri, version, items, freshness)
          this.codeActions?.diagnosticsChanged()
        },
      },
      () => {
        if (this.disposed) return
        this.completion?.hide()
        this.syncSemanticTokens(this.context.getSnapshot(), 'document')
      },
    )
    return {
      connection: documentLane.connection,
      subscription,
      features: options.features,
      id: options.id,
      onApplyWorkspaceEdit: this.options.onApplyWorkspaceEdit ?? options.onApplyWorkspaceEdit,
      onRequestError: (method, error) => {
        if (options.onRequestError) options.onRequestError(method, error)
        else this.options.onRequestError?.(options.id, method, error)
      },
      onInteractiveReady: () => {
        if (options.onInteractiveReady) options.onInteractiveReady()
        else this.options.onInteractiveReady?.()
      },
      sync: documentLane.sync,
    }
  }

  /**
   * Nothing is on screen before the controller exists, so `)` closes a signature that was never
   * shown and loads nothing. An opening `(` or a `,` is the first keystroke that needs it.
   */
  private handleTypedText(text: string): void {
    if (this.signatureHelp) {
      this.signatureHelp.handleTypedText(text)
      return
    }

    const trigger = signatureHelpTriggerFromTypedText(text)
    if (!trigger || trigger.kind === 'close') return

    void this.loadSignatureHelp().then((controller) => controller.handleTypedText(text))
  }

  private loadSignatureHelp(): Promise<SignatureHelpController> {
    this.signatureHelpLoad ??= import('./signatureHelpController').then((module) => {
      const controller = new module.SignatureHelpController(this.signatureHelpOptions)
      this.signatureHelp = controller
      if (this.disposed) controller.dispose()
      return controller
    })
    return this.signatureHelpLoad
  }

  private syncSemanticTokens(
    snapshot: EditorViewSnapshot,
    kind: EditorViewContributionUpdateKind,
  ): void {
    const selected = this.options.semanticTokens
      ? (this.servers.ready('semanticTokens')[0] ?? null)
      : null
    const owner = this.lanes.find((lane) => lane === selected) ?? null
    if (owner !== this.semanticTokensOwner) this.replaceSemanticTokensOwner(owner)

    this.semanticTokens?.update(snapshot, kind)
  }

  private replaceSemanticTokensOwner(owner: ViewLanguageServerLane | null): void {
    this.semanticTokens?.dispose()
    this.semanticTokens = null
    this.semanticTokensOptions?.dispose?.()
    this.semanticTokensOptions = null
    this.semanticTokensOwner = owner
    if (!owner || !this.options.semanticTokens) return

    const options = this.options.semanticTokens({
      id: owner.id,
      connection: {
        client: owner.connection.client,
        workspace: owner.connection.workspace,
      },
    })
    this.semanticTokensOptions = options
    this.semanticTokens = new SemanticTokenLayerOwner(this.context, options)
  }

  private activeDocument(): ActiveDocument | null {
    return this.viewDocument
  }

  private updateViewDocument(
    snapshot: EditorViewSnapshot,
    kind: EditorViewContributionUpdateKind,
  ): void {
    if (kind === 'clear') {
      this.viewDocument = null
      return
    }
    if (this.viewDocument?.textVersion === snapshot.textVersion && kind !== 'document') return

    this.viewDocument = activeDocumentForSnapshot(snapshot, this.options.documentSync)
  }

  private async runRename(active: ActiveDocument, abort: AbortController): Promise<void> {
    const selection = this.context.getSnapshot().selections[0]
    if (!selection) return

    const offset = selection.headOffset
    const owner = this.servers.ready('rename', 'textDocument/rename')[0]
    if (!owner) return

    const prepared = await this.prepareRename(active, offset, owner, abort.signal)
    if (!prepared) return
    if (!this.renameIsCurrent(active, abort)) return

    const { range, currentName } = prepared

    const anchor = this.context.getRangeClientRect(range.start, range.end)
    if (!anchor) return

    try {
      this.renamePromptRange = range
      let nextName: string | null
      try {
        nextName = await this.promptRenameName({ anchor, currentName, signal: abort.signal })
      } finally {
        this.renamePromptRange = null
      }
      if (nextName === null || nextName === currentName) return
      if (!this.renameIsCurrent(active, abort)) return

      const guard = captureWorkspaceEditOriginGuard(owner.connection.workspace)
      const edit = await this.servers.requestSingle(
        owner,
        'textDocument/rename',
        {
          newName: nextName,
          position: offsetToLspPositionInSnapshot(active, offset),
          textDocument: { uri: active.uri },
        },
        { signal: abort.signal },
        null as unknown,
      )
      if (edit === null) return
      if (!this.renameIsCurrent(active, abort)) return

      await this.dispatchRenameEdit({
        active,
        currentName,
        edit,
        guard,
        nextName,
        owner,
        signal: abort.signal,
      })
    } catch (error) {
      this.handleRequestError(error)
    }
  }

  private async prepareRename(
    active: ActiveDocument,
    offset: number,
    owner: LanguageServerSetLane,
    signal: AbortSignal,
  ): Promise<{ readonly range: OffsetRange; readonly currentName: string } | null> {
    const fallback = rangeAroundOffset(active, offset, wordRangeAtOffset)
    const provider = owner.connection.client.serverCapabilities?.renameProvider
    const supportsPrepare = typeof provider === 'object' && provider.prepareProvider === true
    if (!supportsPrepare) return renameTarget(active, fallback)

    const result = await this.servers.requestSingle<
      lsp.TextDocumentPositionParams,
      lsp.PrepareRenameResult | null
    >(
      owner,
      'textDocument/prepareRename',
      {
        position: offsetToLspPositionInSnapshot(active, offset),
        textDocument: { uri: active.uri },
      },
      { signal },
      null,
    )
    if (!result) return null
    if ('defaultBehavior' in result) return renameTarget(active, fallback)

    const protocolRange = 'range' in result ? result.range : result
    const range = {
      start: lspPositionToOffsetInSnapshot(active, protocolRange.start),
      end: lspPositionToOffsetInSnapshot(active, protocolRange.end),
    }
    const target = renameTarget(active, range)
    if (!target || !('placeholder' in result)) return target

    return { ...target, currentName: result.placeholder }
  }

  /**
   * Keeps an open prompt beside the symbol while the view moves under it.
   *
   * A host that supplies its own dialog places it wherever it likes, so there is nothing here to
   * move; a symbol that has scrolled out of the rendered rows has no rect, and the prompt is left
   * where it was rather than thrown at the top of the page.
   */
  private reanchorRenamePrompt(): void {
    const range = this.renamePromptRange
    if (!range) return

    const anchor = this.context.getRangeClientRect(range.start, range.end)
    if (anchor) this.rename?.reanchor(anchor)
  }

  private promptRenameName(prompt: LanguageServerRenamePrompt): Promise<string | null> {
    if (prompt.signal.aborted) return Promise.resolve(null)

    const host = this.options.onRequestRenameName
    if (host) return host(prompt)

    return this.renameWidget().prompt(prompt)
  }

  /** Built on first use, so a host that supplies its own prompt never creates the element. */
  private renameWidget(): RenameWidgetController {
    if (this.rename) return this.rename

    this.rename = createRenameWidgetController({
      classNamespace: this.options.hoverDefinition.tooltipClassNamespace ?? 'lsp-plugin',
      document: this.context.container.ownerDocument,
      themeSource: this.context.scrollElement,
      returnFocus: () => this.context.focusEditor(),
    })
    return this.rename
  }

  private async dispatchRenameEdit(request: RenameWorkspaceEditDispatch): Promise<void> {
    const parsed = parseWorkspaceEdit(request.edit)
    if (!parsed.ok) {
      this.reportLaneRequestError(
        request.owner,
        'textDocument/rename',
        new Error(parsed.error.reason),
      )
      return
    }
    const origin = currentWorkspaceEditOrigin(request.guard, request.active, parsed.value)
    if (!origin) return
    if (request.signal.aborted) return

    const apply = request.owner.onApplyWorkspaceEdit
    if (!apply) {
      this.reportLaneRequestError(
        request.owner,
        'textDocument/rename',
        new Error('Rename cannot be applied without a workspace edit host.'),
      )
      return
    }

    const result = await apply({
      guard: request.guard,
      label: `Rename ${request.currentName} to ${request.nextName}`,
      logicalRevisionScope: request.owner.connection.logicalRevisionScope,
      originUri: request.active.uri,
      originVersion: origin.version,
      plan: parsed.value,
      serverId: request.owner.id,
      signal: request.signal,
      source: 'rename',
    })
    if (result.status !== 'failed') return
    this.reportLaneRequestError(
      request.owner,
      'textDocument/rename',
      new Error(`${result.code}: ${result.message}`),
    )
  }

  private renameIsCurrent(active: ActiveDocument, abort: AbortController): boolean {
    if (this.disposed) return false
    if (abort.signal.aborted) return false
    if (this.renameOperation !== abort) return false
    return active === this.activeDocument()
  }

  private abortRenameOnDocumentDrift(): void {
    if (!this.renameOperation) return
    if (this.renameActiveDocument === this.activeDocument()) return
    this.cancelRename()
  }

  private cancelRename(): void {
    const abort = this.renameOperation
    this.renameOperation = null
    this.renameActiveDocument = null
    this.renamePromptRange = null
    abort?.abort()
  }

  private finishRename(abort: AbortController): void {
    if (this.renameOperation !== abort) return
    this.renameOperation = null
    this.renameActiveDocument = null
  }

  private reportLaneRequestError(
    owner: LanguageServerSetLane,
    method: string,
    error: unknown,
  ): void {
    if (owner.onRequestError) {
      owner.onRequestError(method, error)
      return
    }
    this.handleRequestError(error)
  }

  private async requestFormatting(active: ActiveDocument): Promise<void> {
    try {
      const edits = await this.servers.request<lsp.TextEdit[] | null>('textDocument/formatting', {
        // The view snapshot carries the editor's own tab size, so the formatter is told the same
        // width the document is displayed with.
        options: formattingOptions(this.context.getSnapshot().tabSize),
        textDocument: { uri: active.uri },
      })
      // The document can change while the formatter runs; its edits describe the text it was given.
      if (active !== this.activeDocument()) return

      const converted = prepareFormattingEdits(active, edits)
      if (converted.length === 0) return
      if (!formattingChangesText(active.textSnapshot, converted)) return

      this.applyFormattingEdits(converted, active.textSnapshot.length)
    } catch (error) {
      this.handleRequestError(error)
    }
  }

  /**
   * Applies formatting through the same edit feature completions use, so a format is one
   * transaction and one undo step.
   *
   * The caret is pinned to its offset rather than tracked through the edits: formatting moves text
   * wholesale, and an offset that survives is closer to where the user was looking than a position
   * mapped through a rewrite of the whole file.
   */
  private applyFormattingEdits(edits: readonly TextEdit[], previousLength: number): void {
    const feature = this.context.getFeature(this.options.completion.editFeature)
    if (!feature) return

    const length = edits.reduce(
      (size, edit) => size + edit.text.length - (edit.to - edit.from),
      previousLength,
    )
    const head = Math.min(this.context.getSnapshot().selections[0]?.headOffset ?? 0, length)
    feature.applyCompletion({ edits, selection: { anchor: head, head } })
  }

  private handleRequestError(error: unknown): void {
    if (isAbortError(error)) return
    this.options.onError?.(error)
  }
}

function renameTarget(
  document: LspTextDocumentSnapshot,
  range: OffsetRange,
): { readonly range: OffsetRange; readonly currentName: string } | null {
  if (range.end <= range.start) return null
  const currentName = document.textSnapshot.readRange(range.start, range.end)
  if (currentName.length === 0) return null
  return { currentName, range }
}

function resolveAdapterOptions(
  options: LanguageServerAdapterPluginOptions,
): LanguageServerResolvedAdapterOptions {
  return {
    name: options.name,
    lanes: [resolvedLaneFromAdapterOptions(options)],
    documentSync: options.documentSync ?? {},
    diagnostics: resolveDiagnosticsOptions(options),
    completion: resolveCompletionOptions(options),
    formatOnType: options.formatOnType ?? true,
    hoverDefinition: resolveHoverDefinitionOptions(options),
    commands: options.commands ?? LANGUAGE_SERVER_COMMANDS,
    semanticTokens: options.semanticTokens ? () => options.semanticTokens! : undefined,
    onDiagnostics: options.onDiagnostics,
    onDidNavigateDiagnostic: options.onDidNavigateDiagnostic,
    getDiagnosticActions: options.getDiagnosticActions,
    onDefinitionLinkHover: options.onDefinitionLinkHover,
    onOpenDefinition: options.onOpenDefinition,
    onOpenReferences: options.onOpenReferences,
    onRequestRenameName: options.onRequestRenameName,
    onApplyWorkspaceEdit: options.onApplyWorkspaceEdit,
    onRequestError: options.onRequestError,
    onError: options.onError,
  }
}

function resolveLanguageServerSetOptions(
  options: LanguageServerSetPluginOptions,
): LanguageServerResolvedAdapterOptions {
  return {
    name: DEFAULT_PLUGIN_NAME,
    document: options.document,
    lanes: options.document
      ? options.document.lanes.map((lane) => lane.options)
      : options.lanes.map((lane) =>
          resolveLanguageServerLaneOptions({
            ...lane,
            onApplyWorkspaceEdit: options.onApplyWorkspaceEdit ?? lane.onApplyWorkspaceEdit,
            onRequestError:
              lane.onRequestError ??
              ((method, error) => options.onRequestError?.(lane.id, method, error)),
          }),
        ),
    documentSync: options.document?.syncOptions ?? options.documentSync ?? {},
    diagnostics: resolveDiagnosticsOptions(),
    completion: resolveCompletionOptions(),
    formatOnType: true,
    hoverDefinition: resolveHoverDefinitionOptions(),
    commands: LANGUAGE_SERVER_COMMANDS,
    semanticTokens: options.semanticTokens,
    onDiagnostics: options.onDiagnostics,
    onDidNavigateDiagnostic: options.onDidNavigateDiagnostic,
    getDiagnosticActions: options.getDiagnosticActions,
    onInteractiveReady: options.onInteractiveReady,
    onDefinitionLinkHover: options.onDefinitionLinkHover,
    onOpenDefinition: options.onOpenDefinition,
    onOpenReferences: options.onOpenReferences,
    onApplyWorkspaceEdit: options.onApplyWorkspaceEdit,
    onRequestError: options.onRequestError,
    onError: options.onError,
  }
}

function languageServerLaneFromPluginOptions(
  options: LanguageServerPluginOptions,
): LanguageServerLaneOptions {
  return {
    id: DEFAULT_PLUGIN_NAME,
    features: allLanguageServerFeatures(),
    rootUri: options.rootUri,
    initializationOptions: options.initializationOptions,
    timeoutMs: options.timeoutMs,
    capabilities: options.capabilities,
    clientInfo: options.clientInfo,
    notificationHandlers: options.notificationHandlers,
    serverRequestHandlers: options.serverRequestHandlers,
    webSocketRoute: options.webSocketRoute,
    webSocketTransportOptions: options.webSocketTransportOptions,
    connectionProvider: options.connectionProvider,
    onApplyWorkspaceEdit: options.onApplyWorkspaceEdit,
    onConnectionCreated: options.onConnectionCreated,
    onConnected: options.onConnected,
    onStatusChange: options.onStatusChange,
    onInteractiveReady: options.onInteractiveReady,
    onError: options.onError,
  }
}

function resolvedLaneFromAdapterOptions(
  options: LanguageServerAdapterPluginOptions,
): LanguageServerResolvedLaneOptions {
  return {
    id: options.name,
    features: allLanguageServerFeatures(),
    rootUri: options.rootUri,
    initializationOptions: options.initializationOptions,
    timeoutMs: options.timeoutMs,
    capabilities: options.capabilities,
    clientInfo: options.clientInfo,
    notificationHandlers: options.notificationHandlers,
    serverRequestHandlers: options.serverRequestHandlers,
    createTransport: options.createTransport,
    connectionProvider: options.connectionProvider,
    onApplyWorkspaceEdit: options.onApplyWorkspaceEdit,
    onConnectionCreated: options.onConnectionCreated,
    onConnected: options.onConnected,
    onStatusChange: options.onStatusChange,
    onInteractiveReady: options.onInteractiveReady,
    onRequestError: (method, error) => options.onRequestError?.(options.name, method, error),
    onError: options.onError,
  }
}

function resolveDiagnosticsOptions(
  options?: LanguageServerAdapterPluginOptions,
): LanguageServerResolvedAdapterOptions['diagnostics'] {
  return {
    minimapSourceId: options?.diagnostics?.minimapSourceId ?? DEFAULT_DIAGNOSTICS_SOURCE_ID,
    highlightNameNamespace: options?.diagnostics?.highlightNameNamespace ?? DEFAULT_NAMESPACE,
    markerTimingNamePrefix:
      options?.diagnostics?.markerTimingNamePrefix ?? `${DEFAULT_TIMING_PREFIX}.marker`,
  }
}

function resolveCompletionOptions(
  options?: LanguageServerAdapterPluginOptions,
): LanguageServerResolvedAdapterOptions['completion'] {
  return {
    editFeature: options?.completion?.editFeature ?? LANGUAGE_SERVER_COMPLETION_EDIT_FEATURE,
    acceptTimingName:
      options?.completion?.acceptTimingName ?? DEFAULT_COMPLETION_ACCEPT_TIMING_NAME,
    widgetClassNamespace: options?.completion?.widgetClassNamespace,
    acceptOnCommitCharacter: options?.completion?.acceptOnCommitCharacter ?? false,
  }
}

function resolveHoverDefinitionOptions(
  options?: LanguageServerAdapterPluginOptions,
): LanguageServerResolvedAdapterOptions['hoverDefinition'] {
  return {
    linkHighlightNameNamespace:
      options?.hoverDefinition?.linkHighlightNameNamespace ?? DEFAULT_NAMESPACE,
    tooltipClassNamespace: options?.hoverDefinition?.tooltipClassNamespace ?? DEFAULT_NAMESPACE,
    navigationTimingNamePrefix:
      options?.hoverDefinition?.navigationTimingNamePrefix ?? DEFAULT_TIMING_PREFIX,
  }
}

const LANGUAGE_SERVER_COMMANDS: readonly LanguageServerCommandSpec[] = [
  {
    id: 'goToDefinition',
    run: (state) => state.goToDefinitionFromSelection(),
  },
  {
    id: 'editor.action.goToDefinition',
    run: (state) => state.goToDefinitionFromSelection(),
  },
  {
    id: 'editor.action.peekDefinition',
    run: (state) => state.runNavigationCommand({ kind: 'definition', openMode: 'peek' }),
  },
  {
    id: 'editor.action.revealDefinitionAside',
    run: (state) => state.runNavigationCommand({ kind: 'definition', openMode: 'aside' }),
  },
  {
    id: 'editor.action.goToImplementation',
    run: (state) =>
      state.runNavigationCommand({
        kind: 'implementation',
        openMode: 'default',
      }),
  },
  {
    id: 'editor.action.goToTypeDefinition',
    run: (state) =>
      state.runNavigationCommand({
        kind: 'typeDefinition',
        openMode: 'default',
      }),
  },
  {
    id: 'editor.action.goToReferences',
    run: (state) =>
      state.runNavigationCommand({
        kind: 'references',
        openMode: 'peek',
        includeDeclaration: true,
      }),
  },
  {
    id: 'editor.action.rename',
    run: (state) => state.renameSymbol(),
  },
  {
    id: 'editor.action.formatDocument',
    run: (state) => state.formatDocument(),
  },
  {
    id: 'editor.action.autoFix',
    run: (state) => state.applyAutoFix(),
  },
  {
    id: 'editor.action.marker.next',
    run: (state) => state.moveDiagnosticMarker('next'),
  },
  {
    id: 'editor.action.marker.prev',
    run: (state) => state.moveDiagnosticMarker('previous'),
  },
  ...keyCommandSpecs(COMPLETION_KEY_COMMANDS, (target, command) =>
    target.completionCommand(command),
  ),
  ...keyCommandSpecs(SIGNATURE_HELP_KEY_COMMANDS, (target, command) =>
    target.signatureHelpCommand(command),
  ),
]

/** The completion list and signature hint, driven by the keymap rather than by raw keys. */
function keyCommandSpecs<Command extends string>(
  ids: Readonly<Record<Command, EditorCommandId>>,
  run: (target: LanguageServerCommandTarget, command: Command) => boolean,
): readonly LanguageServerCommandSpec[] {
  const commands = Object.keys(ids) as Command[]
  return commands.map((command) => ({ id: ids[command], run: (target) => run(target, command) }))
}

function isAbortError(error: unknown): boolean {
  if (error instanceof DOMException && error.name === 'AbortError') return true
  if (!isRecord(error)) return false
  return error.name === 'LspRequestCancelledError'
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
