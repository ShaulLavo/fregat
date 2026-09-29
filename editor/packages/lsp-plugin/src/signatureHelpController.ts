import type * as lsp from 'vscode-languageserver-protocol'

import type {
  EditorDisposable,
  EditorTheme,
  EditorViewContributionContext,
  EditorViewContributionUpdateKind,
  EditorViewSnapshot,
} from '@singapore-editor/core'
import { offsetToLspPositionInSnapshot } from '@singapore-editor/lsp'

import type { ActiveDocument } from './pluginTypes'
import type { SignatureHelpKeyCommand } from './keyCommands'
import type { LanguageServerFeatureRouter } from './serverSet'
import {
  formatSignatureHelp,
  nextSignatureIndex,
  signatureHelpTriggerFromTypedText,
  type SignatureHelpDisplay,
} from './signatureHelp'
import { anchoredSurfaceFollowsUpdate } from '@singapore-editor/plugin-ui/anchored-surface'
import {
  type TooltipController,
  createTooltipController,
} from '@singapore-editor/plugin-ui/tooltip'

export type SignatureHelpControllerOptions = {
  readonly context: EditorViewContributionContext
  readonly router: LanguageServerFeatureRouter
  readonly getActiveDocument: () => ActiveDocument | null
  readonly tooltipClassNamespace?: string
  readonly onRequestSuccess?: () => void
  readonly onRequestError: (error: unknown) => void
}

/**
 * Shows the signature of the call the caret is inside, requested when an argument list opens or the
 * caret moves to the next argument.
 *
 * Reuses the hover tooltip rather than introducing a second floating surface, so signature text
 * inherits the same theming, markdown rendering, and placement behaviour.
 */
export class SignatureHelpController {
  private readonly context: EditorViewContributionContext
  private readonly tooltip: TooltipController
  private abort: AbortController | null = null
  private requestId = 0
  private currentTheme: EditorTheme | null = null
  private lastHelp: lsp.SignatureHelp | null = null
  private display: SignatureHelpDisplay | null = null
  private disposed = false
  private readonly keymapKeys: readonly EditorDisposable[]

  public constructor(private readonly options: SignatureHelpControllerOptions) {
    this.context = options.context
    this.tooltip = createTooltipController({
      classNamespace: options.tooltipClassNamespace ?? 'lsp-plugin',
      document: this.context.container.ownerDocument,
      reentryElement: this.context.scrollElement,
      themeSource: this.context.scrollElement,
    })
    this.keymapKeys = [
      this.context.registerKeymapContextKey('parameterHintsVisible', () => this.display !== null),
      this.context.registerKeymapContextKey(
        'parameterHintsMultipleSignatures',
        () => (this.display?.signatureCount ?? 0) > 1,
      ),
    ]
  }

  public update(snapshot: EditorViewSnapshot, kind: EditorViewContributionUpdateKind): void {
    this.currentTheme = snapshot.theme ?? null
    if (kind === 'document' || kind === 'clear') {
      this.hide()
      return
    }
    if (anchoredSurfaceFollowsUpdate(kind)) this.reanchor()
  }

  /** The keystroke, not the edit it caused; see signatureHelpTriggerFromTypedText. */
  public handleTypedText(text: string): void {
    const trigger = signatureHelpTriggerFromTypedText(text)
    if (!trigger) return
    if (trigger.kind === 'close') {
      this.hide()
      return
    }

    void this.request(trigger.triggerCharacter)
  }

  public hide(): void {
    this.abort?.abort()
    this.abort = null
    this.lastHelp = null
    this.display = null
    this.tooltip.hide()
  }

  public containsTarget(target: EventTarget | null): boolean {
    return this.tooltip.containsTarget(target)
  }

  public dispose(): void {
    if (this.disposed) return

    this.disposed = true
    for (const key of this.keymapKeys) key.dispose()
    this.hide()
    this.tooltip.dispose()
  }

  /** The keymap's commands; false when there is nothing on screen for them to act on. */
  public runKeyCommand(command: SignatureHelpKeyCommand): boolean {
    const display = this.display
    if (!display) return false
    if (command === 'close') {
      this.hide()
      return true
    }
    if (display.signatureCount < 2) return false

    const delta = command === 'next' ? 1 : -1
    this.showSignature(nextSignatureIndex(display.activeSignature, display.signatureCount, delta))
    return true
  }

  private async request(triggerCharacter: '(' | ','): Promise<void> {
    const active = this.options.getActiveDocument()
    const selection = this.context.getSnapshot().selections[0]
    if (!active || !selection) {
      this.hide()
      return
    }
    if (!this.options.router.hasReady('signatureHelp', 'textDocument/signatureHelp')) return

    this.abort?.abort()
    const abort = new AbortController()
    const requestId = this.requestId + 1
    this.requestId = requestId
    this.abort = abort

    try {
      const help = await this.options.router.request<lsp.SignatureHelp | null>(
        'textDocument/signatureHelp',
        {
          context: { isRetrigger: false, triggerCharacter, triggerKind: 2 },
          position: offsetToLspPositionInSnapshot(active, selection.headOffset),
          textDocument: { uri: active.uri },
        },
        { signal: abort.signal },
      )
      this.options.onRequestSuccess?.()
      // A newer request, a document swap, or a teardown between send and receive all mean this
      // answer describes a call the caret is no longer in.
      if (requestId !== this.requestId) return
      if (this.disposed) return
      if (active !== this.options.getActiveDocument()) return

      this.lastHelp = help ?? null
      this.showSignature(help?.activeSignature ?? 0)
    } catch (error) {
      this.options.onRequestError(error)
    }
  }

  private showSignature(signatureIndex: number): void {
    const display = formatSignatureHelp(this.lastHelp, signatureIndex)
    this.display = display
    if (!display) {
      this.tooltip.hide()
      return
    }

    const anchor = this.caretAnchor()
    if (!anchor) {
      this.tooltip.hide()
      return
    }

    this.tooltip.show({
      anchor,
      hoverText: display.markdown,
      // Above the caret: the argument being typed sits below it, and covering that is the one
      // thing the widget must not do.
      preferredPlacement: 'top',
      theme: this.currentTheme,
    })
  }

  /**
   * Follows the caret when the view moves under the signature.
   *
   * The call being typed is where the signature belongs, and a caret that has scrolled out of the
   * rendered rows has no rect to belong to any more — leaving the widget parked over unrelated code
   * is worse than losing it, and the next keystroke in the argument list asks for it again.
   */
  private reanchor(): void {
    if (!this.display) return

    const anchor = this.caretAnchor()
    if (!anchor) {
      this.hide()
      return
    }

    this.tooltip.reanchor(anchor)
  }

  private caretAnchor(): DOMRect | null {
    const selection = this.context.getSnapshot().selections[0]
    if (!selection) return null

    return this.context.getRangeClientRect(selection.headOffset, selection.headOffset)
  }
}
