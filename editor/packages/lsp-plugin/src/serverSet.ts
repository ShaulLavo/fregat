import type { LspRequestOptions, LspWorkspace } from '@singapore-editor/lsp'
import type * as lsp from 'vscode-languageserver-protocol'

import type { AcquiredLanguageServerLane } from './lane'
import {
  LANGUAGE_SERVER_FEATURE_IDS,
  type LanguageServerFeatureId,
  type LanguageServerFeatureRanks,
  type OnApplyWorkspaceEdit,
  type WorkspaceEditOriginGuard,
  type WorkspaceTextDocumentProvenance,
} from './types'

export type LanguageServerSetLane = {
  readonly id: string
  readonly features: LanguageServerFeatureRanks
  readonly connection: AcquiredLanguageServerLane
  readonly onInteractiveReady?: () => void
  readonly onApplyWorkspaceEdit?: OnApplyWorkspaceEdit
  readonly onRequestError?: (method: string, error: unknown) => void
}

export type LanguageServerLaneResult = {
  readonly lane: LanguageServerSetLane
  readonly provenance?: LanguageServerCodeActionProvenance
  readonly result: unknown
}

export type LanguageServerHoverUpdate = {
  /** Hover answers in feature-rank order, regardless of the order in which they resolved. */
  readonly hovers: readonly lsp.Hover[]
  /** True until every ready hover lane has either answered or failed. */
  readonly pending: boolean
}

export type LanguageServerFeatureRouter = {
  canResolveCodeActions(): boolean
  hasReady(feature: LanguageServerFeatureId, method?: string): boolean
  request<TResult = unknown, TParams = unknown>(
    method: string,
    params?: TParams,
    options?: LspRequestOptions,
  ): Promise<TResult>
}

export type LanguageServerCodeActionRouter = LanguageServerFeatureRouter & {
  ownerOf(value: unknown): LanguageServerSetLane | null
  provenanceOf(value: unknown): LanguageServerCodeActionProvenance | null
  resolveOwnedCodeAction(
    action: lsp.CodeAction,
    options: LspRequestOptions,
  ): Promise<LanguageServerOwnedCodeAction | null>
}

export type LanguageServerCodeActionProvenance = {
  readonly guard: WorkspaceEditOriginGuard
  readonly lane: LanguageServerSetLane
}

export type LanguageServerOwnedCodeAction = LanguageServerCodeActionProvenance & {
  readonly action: lsp.CodeAction
}

export class LanguageServerSet {
  readonly #lanes: readonly LanguageServerSetLane[]
  readonly #provenance = new WeakMap<object, LanguageServerCodeActionProvenance>()

  public constructor(lanes: readonly LanguageServerSetLane[]) {
    this.#lanes = lanes
  }

  public declared(feature: LanguageServerFeatureId): readonly LanguageServerSetLane[] {
    return rankedLanguageServerLanes(this.#lanes, feature)
  }

  public ready(
    feature: LanguageServerFeatureId,
    method?: string,
  ): readonly LanguageServerSetLane[] {
    return this.declared(feature).filter((lane) => {
      if (!lane.connection.isReady()) return false
      return laneSupports(lane, feature, method)
    })
  }

  public hasReady(feature: LanguageServerFeatureId, method?: string): boolean {
    return this.ready(feature, method).length > 0
  }

  public canResolveCodeActions(): boolean {
    return this.ready('codeActions').some((lane) => {
      const provider = lane.connection.client.serverCapabilities?.codeActionProvider
      return isRecord(provider) && provider.resolveProvider === true
    })
  }

  public ownerOf(value: unknown): LanguageServerSetLane | null {
    return this.provenanceOf(value)?.lane ?? null
  }

  public provenanceOf(value: unknown): LanguageServerCodeActionProvenance | null {
    if (!isRecord(value)) return null
    return this.#provenance.get(value) ?? null
  }

  public request<TResult = unknown, TParams = unknown>(
    method: string,
    params?: TParams,
    options: LspRequestOptions = {},
  ): Promise<TResult> {
    if (method === 'textDocument/hover') {
      return this.requestHover(params, options) as Promise<TResult>
    }
    if (method === 'textDocument/codeAction') {
      const lanes = this.ready('codeActions', method)
      const lane = lanes.length === 1 ? lanes[0] : undefined
      if (lane) {
        const provenance = codeActionProvenance(lane)
        return this.requestSingle(lane, method, params, options, [], (result) =>
          this.mergeArrayResults('codeActions', [{ lane, provenance, result }]),
        ) as Promise<TResult>
      }

      return this.mergedArray('codeActions', method, params, options) as Promise<TResult>
    }
    if (method === 'textDocument/documentHighlight') {
      return this.requestFirst(
        'documentHighlights',
        method,
        params,
        options,
        [],
      ) as Promise<TResult>
    }
    if (method === 'codeAction/resolve')
      return this.resolveCodeAction(params, options) as Promise<TResult>

    const feature = featureForMethod(method)
    if (!feature) return Promise.resolve(null as TResult)

    if (feature === 'navigation') {
      const lanes = this.ready(feature, method)
      const lane = lanes.length === 1 ? lanes[0] : undefined
      if (lane) {
        return this.requestSingle(lane, method, params, options, [], (result) =>
          mergeNavigationResults([{ lane, result }]),
        ) as Promise<TResult>
      }

      return this.requestAll(feature, method, params, options).then(
        mergeNavigationResults,
      ) as Promise<TResult>
    }
    if (feature === 'signatureHelp') {
      return this.requestFirst(feature, method, params, options, null) as Promise<TResult>
    }

    return this.requestOwner(feature, method, params, options, null) as Promise<TResult>
  }

  public async requestHover<TParams>(
    params: TParams | undefined,
    options: LspRequestOptions = {},
    onUpdate?: (update: LanguageServerHoverUpdate) => void,
  ): Promise<lsp.Hover | null> {
    const lanes = this.ready('hover', 'textDocument/hover')
    if (lanes.length === 0) return null

    const results: Array<LanguageServerLaneResult | null> = lanes.map(() => null)
    let settled = 0
    const requests = lanes.map((lane, index) =>
      this.requestHoverLane(lane, params, options).then((result) => {
        results[index] = { lane, result }
        settled += 1
        onUpdate?.({ hovers: hoverResults(results), pending: settled < lanes.length })
      }),
    )
    await Promise.all(requests)
    return mergedHover(hoverResults(results))
  }

  private async requestHoverLane<TParams>(
    lane: LanguageServerSetLane,
    params: TParams | undefined,
    options: LspRequestOptions,
  ): Promise<unknown> {
    try {
      const result = await lane.connection.client.request('textDocument/hover', params, options)
      lane.onInteractiveReady?.()
      return result
    } catch (error) {
      if (!isAbortError(error)) lane.onRequestError?.('textDocument/hover', error)
      return null
    }
  }

  async mergedArray<TParams>(
    feature: 'codeActions',
    method: string,
    params: TParams | undefined,
    options: LspRequestOptions,
  ) {
    const results = await this.requestAll(feature, method, params, options)
    return this.mergeArrayResults(feature, results)
  }

  mergeArrayResults(feature: 'codeActions', results: readonly LanguageServerLaneResult[]) {
    const merged: unknown[] = []
    for (const { lane, provenance, result } of results) {
      if (!Array.isArray(result)) continue
      if (!provenance) continue

      for (const item of result) {
        if (!isRecord(item)) continue
        if (feature === 'codeActions' && !usableCodeAction(item, lane)) continue

        this.#provenance.set(item, provenance)
        merged.push(item)
      }
    }

    return merged
  }

  async resolveCodeAction<TParams>(params: TParams | undefined, options: LspRequestOptions) {
    if (!isCodeAction(params)) return params ?? null

    const resolved = await this.resolveOwnedCodeAction(params, options)
    return resolved?.action ?? params
  }

  public async resolveOwnedCodeAction(
    action: lsp.CodeAction,
    options: LspRequestOptions,
  ): Promise<LanguageServerOwnedCodeAction | null> {
    const current = this.provenanceOf(action)
    if (!current) return null

    const result = await this.requestSingle(
      current.lane,
      'codeAction/resolve',
      action,
      options,
      null,
    )
    if (!isCodeAction(result)) return null

    this.#provenance.set(result, current)
    return { action: result, ...current }
  }

  requestSingle<TParams, TResult = unknown>(
    lane: LanguageServerSetLane | undefined,
    method: string,
    params: TParams | undefined,
    options: LspRequestOptions,
    fallback: TResult,
    transform: (result: unknown) => TResult = (result) => result as TResult,
  ): Promise<TResult> {
    if (!lane) return Promise.resolve(fallback)

    return lane.connection.client.request(method, params, options).then(
      (result) => {
        lane.onInteractiveReady?.()
        return transform(result)
      },
      (error) => {
        if (!isAbortError(error)) lane.onRequestError?.(method, error)
        return fallback
      },
    )
  }

  public async requestFirst<TParams, TResult = unknown>(
    feature: LanguageServerFeatureId,
    method: string,
    params: TParams | undefined,
    options: LspRequestOptions = {},
    fallback: TResult,
    accepts: (result: unknown) => boolean = isNonNullResult,
  ): Promise<TResult> {
    for (const lane of this.ready(feature, method)) {
      const result = await this.requestLane(lane, method, params, options)
      if (accepts(result)) return result as TResult
    }

    return fallback
  }

  public requestOwner<TParams, TResult = unknown>(
    feature: LanguageServerFeatureId,
    method: string,
    params: TParams | undefined,
    options: LspRequestOptions = {},
    fallback: TResult,
  ): Promise<TResult> {
    return this.requestSingle(this.ready(feature, method)[0], method, params, options, fallback)
  }

  async requestAll<TParams>(
    feature: LanguageServerFeatureId,
    method: string,
    params: TParams | undefined,
    options: LspRequestOptions,
  ): Promise<readonly LanguageServerLaneResult[]> {
    const requests = this.ready(feature, method).map(async (lane) => {
      try {
        const provenance = feature === 'codeActions' ? codeActionProvenance(lane) : undefined
        const result = await lane.connection.client.request(method, params, options)
        lane.onInteractiveReady?.()
        return { lane, provenance, result }
      } catch (error) {
        if (!isAbortError(error)) lane.onRequestError?.(method, error)
        return { lane, result: null }
      }
    })

    return Promise.all(requests)
  }

  private async requestLane<TParams>(
    lane: LanguageServerSetLane,
    method: string,
    params: TParams | undefined,
    options: LspRequestOptions,
  ): Promise<unknown> {
    try {
      const result = await lane.connection.client.request(method, params, options)
      lane.onInteractiveReady?.()
      return result
    } catch (error) {
      if (!isAbortError(error)) lane.onRequestError?.(method, error)
      return null
    }
  }
}

export function rankedLanguageServerLanes<
  TLane extends { readonly features: LanguageServerFeatureRanks },
>(lanes: readonly TLane[], feature: LanguageServerFeatureId): readonly TLane[] {
  return lanes
    .filter((lane) => lane.features[feature] !== undefined)
    .toSorted((left, right) => compareFeatureRank(left, right, feature, lanes))
}

export function allLanguageServerFeatures(rank = 0): LanguageServerFeatureRanks {
  return Object.fromEntries(LANGUAGE_SERVER_FEATURE_IDS.map((feature) => [feature, rank]))
}

export function laneSupports(
  lane: LanguageServerSetLane,
  feature: LanguageServerFeatureId,
  method?: string,
): boolean {
  const capabilities = lane.connection.client.serverCapabilities
  if (!capabilities) return false
  if (feature === 'diagnostics') return true
  if (feature === 'completion') return Boolean(capabilities.completionProvider)
  if (feature === 'hover') return Boolean(capabilities.hoverProvider)
  if (feature === 'navigation') return supportsNavigation(capabilities, method)
  if (feature === 'signatureHelp') return Boolean(capabilities.signatureHelpProvider)
  if (feature === 'codeActions') return Boolean(capabilities.codeActionProvider)
  if (feature === 'formatting') {
    if (method === 'textDocument/onTypeFormatting') {
      return Boolean(capabilities.documentOnTypeFormattingProvider)
    }

    return Boolean(capabilities.documentFormattingProvider)
  }
  if (feature === 'rename') return Boolean(capabilities.renameProvider)
  if (feature === 'documentHighlights') return Boolean(capabilities.documentHighlightProvider)
  return Boolean(capabilities.semanticTokensProvider)
}

function supportsNavigation(capabilities: lsp.ServerCapabilities, method?: string): boolean {
  if (method === 'textDocument/references') return Boolean(capabilities.referencesProvider)
  if (method === 'textDocument/implementation') return Boolean(capabilities.implementationProvider)
  if (method === 'textDocument/typeDefinition') return Boolean(capabilities.typeDefinitionProvider)
  return Boolean(capabilities.definitionProvider)
}

function featureForMethod(method: string): LanguageServerFeatureId | null {
  if (method === 'textDocument/signatureHelp') return 'signatureHelp'
  if (method === 'textDocument/formatting') return 'formatting'
  if (method === 'textDocument/onTypeFormatting') return 'formatting'
  if (method === 'textDocument/rename') return 'rename'
  if (method === 'textDocument/definition') return 'navigation'
  if (method === 'textDocument/references') return 'navigation'
  if (method === 'textDocument/implementation') return 'navigation'
  if (method === 'textDocument/typeDefinition') return 'navigation'
  return null
}

function compareFeatureRank(
  left: { readonly features: LanguageServerFeatureRanks },
  right: { readonly features: LanguageServerFeatureRanks },
  feature: LanguageServerFeatureId,
  lanes: readonly { readonly features: LanguageServerFeatureRanks }[],
): number {
  const rank = (left.features[feature] ?? 0) - (right.features[feature] ?? 0)
  if (rank !== 0) return rank

  return lanes.indexOf(left) - lanes.indexOf(right)
}

function usableCodeAction(item: Record<string, unknown>, lane: LanguageServerSetLane): boolean {
  if (item.edit !== undefined) return true
  if (typeof item.command === 'string') return true

  const provider = lane.connection.client.serverCapabilities?.codeActionProvider
  return isRecord(provider) && provider.resolveProvider === true
}

function isHover(value: unknown): value is lsp.Hover {
  return isRecord(value) && value.contents !== undefined
}

function hoverResults(results: readonly (LanguageServerLaneResult | null)[]): readonly lsp.Hover[] {
  const hovers: lsp.Hover[] = []
  const seen = new Set<string>()
  for (const entry of results) {
    if (!entry || !isHover(entry.result)) continue

    const text = hoverContentsText(entry.result.contents).trim()
    if (text.length === 0 || seen.has(text)) continue

    seen.add(text)
    hovers.push(entry.result)
  }

  return hovers
}

function mergeNavigationResults(results: readonly LanguageServerLaneResult[]): readonly unknown[] {
  const merged: unknown[] = []
  const seen = new Set<string>()
  for (const entry of results) {
    const items = Array.isArray(entry.result) ? entry.result : [entry.result]
    for (const item of items) {
      const key = navigationResultKey(item)
      if (!key || seen.has(key)) continue

      seen.add(key)
      merged.push(item)
    }
  }

  return merged
}

function navigationResultKey(value: unknown): string | null {
  if (!isRecord(value)) return null
  if (typeof value.uri === 'string' && isRecord(value.range)) {
    return `${value.uri}:${JSON.stringify(value.range)}`
  }
  if (typeof value.targetUri === 'string' && isRecord(value.targetSelectionRange)) {
    return `${value.targetUri}:${JSON.stringify(value.targetSelectionRange)}`
  }

  return null
}

function isNonNullResult(result: unknown): boolean {
  return result !== null && result !== undefined
}

function isCodeAction(value: unknown): value is lsp.CodeAction {
  if (!isRecord(value)) return false
  if (typeof value.title !== 'string') return false
  return typeof value.command !== 'string'
}

function mergedHover(hovers: readonly lsp.Hover[]): lsp.Hover | null {
  if (hovers.length === 0) return null

  return {
    contents: {
      kind: 'markdown',
      value: hovers.map((hover) => hoverContentsText(hover.contents)).join('\n\n---\n\n'),
    },
    range: hovers.find((hover) => hover.range)?.range,
  }
}

function hoverContentsText(contents: lsp.Hover['contents']): string {
  if (typeof contents === 'string') return contents
  if (Array.isArray(contents)) return contents.map(markedStringText).join('\n\n')
  if ('kind' in contents) return contents.value
  return markedStringText(contents)
}

function markedStringText(value: lsp.MarkedString): string {
  if (typeof value === 'string') return value
  return ['```' + value.language, value.value, '```'].join('\n')
}

function isAbortError(error: unknown): boolean {
  if (error instanceof DOMException && error.name === 'AbortError') return true
  return isRecord(error) && error.name === 'LspRequestCancelledError'
}

function codeActionProvenance(lane: LanguageServerSetLane): LanguageServerCodeActionProvenance {
  return {
    guard: captureWorkspaceEditOriginGuard(lane.connection.workspace),
    lane,
  }
}

export function captureWorkspaceEditOriginGuard(workspace: LspWorkspace): WorkspaceEditOriginGuard {
  const documents: readonly WorkspaceTextDocumentProvenance[] = Object.freeze(
    workspace.documents.map((document) =>
      Object.freeze({
        textSnapshot: document.textSnapshot,
        uri: document.uri,
        version: document.version,
      }),
    ),
  )
  const documentsByUri = new Map(documents.map((document) => [document.uri, document]))

  return Object.freeze({
    documents,
    isCurrent(uri: string) {
      const captured = documentsByUri.get(uri)
      if (!captured) return false

      const current = workspace.getDocument(uri)
      if (!current) return false
      return (
        current.uri === captured.uri &&
        current.version === captured.version &&
        current.textSnapshot === captured.textSnapshot
      )
    },
  })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
