import type {
  EditorMountedChunkPaintPartJSON,
  EditorVisiblePaintChunkJSON,
  EditorVisibleSnapshotJSON,
} from '@singapor/core'

export type EditorVisibleSnapshotTextStyle = {
  readonly backgroundColor?: string
  readonly color?: string
  readonly textDecoration?: string
}

export type EditorVisibleSnapshotSegment =
  | {
      readonly kind: 'text'
      readonly style: EditorVisibleSnapshotTextStyle | null
      readonly text: string
    }
  | Extract<EditorMountedChunkPaintPartJSON, { readonly kind: 'control' | 'refusal' }>

export type EditorVisibleSnapshotCounts = {
  readonly chunks: number
  readonly foldMarkers: number
  readonly parts: number
  readonly paintLayers: number
  readonly paintRectangles: number
  readonly rows: number
  readonly runs: number
}

export const EDITOR_VISIBLE_SNAPSHOT_FOLD_CHEVRON_PATH =
  'M216.49,104.49l-80,80a12,12,0,0,1-17,0l-80-80a12,12,0,0,1,17-17L128,159l71.51-71.52a12,12,0,0,1,17,17Z'

export type EditorVisibleSnapshotSegmentPresentation = {
  readonly className?: string
  readonly style?: EditorVisibleSnapshotTextStyle & { readonly width?: number }
}

/** Splits one bounded mounted chunk into the spans the inert renderer paints. */
export function editorVisibleSnapshotSegments(
  chunk: EditorVisiblePaintChunkJSON,
): readonly EditorVisibleSnapshotSegment[] {
  if (chunk.runs.length === 0) return chunk.parts.map(segmentWithoutSyntax)

  const segments: EditorVisibleSnapshotSegment[] = []
  let textOffset = 0
  let runIndex = 0

  for (const part of chunk.parts) {
    if (part.kind !== 'text') {
      segments.push(part)
      continue
    }

    const partStart = textOffset
    const partEnd = partStart + part.text.length
    let cursor = partStart
    while (runIndex < chunk.runs.length && chunk.runs[runIndex]!.end <= partStart) runIndex += 1

    let localRunIndex = runIndex
    while (localRunIndex < chunk.runs.length) {
      const run = chunk.runs[localRunIndex]!
      if (run.start >= partEnd) break

      const runStart = Math.max(cursor, run.start)
      const runEnd = Math.min(partEnd, run.end)
      if (runStart > cursor) pushTextSegment(segments, part.text, cursor, runStart, partStart, null)
      if (runEnd > runStart) {
        pushTextSegment(segments, part.text, runStart, runEnd, partStart, run.style)
      }
      cursor = Math.max(cursor, runEnd)
      if (run.end > partEnd) break
      localRunIndex += 1
    }

    if (cursor < partEnd) pushTextSegment(segments, part.text, cursor, partEnd, partStart, null)
    textOffset = partEnd
    runIndex = localRunIndex
  }

  return segments
}

export function editorVisibleSnapshotSegmentPresentation(
  segment: EditorVisibleSnapshotSegment,
  characterWidth: number,
): EditorVisibleSnapshotSegmentPresentation {
  if (segment.kind === 'control') {
    return {
      className: 'editor-virtualized-control-character',
      style: { width: segment.widthCells * characterWidth },
    }
  }
  if (segment.kind === 'refusal') return { className: 'editor-virtualized-bidi-ceiling' }
  if (!segment.style) return {}

  return { style: segment.style }
}

export function editorVisibleSnapshotCounts(
  snapshot: EditorVisibleSnapshotJSON,
): EditorVisibleSnapshotCounts {
  let chunks = 0
  let foldMarkers = 0
  let parts = 0
  let runs = 0

  for (const row of snapshot.rows) {
    chunks += row.chunks.length
    if (row.foldMarker) foldMarkers += 1
    for (const chunk of row.chunks) {
      parts += chunk.parts.length
      runs += chunk.runs.length
    }
  }

  return {
    chunks,
    foldMarkers,
    parts,
    paintLayers: snapshot.paintLayers.length,
    paintRectangles: snapshot.paintLayers.reduce(
      (count, layer) => count + layer.rectangles.length,
      0,
    ),
    rows: snapshot.rows.length,
    runs,
  }
}

function segmentWithoutSyntax(part: EditorMountedChunkPaintPartJSON): EditorVisibleSnapshotSegment {
  if (part.kind !== 'text') return part

  return { kind: 'text', style: null, text: part.text }
}

function pushTextSegment(
  segments: EditorVisibleSnapshotSegment[],
  text: string,
  start: number,
  end: number,
  partStart: number,
  style: EditorVisibleSnapshotTextStyle | null,
): void {
  if (end <= start) return

  segments.push({
    kind: 'text',
    style,
    text: text.slice(start - partStart, end - partStart),
  })
}
