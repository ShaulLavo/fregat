import type { LspClient } from '@singapore-editor/lsp'
import type * as lsp from 'vscode-languageserver-protocol'

export type PullDiagnosticsDocument = {
  readonly uri: lsp.DocumentUri
  readonly version: number
}

export type PullDiagnosticsControllerOptions = {
  readonly client: LspClient
  getDocument(): PullDiagnosticsDocument | null
  publish(document: PullDiagnosticsDocument, diagnostics: readonly lsp.Diagnostic[]): void
  onRequestError(error: unknown): void
  /** A request started or settled; called after any result it brought was published. */
  onPendingChange?(pending: boolean): void
}

/** Keeps one active document's pull-diagnostic result current for one language-server lane. */
export class PullDiagnosticsController {
  #abort: AbortController | null = null
  #disposed = false
  #pending = false
  #resultId: string | null = null
  #uri: lsp.DocumentUri | null = null

  public constructor(private readonly options: PullDiagnosticsControllerOptions) {}

  public synchronize(): void {
    if (this.#disposed) return

    const document = this.options.getDocument()
    const provider = diagnosticProvider(this.options.client.serverCapabilities)
    if (!document || !provider) {
      this.reset()
      return
    }

    if (document.uri !== this.#uri) {
      this.#uri = document.uri
      this.#resultId = null
    }

    this.#abort?.abort()
    const abort = new AbortController()
    this.#abort = abort
    const params = diagnosticParams(document.uri, provider.identifier, this.#resultId)
    void this.options.client
      .request<lsp.DocumentDiagnosticReport>('textDocument/diagnostic', params, {
        signal: abort.signal,
      })
      .then(
        (report) => this.accept(document, abort, report),
        (error) => this.reject(abort, error),
      )
      .finally(() => this.notifyPending())
    this.notifyPending()
  }

  public get pending(): boolean {
    return this.#pending
  }

  public refresh(): void {
    this.synchronize()
  }

  public cancel(): void {
    this.#abort?.abort()
    this.#abort = null
    this.notifyPending()
  }

  public dispose(): void {
    if (this.#disposed) return

    this.#disposed = true
    this.reset()
  }

  private accept(
    requested: PullDiagnosticsDocument,
    abort: AbortController,
    report: lsp.DocumentDiagnosticReport,
  ): void {
    if (abort.signal.aborted || this.#abort !== abort) return

    this.#abort = null
    const current = this.options.getDocument()
    if (!sameDocument(current, requested)) return

    if (report.kind === 'unchanged') {
      this.#resultId = report.resultId
      return
    }

    this.#resultId = report.resultId ?? null
    this.options.publish(requested, report.items)
  }

  private reject(abort: AbortController, error: unknown): void {
    if (abort.signal.aborted || this.#abort !== abort) return

    this.#abort = null
    this.options.onRequestError(error)
  }

  private notifyPending(): void {
    const pending = this.#abort !== null
    if (pending === this.#pending) return
    this.#pending = pending
    this.options.onPendingChange?.(pending)
  }

  private reset(): void {
    this.cancel()
    this.#resultId = null
    this.#uri = null
  }
}

function diagnosticProvider(
  capabilities: lsp.ServerCapabilities | null,
): lsp.DiagnosticOptions | null {
  const provider = capabilities?.diagnosticProvider
  if (!provider || typeof provider !== 'object') return null
  return provider
}

function diagnosticParams(
  uri: lsp.DocumentUri,
  identifier: string | undefined,
  previousResultId: string | null,
): lsp.DocumentDiagnosticParams {
  return {
    textDocument: { uri },
    ...(identifier ? { identifier } : {}),
    ...(previousResultId ? { previousResultId } : {}),
  }
}

function sameDocument(
  current: PullDiagnosticsDocument | null,
  requested: PullDiagnosticsDocument,
): boolean {
  return current?.uri === requested.uri && current.version === requested.version
}
