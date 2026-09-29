import type {
  EditorDisposable,
  EditorViewContributionContext,
  EditorViewContributionUpdateKind,
  EditorViewSnapshot,
} from '@singapore-editor/core/extensions'
import { anchoredSurfaceFollowsUpdate } from '@singapore-editor/plugin-ui/anchored-surface'
import { type OffsetRange, hoverTargetRange } from '@singapore-editor/plugin-ui/offset-range'

import {
  navigateToTarget,
  preferredDefinitionTarget,
  preferredJumpableDefinitionTarget,
  preferredReferenceTarget,
  requestDefinition,
  requestNavigationTargets,
  type DefinitionResult,
} from './definitionNavigation'
import { LINK_HIGHLIGHT_STYLE } from './plugin.styles'
import { rangeAroundOffset } from './sourceText'
import type { ActiveDocument, LanguageServerNavigationCommand } from './pluginTypes'
import type { LanguageServerFeatureRouter } from './serverSet'
import type {
  LanguageServerDefinitionTarget,
  LanguageServerNavigationKind,
  LanguageServerNavigationOptions,
  LanguageServerReferencesResult,
} from './types'

export type DefinitionLinkControllerOptions = {
  readonly context: EditorViewContributionContext
  readonly router: LanguageServerFeatureRouter
  readonly linkHighlightNameNamespace?: string
  readonly navigationTimingNamePrefix?: string
  getActiveDocument(): ActiveDocument | null
  onDefinitionLinkHover?(target: LanguageServerDefinitionTarget): void
  onOpenDefinition?(
    target: LanguageServerDefinitionTarget,
    options?: LanguageServerNavigationOptions,
  ): void | boolean
  onOpenReferences?(result: LanguageServerReferencesResult): void | boolean
  onRequestError(error: unknown): void
}

/**
 * Go-to-definition: the modifier-held link under the pointer, the modified click that follows it,
 * and the navigation commands. Hover content is a participant in the shared hover instead; see
 * hoverParticipant.ts.
 */
export class DefinitionLinkController {
  private readonly context: EditorViewContributionContext
  private readonly router: LanguageServerFeatureRouter
  private readonly linkHighlightName: string
  private definitionRequestId = 0
  private definitionHoverRequestId = 0
  private lastPointerOffset: number | null = null
  private linkRange: OffsetRange | null = null
  private disposed = false
  private pressParticipant: EditorDisposable | null = null

  public constructor(private readonly options: DefinitionLinkControllerOptions) {
    this.context = options.context
    this.router = options.router
    this.linkHighlightName = definitionLinkHighlightName(this.context, options)
    this.installHandlers()
  }

  public update(_snapshot: EditorViewSnapshot, kind: EditorViewContributionUpdateKind): void {
    if (shouldClearLink(kind)) this.clearDefinitionLink()
  }

  public runNavigationCommand(command: LanguageServerNavigationCommand): boolean {
    const selection = this.context.getSnapshot().selections[0]
    if (!selection) return false
    return this.requestNavigationAtOffset(selection.headOffset, command)
  }

  public clearPointerUi(): void {
    this.clearDefinitionLink()
  }

  public dispose(): void {
    if (this.disposed) return

    this.disposed = true
    this.uninstallHandlers()
    this.clearDefinitionLink()
  }

  private installHandlers(): void {
    this.context.scrollElement.addEventListener('pointermove', this.handlePointerMove)
    this.context.scrollElement.addEventListener('pointerleave', this.handlePointerLeave)
    this.pressParticipant = this.context.registerPressParticipant(this.claimNavigationPress)
    this.context.container.ownerDocument.addEventListener('keydown', this.handleKeyDown)
    this.context.container.ownerDocument.addEventListener('keyup', this.handleKeyUp)
  }

  private uninstallHandlers(): void {
    this.context.scrollElement.removeEventListener('pointermove', this.handlePointerMove)
    this.context.scrollElement.removeEventListener('pointerleave', this.handlePointerLeave)
    this.pressParticipant?.dispose()
    this.pressParticipant = null
    this.context.container.ownerDocument.removeEventListener('keydown', this.handleKeyDown)
    this.context.container.ownerDocument.removeEventListener('keyup', this.handleKeyUp)
  }

  private readonly handlePointerMove = (event: PointerEvent): void => {
    if (event.buttons !== 0) return this.clearDefinitionLink()
    if (!this.options.getActiveDocument()) return this.clearDefinitionLink()

    const offset = this.context.textOffsetFromPoint(event.clientX, event.clientY)
    if (offset === null) return this.clearDefinitionLink()

    this.lastPointerOffset = offset
    if (!isNavigationModifier(event)) return this.clearDefinitionLink()

    this.requestDefinitionLink(offset)
  }

  private readonly handlePointerLeave = (): void => {
    this.lastPointerOffset = null
    this.clearDefinitionLink()
  }

  private readonly claimNavigationPress = (event: MouseEvent): boolean => {
    if (event.button !== 0) return false
    if (!isNavigationModifier(event)) return false

    const offset = this.context.textOffsetFromPoint(event.clientX, event.clientY)
    if (offset === null) return false

    this.context.focusEditor()
    this.requestNavigationAtOffset(offset, { kind: 'definition', openMode: 'default' })
    return true
  }

  private readonly handleKeyDown = (event: KeyboardEvent): void => {
    if (!isNavigationModifier(event)) return
    if (this.lastPointerOffset === null) return

    this.requestDefinitionLink(this.lastPointerOffset)
  }

  private readonly handleKeyUp = (event: KeyboardEvent): void => {
    if (event.key !== 'Meta' && event.key !== 'Control') return

    this.clearDefinitionLink()
  }

  private requestNavigationAtOffset(
    offset: number,
    command: LanguageServerNavigationCommand,
  ): boolean {
    const active = this.options.getActiveDocument()
    if (!active) return false
    if (!this.router.hasReady('navigation', navigationMethod(command.kind))) return false

    this.clearDefinitionLink()
    const requestId = this.definitionRequestId + 1
    this.definitionRequestId = requestId
    void requestNavigationTargets(this.router, {
      uri: active.uri,
      document: active,
      offset,
      kind: command.kind,
      includeDeclaration: command.includeDeclaration,
    })
      .then((result) => this.handleNavigationResult(requestId, active, offset, command, result))
      .catch((error: unknown) => this.options.onRequestError(error))
    return true
  }

  private requestDefinitionLink(offset: number): void {
    const active = this.options.getActiveDocument()
    if (!active) return this.clearDefinitionLink()
    if (!this.router.hasReady('navigation', 'textDocument/definition')) {
      return this.clearDefinitionLink()
    }

    if (this.linkRange && offset >= this.linkRange.start && offset < this.linkRange.end) return
    this.clearDefinitionLink()
    const range = rangeAroundOffset(active, offset, hoverTargetRange)

    const requestId = this.definitionHoverRequestId + 1
    this.definitionHoverRequestId = requestId
    void requestDefinition(this.router, {
      uri: active.uri,
      document: active,
      offset,
    })
      .then((result) => this.renderDefinitionLink(requestId, active, range, result))
      .catch((error: unknown) => this.options.onRequestError(error))
  }

  private renderDefinitionLink(
    requestId: number,
    active: ActiveDocument,
    range: OffsetRange,
    result: DefinitionResult,
  ): void {
    if (requestId !== this.definitionHoverRequestId) return
    if (active !== this.options.getActiveDocument()) return
    const sourceRange = result.sourceRange ?? range
    const target = preferredJumpableDefinitionTarget(active.uri, active, sourceRange, result)
    if (!target) return this.clearDefinitionLink()

    this.linkRange = sourceRange
    this.context.setRangeHighlight(this.linkHighlightName, [sourceRange], LINK_HIGHLIGHT_STYLE)
    this.context.scrollElement.style.cursor = 'pointer'
    this.options.onDefinitionLinkHover?.(target)
  }

  private handleNavigationResult(
    requestId: number,
    active: ActiveDocument,
    offset: number,
    command: LanguageServerNavigationCommand,
    result: DefinitionResult,
  ): void {
    if (requestId !== this.definitionRequestId) return
    if (active !== this.options.getActiveDocument()) return

    if (command.kind === 'references') {
      this.handleReferencesResult(active, offset, result)
      return
    }

    const target = preferredDefinitionTarget(active.uri, result)
    if (!target) return
    this.openNavigationTarget(active, target, command)
  }

  private handleReferencesResult(
    active: ActiveDocument,
    offset: number,
    result: DefinitionResult,
  ): void {
    const handled = this.options.onOpenReferences?.({
      uri: active.uri,
      targets: result.targets,
    })
    if (handled) return

    const target = preferredReferenceTarget(active.uri, active, offset, result)
    if (!target) return
    this.openNavigationTarget(active, target, {
      kind: 'references',
      openMode: 'peek',
    })
  }

  private openNavigationTarget(
    active: ActiveDocument,
    target: LanguageServerDefinitionTarget,
    command: LanguageServerNavigationCommand,
  ): void {
    const shouldOfferExternalOpen = target.uri !== active.uri || command.openMode !== 'default'
    const handled = shouldOfferExternalOpen ? this.openDefinitionTarget(target, command) : false
    if (handled) return
    if (target.uri !== active.uri) return

    navigateToTarget(
      target,
      {
        document: active,
        setSelection: this.context.setSelection.bind(this.context),
        focusEditor: this.context.focusEditor.bind(this.context),
      },
      this.navigationTimingName(command.kind),
    )
  }

  private navigationTimingName(kind: LanguageServerNavigationKind): string {
    const prefix = this.options.navigationTimingNamePrefix ?? 'lspPlugin'
    if (kind === 'typeDefinition') return `${prefix}.goToTypeDefinition`
    return `${prefix}.goTo${capitalize(kind)}`
  }

  private openDefinitionTarget(
    target: LanguageServerDefinitionTarget,
    command: LanguageServerNavigationCommand,
  ): void | boolean {
    const options = defaultDefinitionOptions(command)
    if (!options) return this.options.onOpenDefinition?.(target)
    return this.options.onOpenDefinition?.(target, options)
  }

  private clearDefinitionLink(): void {
    this.definitionHoverRequestId += 1
    this.linkRange = null
    this.context.clearRangeHighlight(this.linkHighlightName)
    this.context.scrollElement.style.cursor = ''
  }
}

function navigationMethod(kind: LanguageServerNavigationKind): string {
  if (kind === 'references') return 'textDocument/references'
  if (kind === 'implementation') return 'textDocument/implementation'
  if (kind === 'typeDefinition') return 'textDocument/typeDefinition'
  return 'textDocument/definition'
}

function defaultDefinitionOptions(
  command: LanguageServerNavigationCommand,
): LanguageServerNavigationOptions | null {
  if (command.kind === 'definition' && command.openMode === 'default') return null

  return {
    kind: command.kind,
    openMode: command.openMode,
  }
}

/**
 * A link is keyed to the pointer: once the text has slid out from under a pointer that never
 * moved, the underline points at the wrong word, so it goes with the old frame.
 */
function shouldClearLink(kind: EditorViewContributionUpdateKind): boolean {
  if (anchoredSurfaceFollowsUpdate(kind)) return true
  return kind === 'content' || kind === 'document' || kind === 'clear'
}

function isNavigationModifier(event: {
  readonly metaKey: boolean
  readonly ctrlKey: boolean
}): boolean {
  return event.metaKey || event.ctrlKey
}

function capitalize(value: string): string {
  return `${value.slice(0, 1).toUpperCase()}${value.slice(1)}`
}

function definitionLinkHighlightName(
  context: EditorViewContributionContext,
  options: DefinitionLinkControllerOptions,
): string {
  const namespace = options.linkHighlightNameNamespace ?? 'lsp-plugin'
  return `${context.highlightPrefix}-${namespace}-definition-link`
}
