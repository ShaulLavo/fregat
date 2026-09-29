import {
  EDITOR_MINIMAP_FEATURE,
  type EditorMinimapDecoration,
  type EditorMinimapFeature,
  type EditorViewContributionContext,
} from '@singapore-editor/core/extensions'
import { lspPositionToOffsetInSnapshot, type LspTextDocumentSnapshot } from '@singapore-editor/lsp'
import {
  editorThemesEqual,
  type EditorTheme,
  type VirtualizedTextHighlightStyle,
} from '@singapore-editor/core/rendering'
import { readColorAlpha } from './colorAlpha'
import type * as lsp from 'vscode-languageserver-protocol'

import {
  combineDiagnosticsFreshness,
  diagnosticHighlightGroups,
  summarizeDiagnostics,
  type LanguageServerDiagnosticHighlightLayer,
  type LanguageServerDiagnosticSeverity,
} from './diagnostics'
import {
  DEPRECATED_DIAGNOSTIC_STYLE,
  DIAGNOSTIC_MARKER_COLORS,
  DIAGNOSTIC_STYLES,
  UNNECESSARY_DIAGNOSTIC_OPACITY,
} from './plugin.styles'
import type { OffsetRange } from '@singapore-editor/plugin-ui/offset-range'
import type {
  LanguageServerDiagnosticMarkerClaim,
  LanguageServerDiagnosticMarkerEvent,
  LanguageServerDiagnosticSummary,
  LanguageServerDiagnosticsFreshness,
} from './types'

export { viewDocumentSnapshot } from './viewDocumentSnapshot'

const LSP_DIAGNOSTIC_ERROR = 1
const LSP_DIAGNOSTIC_WARNING = 2
const LSP_DIAGNOSTIC_INFORMATION = 3
const LSP_DIAGNOSTIC_HINT = 4

const DIAGNOSTIC_LAYERS: readonly LanguageServerDiagnosticHighlightLayer[] = [
  'error',
  'warning',
  'information',
  'hint',
  'deprecated',
  'unnecessary',
]

const DIAGNOSTIC_LAYER_STYLES: Record<
  LanguageServerDiagnosticHighlightLayer,
  VirtualizedTextHighlightStyle
> = {
  ...DIAGNOSTIC_STYLES,
  deprecated: DEPRECATED_DIAGNOSTIC_STYLE,
  unnecessary: { overlay: { dim: 1 } },
}

const DIAGNOSTIC_MINIMAP_Z_INDEX: Record<LanguageServerDiagnosticSeverity, number> = {
  error: 40,
  warning: 30,
  information: 20,
  hint: 10,
}

export type DiagnosticsPresenterActiveDocument = LspTextDocumentSnapshot & {
  readonly textVersion: number
  readonly uri: lsp.DocumentUri
}

export type DiagnosticsPresenterMarkerDirection = 'next' | 'previous'

export type DiagnosticsPresenterOptions = {
  readonly minimapSourceId: string
  readonly highlightNameNamespace: string
  readonly markerTimingNamePrefix: string
  readonly onDiagnostics?: (summary: ReturnType<typeof summarizeDiagnostics>) => void
  readonly onDidNavigateDiagnostic?: (
    event: LanguageServerDiagnosticMarkerEvent,
  ) => LanguageServerDiagnosticMarkerClaim
  readonly onError?: (error: unknown) => void
}

export class DiagnosticsPresenter {
  private readonly highlightNames: Record<LanguageServerDiagnosticHighlightLayer, string>
  private markerClaim: Extract<LanguageServerDiagnosticMarkerClaim, { kind: 'claimed' }> | null =
    null
  private unnecessaryDimCache: number | null = null

  public constructor(
    private readonly context: EditorViewContributionContext,
    prefix: string,
    private readonly options: DiagnosticsPresenterOptions,
  ) {
    this.highlightNames = createHighlightNames(prefix, options.highlightNameNamespace)
  }

  public render(document: LspTextDocumentSnapshot, diagnostics: readonly lsp.Diagnostic[]): void {
    this.renderHighlights(document, diagnostics)
    this.renderMinimapMarkers(diagnostics)
  }

  public invalidateTheme(): void {
    this.unnecessaryDimCache = null
  }

  public clear(): void {
    this.releaseMarkerClaim()
    this.clearMinimapMarkers()
    for (const name of Object.values(this.highlightNames)) this.context.clearRangeHighlight(name)
  }

  public publishSummary(
    uri: lsp.DocumentUri,
    version: number | null,
    diagnostics: readonly lsp.Diagnostic[],
  ): void {
    this.options.onDiagnostics?.(summarizeDiagnostics(uri, version, diagnostics))
  }

  public moveMarker(
    active: DiagnosticsPresenterActiveDocument | null,
    diagnostics: readonly lsp.Diagnostic[],
    direction: DiagnosticsPresenterMarkerDirection,
  ): boolean {
    if (!active) return false

    const selection = this.context.getSnapshot().selections[0]
    if (!selection) return false

    const target = diagnosticMarkerTarget(active, diagnostics, selection.headOffset, direction)
    if (!target) return false

    const timingName = `${this.options.markerTimingNamePrefix}.${direction}`
    this.context.setSelection(target.range.start, target.range.end, timingName, {
      revealOffset: target.range.start,
    })
    this.context.focusEditor()
    this.publishMarker(active, target, direction)
    return true
  }

  private publishMarker(
    active: DiagnosticsPresenterActiveDocument,
    target: DiagnosticMarkerTarget,
    direction: DiagnosticsPresenterMarkerDirection,
  ): void {
    this.releaseMarkerClaim()
    if (!this.options.onDidNavigateDiagnostic) return

    try {
      const claim = this.options.onDidNavigateDiagnostic({
        anchor: markerAnchor(target.range),
        diagnostic: target.diagnostic,
        direction,
        documentUri: active.uri,
        textVersion: active.textVersion,
      })
      if (claim.kind === 'claimed') this.markerClaim = claim
    } catch (error) {
      this.options.onError?.(error)
    }
  }

  private releaseMarkerClaim(): void {
    const claim = this.markerClaim
    this.markerClaim = null
    claim?.dispose()
  }

  private renderHighlights(
    document: LspTextDocumentSnapshot,
    diagnostics: readonly lsp.Diagnostic[],
  ): void {
    const groups = diagnosticHighlightGroups(document, diagnostics)
    for (const layer of DIAGNOSTIC_LAYERS) {
      this.context.setRangeHighlight(
        this.highlightNames[layer],
        groups[layer],
        layer === 'unnecessary' && groups.unnecessary.length > 0
          ? { overlay: { dim: this.unnecessaryDim() } }
          : DIAGNOSTIC_LAYER_STYLES[layer],
      )
    }
  }

  // Reading the alpha forces a style recalc, and it only moves with the theme.
  private unnecessaryDim(): number {
    this.unnecessaryDimCache ??= readColorAlpha(
      this.context.scrollElement,
      UNNECESSARY_DIAGNOSTIC_OPACITY,
    )
    return this.unnecessaryDimCache
  }

  private renderMinimapMarkers(diagnostics: readonly lsp.Diagnostic[]): void {
    const minimap = this.minimapFeature()
    if (!minimap) return

    minimap.setDecorations(
      this.options.minimapSourceId,
      diagnosticMinimapDecorations(this.context.getSnapshot().lineCount, diagnostics),
    )
  }

  private clearMinimapMarkers(): void {
    this.minimapFeature()?.clearDecorations(this.options.minimapSourceId)
  }

  private minimapFeature(): EditorMinimapFeature | null {
    return this.context.getFeature(EDITOR_MINIMAP_FEATURE)
  }
}

type DiagnosticBatch = {
  readonly diagnostics: readonly lsp.Diagnostic[]
  readonly document: LspTextDocumentSnapshot | null
  readonly uri: lsp.DocumentUri | null
  readonly version: number | null
}

export type CompositeDiagnosticsLanePresenter = {
  clear(): void
  render(document: LspTextDocumentSnapshot, diagnostics: readonly lsp.Diagnostic[]): void
  publishSummary(
    uri: lsp.DocumentUri,
    version: number | null,
    diagnostics: readonly lsp.Diagnostic[],
    freshness: LanguageServerDiagnosticsFreshness,
  ): void
}

export class CompositeDiagnosticsPresenter {
  private theme: EditorTheme | null = null

  public updateTheme(theme: EditorTheme | null): void {
    if (editorThemesEqual(this.theme, theme)) return
    this.theme = theme
    this.presenter.invalidateTheme()
    this.renderCombined()
  }

  readonly #batches = new Map<string, DiagnosticBatch>()
  readonly #freshness = new Map<string, LanguageServerDiagnosticsFreshness>()
  #diagnostics: readonly lsp.Diagnostic[] = []

  public constructor(
    private readonly presenter: DiagnosticsPresenter,
    private readonly laneIds: readonly string[],
    private readonly onDiagnostics?: (summary: LanguageServerDiagnosticSummary) => void,
  ) {}

  public get diagnostics(): readonly lsp.Diagnostic[] {
    return this.#diagnostics
  }

  public forLane(
    laneId: string,
    onDiagnostics?: (summary: LanguageServerDiagnosticSummary) => void,
  ): CompositeDiagnosticsLanePresenter {
    return {
      clear: () => {
        const current = this.#batches.get(laneId)
        if (!current) return

        this.#batches.set(laneId, { ...current, diagnostics: [] })
        this.refreshDiagnostics()
        this.renderCombined()
      },
      render: (document, diagnostics) => {
        const current = this.#batches.get(laneId)
        this.#batches.set(laneId, {
          diagnostics,
          document,
          uri: current?.uri ?? null,
          version: current?.version ?? null,
        })
        this.refreshDiagnostics()
        this.renderCombined()
      },
      publishSummary: (uri, version, diagnostics, freshness) => {
        this.#freshness.set(laneId, freshness)
        const current = this.#batches.get(laneId)
        if (!current && diagnostics.length === 0) {
          onDiagnostics?.(summarizeDiagnostics(uri, version, diagnostics, freshness))
          this.publishCombinedSummary()
          return
        }

        this.#batches.set(laneId, {
          diagnostics,
          document: current?.document ?? null,
          uri,
          version,
        })
        this.refreshDiagnostics()
        onDiagnostics?.(summarizeDiagnostics(uri, version, diagnostics, freshness))
        this.publishCombinedSummary()
      },
    }
  }

  public clear(): void {
    this.#batches.clear()
    this.#freshness.clear()
    this.refreshDiagnostics()
    this.presenter.clear()
  }

  public moveMarker(
    active: DiagnosticsPresenterActiveDocument | null,
    direction: DiagnosticsPresenterMarkerDirection,
  ): boolean {
    return this.presenter.moveMarker(active, this.diagnostics, direction)
  }

  private renderCombined(): void {
    const document = this.currentDocument()
    if (document === null) {
      this.presenter.clear()
      return
    }

    this.presenter.render(document, this.diagnostics)
  }

  private refreshDiagnostics(): void {
    this.#diagnostics = this.laneIds.flatMap((id) => this.#batches.get(id)?.diagnostics ?? [])
  }

  private publishCombinedSummary(): void {
    const current = this.currentBatch()
    const freshness = combineDiagnosticsFreshness(
      this.laneIds.flatMap((id) => this.#freshness.get(id) ?? []),
    )
    this.onDiagnostics?.(
      summarizeDiagnostics(
        current?.uri ?? null,
        current?.version ?? null,
        this.diagnostics,
        freshness,
      ),
    )
  }

  private currentDocument(): LspTextDocumentSnapshot | null {
    for (const id of this.laneIds) {
      const batch = this.#batches.get(id)
      if (batch?.document && batch.diagnostics.length > 0) return batch.document
    }

    for (const id of this.laneIds) {
      const batch = this.#batches.get(id)
      if (batch?.document) return batch.document
    }

    return null
  }

  private currentBatch(): DiagnosticBatch | null {
    for (const id of this.laneIds) {
      const batch = this.#batches.get(id)
      if (batch && batch.diagnostics.length > 0) return batch
    }

    for (const id of this.laneIds) {
      const batch = this.#batches.get(id)
      if (batch) return batch
    }

    return null
  }
}

function createHighlightNames(
  prefix: string,
  namespace: string,
): Record<LanguageServerDiagnosticHighlightLayer, string> {
  return {
    error: `${prefix}-${namespace}-error`,
    warning: `${prefix}-${namespace}-warning`,
    information: `${prefix}-${namespace}-information`,
    hint: `${prefix}-${namespace}-hint`,
    deprecated: `${prefix}-${namespace}-deprecated`,
    unnecessary: `${prefix}-${namespace}-unnecessary`,
  }
}

function diagnosticMinimapDecorations(
  lineCount: number,
  diagnostics: readonly lsp.Diagnostic[],
): readonly EditorMinimapDecoration[] {
  return diagnostics.flatMap((diagnostic) => diagnosticMinimapDecoration(lineCount, diagnostic))
}

function diagnosticMinimapDecoration(
  lineCount: number,
  diagnostic: lsp.Diagnostic,
): readonly EditorMinimapDecoration[] {
  if (lineCount <= 0) return []

  const severity = minimapSeverityForDiagnostic(diagnostic)
  const startLineNumber = clampLineNumber(diagnostic.range.start.line + 1, lineCount)
  const endLineNumber = Math.max(
    startLineNumber,
    clampLineNumber(diagnosticEndLineNumber(diagnostic), lineCount),
  )
  return [
    {
      startLineNumber,
      startColumn: 1,
      endLineNumber,
      endColumn: 1,
      color: DIAGNOSTIC_MARKER_COLORS[severity],
      position: 'inline',
      zIndex: DIAGNOSTIC_MINIMAP_Z_INDEX[severity],
    },
  ]
}

function diagnosticEndLineNumber(diagnostic: lsp.Diagnostic): number {
  const start = diagnostic.range.start
  const end = diagnostic.range.end
  if (end.line > start.line && end.character === 0) return end.line
  return end.line + 1
}

function minimapSeverityForDiagnostic(
  diagnostic: lsp.Diagnostic,
): LanguageServerDiagnosticSeverity {
  if (diagnostic.severity === LSP_DIAGNOSTIC_WARNING) return 'warning'
  if (diagnostic.severity === LSP_DIAGNOSTIC_INFORMATION) return 'information'
  if (diagnostic.severity === LSP_DIAGNOSTIC_HINT) return 'hint'
  if (diagnostic.severity === LSP_DIAGNOSTIC_ERROR) return 'error'
  return 'error'
}

function clampLineNumber(lineNumber: number, lineCount: number): number {
  return Math.min(Math.max(1, lineNumber), lineCount)
}

type DiagnosticMarkerTarget = {
  readonly diagnostic: lsp.Diagnostic
  readonly range: OffsetRange
}

function diagnosticMarkerTarget(
  document: LspTextDocumentSnapshot,
  diagnostics: readonly lsp.Diagnostic[],
  offset: number,
  direction: DiagnosticsPresenterMarkerDirection,
): DiagnosticMarkerTarget | null {
  const targets = diagnostics
    .flatMap((diagnostic) => diagnosticTarget(document, diagnostic))
    .sort((left, right) => compareOffsetRanges(left.range, right.range))
  if (targets.length === 0) return null
  if (direction === 'next') {
    return targets.find((target) => target.range.start > offset) ?? targets[0] ?? null
  }

  return (
    targets.toReversed().find((target) => target.range.start < offset) ?? targets.at(-1) ?? null
  )
}

function diagnosticTarget(
  document: LspTextDocumentSnapshot,
  diagnostic: lsp.Diagnostic,
): readonly DiagnosticMarkerTarget[] {
  const start = lspPositionToOffsetInSnapshot(document, diagnostic.range.start)
  const end = lspPositionToOffsetInSnapshot(document, diagnostic.range.end)
  if (end < start) return []
  return [{ diagnostic, range: { start, end } }]
}

function markerAnchor(range: OffsetRange): LanguageServerDiagnosticMarkerEvent['anchor'] {
  if (range.start === range.end) return { kind: 'point', offset: range.start, bias: 'right' }

  return {
    kind: 'range',
    start: range.start,
    end: range.end,
    startBias: 'right',
    endBias: 'left',
  }
}

function compareOffsetRanges(left: OffsetRange, right: OffsetRange): number {
  return left.start - right.start || left.end - right.end
}
