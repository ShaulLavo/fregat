import type { EditorVisibleSnapshotJSON } from '@singapore-editor/core/editor'
import {
  captureTokenPaint,
  tokenPaintMismatch,
  type TokenPaintObservation,
  type TokenPaintReference,
} from '../../../../scripts/agent/scenarios/editor-tab-hover-highlights-probe'

export type RetentionAcceptanceBinding = {
  readonly identity: TokenPaintReference['identity']
  readonly source: string
  readonly editorTextVersion: number
  readonly presentation: 'live' | 'saved'
}

type ProjectedChunk = {
  readonly originalStart: number
  readonly originalEnd: number
  readonly projectedStart: number
}

export function retentionAcceptanceProjection(input: {
  readonly metadata: EditorVisibleSnapshotJSON
  readonly binding: RetentionAcceptanceBinding
  readonly reference: TokenPaintReference
}) {
  const { metadata, binding, reference } = input
  if (binding.presentation !== 'live')
    return { kind: 'unsupported', why: 'saved mapping is not independently calibrated' } as const
  if (JSON.stringify(binding.identity) !== JSON.stringify(reference.identity))
    return { kind: 'unsupported', why: 'source or configuration identity' } as const
  if (binding.source !== reference.source || metadata.documentId !== binding.identity.document)
    return { kind: 'unsupported', why: 'canonical source document' } as const
  if (metadata.textVersion !== binding.editorTextVersion)
    return { kind: 'unsupported', why: 'captured editor text version' } as const
  const count = metadata.totalHeight / metadata.metrics.rowHeight
  if (!Number.isSafeInteger(count) || count <= 0)
    return { kind: 'unsupported', why: 'nonuniform display geometry' } as const
  const lines = Array<string>(count).fill('')
  const chunks = new Map<number, readonly ProjectedChunk[]>()
  const seen = new Set<number>()
  for (const row of metadata.rows) {
    if (
      row.source !== 'document' ||
      row.height !== metadata.metrics.rowHeight ||
      row.leftSpacerWidth !== 0
    )
      return {
        kind: 'unsupported',
        why: 'injected, variable-height or horizontal-window row',
      } as const
    if (
      row.index < 0 ||
      row.index >= count ||
      seen.has(row.index) ||
      row.top !== row.index * row.height
    )
      return { kind: 'unsupported', why: 'duplicate or inconsistent display row' } as const
    seen.add(row.index)
    const result = projectRow(row, reference.source)
    if (!result)
      return { kind: 'unsupported', why: 'transformed or inconsistent source chunk' } as const
    lines[row.index] = result.text
    chunks.set(row.index, result.chunks)
  }
  const source = lines.join('\n')
  const starts: number[] = []
  let offset = 0
  for (const line of lines) {
    starts.push(offset)
    offset += line.length + 1
  }
  const runs = [...chunks].flatMap(([index, parts]) =>
    parts.flatMap((part) => {
      const rowStart = starts[index]
      if (rowStart === undefined) return []
      return reference.runs.flatMap((run) => {
        const start = Math.max(run.start, part.originalStart)
        const end = Math.min(run.end, part.originalEnd)
        if (start >= end) return []
        const projectedStart = rowStart + part.projectedStart + start - part.originalStart
        return [
          {
            ...run,
            start: projectedStart,
            end: projectedStart + end - start,
            text: reference.source.slice(start, end),
          },
        ]
      })
    }),
  )
  const projectedReference: TokenPaintReference = { ...reference, source, runs }
  return { kind: 'mapped', binding, metadata, reference: projectedReference, chunks } as const
}

function projectRow(row: EditorVisibleSnapshotJSON['rows'][number], source: string) {
  let text = ''
  const chunks: ProjectedChunk[] = []
  for (const chunk of row.chunks) {
    if (chunk.replayFidelity !== 'exact' || chunk.rowLocalStart !== text.length) return null
    if (chunk.parts.some((part) => part.kind !== 'text')) return null
    const actual = chunk.parts.map((part) => part.text).join('')
    if (actual !== source.slice(chunk.sourceStartOffset, chunk.sourceEndOffset)) return null
    if (actual.includes('\n') || actual.length !== chunk.rowLocalEnd - chunk.rowLocalStart)
      return null
    chunks.push({
      originalStart: chunk.sourceStartOffset,
      originalEnd: chunk.sourceEndOffset,
      projectedStart: text.length,
    })
    text += actual
  }
  return { text, chunks }
}

export function captureRetentionAcceptanceProjection(input: {
  readonly projection: Extract<
    ReturnType<typeof retentionAcceptanceProjection>,
    { readonly kind: 'mapped' }
  >
  readonly viewportSelector: string
  readonly observedIdentity: TokenPaintReference['identity']
}) {
  const raw = captureTokenPaint({
    source: input.projection.reference.source,
    viewportSelector: input.viewportSelector,
    rowSelector: '.editor-virtualized-row',
    excludedLayers:
      '.editor-virtualized-selection-layer,.editor-virtualized-hidden-character-layer,.editor-virtualized-fold-placeholder,.editor-virtualized-gutter-row',
    highlightPrefix: 'editor-shared-token-',
  })
  const count = input.projection.reference.source.split('\n').length
  const frame: TokenPaintObservation = {
    ...raw,
    window: raw.window
      ? { start: Math.min(raw.window.start, count), end: Math.min(raw.window.end, count) }
      : null,
    identity: input.observedIdentity,
  }
  return frame
}

export function retentionAcceptanceFoldMismatch(
  projection: Extract<
    ReturnType<typeof retentionAcceptanceProjection>,
    { readonly kind: 'mapped' }
  >,
  viewportSelector: string,
) {
  const viewport = document.querySelector<HTMLElement>(viewportSelector)
  if (!viewport) return 'missing fold viewport'
  for (const metadata of projection.metadata.rows) {
    const row =
      projection.binding.presentation === 'live'
        ? viewport.querySelector<HTMLElement>(`[data-editor-virtual-row="${metadata.index}"]`)
        : [...viewport.querySelectorAll<HTMLElement>('[data-editor-provisional-row]')].find(
            (candidate) => Number.parseFloat(candidate.style.top) === metadata.top,
          )
    if (!row) continue
    const placeholder = row.querySelector<HTMLElement>('.editor-virtualized-fold-placeholder')
    const collapsed = metadata.foldMarker?.collapsed === true
    if (collapsed !== Boolean(placeholder?.checkVisibility())) return 'fold placeholder presence'
    if (
      collapsed &&
      projection.binding.presentation === 'live' &&
      placeholder?.dataset.editorFoldPlaceholder !== metadata.foldMarker?.key
    )
      return 'fold placeholder identity'
  }
  return null
}

export function retentionAcceptanceProjectionMismatch(
  frame: TokenPaintObservation,
  projection: Extract<
    ReturnType<typeof retentionAcceptanceProjection>,
    { readonly kind: 'mapped' }
  >,
) {
  if (frame.rows.some((row) => row.presentation !== projection.binding.presentation))
    return 'presentation provenance'
  const normalized = {
    ...frame,
    rows: frame.rows.map((row) => ({ ...row, presentation: 'live' as const })),
  }
  return tokenPaintMismatch(normalized, projection.reference)
}
