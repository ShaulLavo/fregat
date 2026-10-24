import type {
  EditorViewContributionContext,
  EditorViewContributionUpdateKind,
} from '@singapore-editor/core/extensions'
import {
  lspPositionToOffsetInSnapshot,
  offsetToLspPositionInSnapshot,
  type LspTextDocumentSnapshot,
} from '@singapore-editor/lsp'
import type * as lsp from 'vscode-languageserver-protocol'

import type { OffsetRange } from '@singapore-editor/plugin-ui/offset-range'
import type { ActiveDocument } from './pluginTypes'
import { characterAt, rowBounds } from './sourceText'
import {
  type LanguageServerCodeActionProvenance,
  type LanguageServerCodeActionRouter,
} from './serverSet'
import type { ApplyWorkspaceEditResult } from './types'
import { parseWorkspaceEdit } from './workspaceEdit'
import { currentWorkspaceEditOrigin } from './workspaceEditProvenance'

/**
 * Long enough that a held arrow key or a burst of typing asks once, short enough that the answer is
 * already there when the hand leaves the keyboard and reaches for the fix.
 */
const CODE_ACTION_DEBOUNCE_MS = 250

const CODE_ACTION_TRIGGER_AUTOMATIC = 2

/** Root of the kind subtree the auto fix draws from. */
const CODE_ACTION_QUICK_FIX_KIND = 'quickfix'

export type CodeActionResponse = readonly (lsp.Command | lsp.CodeAction)[] | null

/**
 * The one action `editor.action.autoFix` applies, or null when the answer holds none.
 *
 * Nothing else in the answer is kept. There is no menu to put a second candidate in, and a ranked
 * list no surface can draw would be a promise the editor does not keep.
 *
 * `isPreferred` is the server naming the action it would pick itself, and the first such is taken
 * rather than re-ordered: the order the answer arrived in is the only other ranking it gave us.
 * `resolvable` says whether the server fills an action's edit in on request — without that, one
 * that arrived carrying only a command is a fix this client has no way to carry out, and taking it
 * would swallow the chord to do nothing.
 */
export function preferredQuickFix(
  response: CodeActionResponse,
  resolvable: boolean,
): lsp.CodeAction | null {
  if (!response) return null

  for (const entry of response) {
    // A server that declines the literal form answers with bare commands, which carry neither a
    // kind nor a preference and so can never be the action asked for here.
    if (isCommand(entry)) continue
    if (entry.isPreferred !== true || entry.disabled) continue
    if (!resolvable && !entry.edit) continue
    if (!isQuickFixKind(entry.kind)) continue

    return entry
  }

  return null
}

/**
 * The range an automatic request asks about, or null when there is nothing at the caret to ask
 * about.
 *
 * A caret sitting between two blanks is inside indentation or trailing space, where no server has an
 * action to offer; asking anyway would spend a request per settled keystroke while a line is being
 * indented. A drawn selection always asks, because the user pointed at something.
 */
export function codeActionAutoTriggerRange(
  document: LspTextDocumentSnapshot,
  start: number,
  end: number,
): OffsetRange | null {
  if (start !== end) return { start, end }

  const line = rowBounds(document, start)
  if (line.end === line.start) return null
  if (start === line.start)
    return isWhitespace(characterAt(document, start)) ? null : { start, end }
  if (start === line.end)
    return isWhitespace(characterAt(document, start - 1)) ? null : { start, end }

  const around = document.textSnapshot.readRange(start - 1, start + 1)
  return isWhitespace(around[0]) && isWhitespace(around[1]) ? null : { start, end }
}

export type CodeActionControllerOptions = {
  readonly router: LanguageServerCodeActionRouter
  readonly context: EditorViewContributionContext
  readonly getActiveDocument: () => ActiveDocument | null
  readonly getDiagnostics: () => readonly lsp.Diagnostic[]
  readonly onRequestError: (error: unknown) => void
}

/**
 * Keeps the fix available at the caret, and applies it on request.
 *
 * It is refreshed by a debounced oracle rather than fetched when the fix is asked for, because the
 * two events that change the answer — the caret moving and the server republishing diagnostics —
 * are exactly the two the user is waiting on: by the time a squiggle is visible under the caret, its
 * fix is already in hand. Anything that could invalidate it drops it first, so a stale answer is
 * never applied to text it was not computed against.
 */
export class CodeActionController {
  private fix: lsp.CodeAction | null = null
  private seenDiagnostics: readonly lsp.Diagnostic[] | null = null
  private timer: ReturnType<typeof setTimeout> | null = null
  private abort: AbortController | null = null
  private applicationAbort: AbortController | null = null
  private requestId = 0
  private disposed = false

  public constructor(private readonly options: CodeActionControllerOptions) {}

  public update(kind: EditorViewContributionUpdateKind): void {
    if (kind === 'document' || kind === 'clear') {
      this.clear()
      return
    }
    if (kind !== 'selection' && kind !== 'content') return

    this.schedule()
  }

  /**
   * Reruns the oracle when the server republished the active document's diagnostics.
   *
   * Publishes the document sync refused — another file, or a version the buffer has moved past — leave
   * the list identical, and re-asking on those would answer for a document nobody is looking at.
   */
  public diagnosticsChanged(): void {
    const diagnostics = this.options.getDiagnostics()
    if (diagnostics === this.seenDiagnostics) return

    this.seenDiagnostics = diagnostics
    this.schedule()
  }

  /**
   * Applies the preferred quick fix at the caret.
   *
   * Reports handled as soon as the edit is on its way: an action the server has not filled in yet
   * needs a round trip, and returning false would let the keystroke fall through to another binding
   * after the fix was already committed to.
   */
  public applyAutoFix(): boolean {
    if (this.disposed) return false

    const active = this.options.getActiveDocument()
    if (!active) return false

    const fix = this.fix
    if (!fix) return false

    const provenance = this.options.router.provenanceOf(fix)
    if (!provenance) return false

    this.applicationAbort?.abort()
    const abort = new AbortController()
    this.applicationAbort = abort
    void this.runAction(active, fix, provenance, abort)
    return true
  }

  public dispose(): void {
    if (this.disposed) return

    this.disposed = true
    this.clear()
  }

  private schedule(): void {
    this.clear()
    /**
     * @justification Debounces a question to the language server against the caret and the
     * diagnostics, not against rendering, and `clear()` withdraws it on every further change — so a
     * fix is never computed against text the reader has already moved past.
     */
    this.timer = setTimeout(() => {
      this.timer = null
      void this.request()
    }, CODE_ACTION_DEBOUNCE_MS)
  }

  private clear(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    this.abort?.abort()
    this.abort = null
    this.applicationAbort?.abort()
    this.applicationAbort = null
    this.requestId += 1
    this.fix = null
  }

  private async request(): Promise<void> {
    const active = this.options.getActiveDocument()
    if (!active) return
    if (!this.options.router.hasReady('codeActions', 'textDocument/codeAction')) return

    const selection = this.options.context.getSnapshot().selections[0]
    if (!selection) return

    const range = codeActionAutoTriggerRange(active, selection.startOffset, selection.endOffset)
    if (!range) return

    const abort = new AbortController()
    const requestId = this.requestId + 1
    this.requestId = requestId
    this.abort = abort

    try {
      const response = await this.options.router.request<CodeActionResponse>(
        'textDocument/codeAction',
        {
          context: {
            diagnostics: diagnosticsOverlapping(active, this.options.getDiagnostics(), range),
            // The auto fix can apply nothing else, so asking for the wider hierarchy would make
            // every settled keystroke pay for refactors that are thrown away on arrival.
            only: [CODE_ACTION_QUICK_FIX_KIND],
            triggerKind: CODE_ACTION_TRIGGER_AUTOMATIC,
          },
          range: {
            end: offsetToLspPositionInSnapshot(active, range.end),
            start: offsetToLspPositionInSnapshot(active, range.start),
          },
          textDocument: { uri: active.uri },
        },
        { signal: abort.signal },
      )
      if (requestId !== this.requestId) return
      if (this.disposed) return
      if (active !== this.options.getActiveDocument()) return

      // Narrowed again on arrival, because `only` is a hint the server is free to ignore.
      this.fix = preferredQuickFix(response, this.resolvesActions())
    } catch (error) {
      if (!isAbortError(error)) this.options.onRequestError(error)
    }
  }

  private async runAction(
    active: ActiveDocument,
    action: lsp.CodeAction,
    provenance: LanguageServerCodeActionProvenance,
    abort: AbortController,
  ): Promise<void> {
    try {
      if (action.command) {
        this.reportUnsupportedCommand(action)
        return
      }

      const owned = action.edit
        ? { action, ...provenance }
        : await this.options.router.resolveOwnedCodeAction(action, { signal: abort.signal })
      if (!owned) return
      if (!this.isCurrentApplication(active, abort)) return
      if (owned.action.command) {
        this.reportUnsupportedCommand(owned.action)
        return
      }

      await this.dispatchAction(active, owned.action, owned, abort.signal)
    } catch (error) {
      if (!isAbortError(error)) this.options.onRequestError(error)
    } finally {
      if (this.applicationAbort === abort) this.applicationAbort = null
    }
  }

  private resolvesActions(): boolean {
    return this.options.router.canResolveCodeActions()
  }

  private async dispatchAction(
    active: ActiveDocument,
    action: lsp.CodeAction,
    provenance: LanguageServerCodeActionProvenance,
    signal: AbortSignal,
  ): Promise<void> {
    if (!action.edit) {
      this.reportUnsupportedCommand(action)
      return
    }

    const parsed = parseWorkspaceEdit(action.edit)
    if (!parsed.ok) {
      this.options.onRequestError(new Error(parsed.error.reason))
      return
    }
    const origin = currentWorkspaceEditOrigin(provenance.guard, active, parsed.value)
    if (!origin) return
    if (signal.aborted) return

    const apply = provenance.lane.onApplyWorkspaceEdit
    if (!apply) {
      this.options.onRequestError(
        new Error(`"${action.title}" cannot be applied without a workspace edit host.`),
      )
      return
    }

    const result = await apply({
      guard: provenance.guard,
      label: action.title,
      logicalRevisionScope: provenance.lane.connection.logicalRevisionScope,
      originUri: active.uri,
      originVersion: origin.version,
      plan: parsed.value,
      serverId: provenance.lane.id,
      signal,
      source: 'code-action',
    })
    this.reportHostFailure(result)
  }

  private isCurrentApplication(active: ActiveDocument, abort: AbortController): boolean {
    if (this.disposed) return false
    if (abort.signal.aborted) return false
    return active === this.options.getActiveDocument()
  }

  private reportUnsupportedCommand(action: lsp.CodeAction): void {
    this.options.onRequestError(
      new Error(`"${action.title}" includes a server command, which this editor cannot run.`),
    )
  }

  private reportHostFailure(result: ApplyWorkspaceEditResult): void {
    if (result.status !== 'failed') return
    this.options.onRequestError(new Error(`${result.code}: ${result.message}`))
  }
}

/** A literal's own `command` is an object; only the bare form names its command with a string. */
function isCommand(entry: lsp.Command | lsp.CodeAction): entry is lsp.Command {
  return typeof (entry as lsp.Command).command === 'string'
}

/**
 * Whether `kind` is the quick-fix kind or sits beneath it in the dotted hierarchy.
 *
 * Containment, not equality: a server that names its actions precisely answers `quickfix.import`,
 * and comparing the strings whole would reject every one of those. An action that named no kind at
 * all placed itself nowhere, so it is not in this subtree either.
 */
function isQuickFixKind(kind: string | undefined): boolean {
  if (kind === undefined) return false

  return kind === CODE_ACTION_QUICK_FIX_KIND || kind.startsWith(`${CODE_ACTION_QUICK_FIX_KIND}.`)
}

function diagnosticsOverlapping(
  document: LspTextDocumentSnapshot,
  diagnostics: readonly lsp.Diagnostic[],
  range: OffsetRange,
): lsp.Diagnostic[] {
  return diagnostics.filter((diagnostic) => {
    const start = lspPositionToOffsetInSnapshot(document, diagnostic.range.start)
    const end = lspPositionToOffsetInSnapshot(document, diagnostic.range.end)
    return start <= range.end && end >= range.start
  })
}

function isWhitespace(character: string | undefined): boolean {
  return character !== undefined && /\s/.test(character)
}

function isAbortError(error: unknown): boolean {
  if (error instanceof DOMException && error.name === 'AbortError') return true
  if (!isRecord(error)) return false
  return error.name === 'LspRequestCancelledError'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
