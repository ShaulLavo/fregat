import type { VirtualizedTextRowDecoration } from '@singapore-editor/core/rendering'
import type { EditorInjectedTextRow } from '@singapore-editor/core/extensions'
import type { DiffFile, DiffHunk, DiffHunkLine, DiffRenderRow } from './types'

export type LiveDiffProjection = {
  readonly injectedRows: readonly EditorInjectedTextRow[]
  readonly rowDecorations: ReadonlyMap<number, VirtualizedTextRowDecoration>
  readonly rows: readonly DiffRenderRow[]
  readonly rowsByBufferRow: ReadonlyMap<number, DiffRenderRow>
}

const DIFF_ROW_CLASS = 'editor-diff-row'
const DIFF_GUTTER_ROW_CLASS = 'editor-diff-gutter-row'

export function createLiveDiffProjection(file: DiffFile): LiveDiffProjection {
  const builder = new LiveDiffProjectionBuilder(file)
  return builder.create()
}

class LiveDiffProjectionBuilder {
  private readonly injectedRows: EditorInjectedTextRow[] = []
  private readonly rowDecorations = new Map<number, VirtualizedTextRowDecoration>()
  private readonly rows: DiffRenderRow[] = []
  private readonly rowsByBufferRow = new Map<number, DiffRenderRow>()
  private order = 0

  constructor(private readonly file: DiffFile) {}

  create(): LiveDiffProjection {
    let previousOldEnd = 0
    let previousNewEnd = 0

    for (const [hunkIndex, hunk] of this.file.hunks.entries()) {
      this.appendUnchangedRows(previousOldEnd + 1, hunk.oldStart - 1, previousNewEnd + 1)
      this.appendHunkRows(hunk, hunkIndex)
      previousOldEnd = hunkEndLine(hunk.oldStart, hunk.oldLines)
      previousNewEnd = hunkEndLine(hunk.newStart, hunk.newLines)
    }

    const nextNewLineNumber = this.appendUnchangedRows(
      previousOldEnd + 1,
      this.file.oldLines.length,
      previousNewEnd + 1,
    )
    this.appendTrailingAdditionRows(nextNewLineNumber)
    return {
      injectedRows: this.injectedRows,
      rowDecorations: this.rowDecorations,
      rows: this.rows,
      rowsByBufferRow: this.rowsByBufferRow,
    }
  }

  private appendUnchangedRows(oldStart: number, oldEnd: number, newStart: number): number {
    let oldLineNumber = oldStart
    let newLineNumber = newStart
    while (oldLineNumber <= oldEnd && newLineNumber <= this.file.newLines.length) {
      this.appendDocumentRow({
        type: 'context',
        text: this.file.newLines[newLineNumber - 1] ?? '',
        oldLineNumber,
        newLineNumber,
      })
      oldLineNumber += 1
      newLineNumber += 1
    }

    return newLineNumber
  }

  private appendHunkRows(hunk: DiffHunk, hunkIndex: number): void {
    let lastNewLineNumber = hunk.newStart - 1
    for (const [lineIndex, line] of hunk.lines.entries()) {
      if (line.type === 'deletion') {
        this.appendInjectedDeletion(line, hunkIndex, lineIndex, lastNewLineNumber, hunk)
        continue
      }

      this.appendDocumentRow(renderRowFromHunkLine(line, hunkIndex))
      if (line.type === 'addition') this.decorateDocumentRow(line.newLineNumber, 'addition')
      lastNewLineNumber = line.newLineNumber ?? lastNewLineNumber
    }
  }

  private appendInjectedDeletion(
    line: DiffHunkLine,
    hunkIndex: number,
    lineIndex: number,
    lastNewLineNumber: number,
    hunk: DiffHunk,
  ): void {
    const row = renderRowFromHunkLine(line, hunkIndex)
    const anchor = deletionAnchor(this.file, hunk, lineIndex, lastNewLineNumber)
    this.rows.push(row)
    this.injectedRows.push({
      id: deletionRowId(row, hunkIndex, lineIndex),
      anchorBufferRow: anchor.bufferRow,
      placement: anchor.placement,
      text: line.text,
      order: this.order,
      className: rowClassName('deletion'),
      gutterClassName: gutterRowClassName('deletion'),
      metadata: row,
    })
    this.order += 1
  }

  private appendDocumentRow(row: DiffRenderRow): void {
    this.rows.push(row)
    if (row.newLineNumber === undefined) return

    this.rowsByBufferRow.set(row.newLineNumber - 1, row)
  }

  private appendTrailingAdditionRows(newStart: number): void {
    for (
      let newLineNumber = newStart;
      newLineNumber <= this.file.newLines.length;
      newLineNumber += 1
    ) {
      const row: DiffRenderRow = {
        type: 'addition',
        text: this.file.newLines[newLineNumber - 1] ?? '',
        newLineNumber,
      }
      this.appendDocumentRow(row)
      this.decorateDocumentRow(newLineNumber, 'addition')
    }
  }

  private decorateDocumentRow(lineNumber: number | undefined, type: 'addition' | 'deletion'): void {
    if (lineNumber === undefined) return

    this.rowDecorations.set(lineNumber - 1, {
      className: rowClassName(type),
      gutterClassName: gutterRowClassName(type),
    })
  }
}

function renderRowFromHunkLine(line: DiffHunkLine, hunkIndex: number): DiffRenderRow {
  return {
    type: line.type,
    text: line.text,
    oldLineNumber: line.oldLineNumber,
    newLineNumber: line.newLineNumber,
    hunkIndex,
  }
}

function deletionAnchor(
  file: DiffFile,
  hunk: DiffHunk,
  lineIndex: number,
  lastNewLineNumber: number,
): { readonly bufferRow: number; readonly placement: 'before' | 'after' } {
  const nextNewLineNumber = nextHunkNewLineNumber(hunk.lines, lineIndex + 1)
  if (nextNewLineNumber !== undefined) {
    return { bufferRow: clampBufferRow(file, nextNewLineNumber - 1), placement: 'before' }
  }

  if (file.newLines.length === 0) return { bufferRow: 0, placement: 'before' }
  return { bufferRow: clampBufferRow(file, lastNewLineNumber - 1), placement: 'after' }
}

function nextHunkNewLineNumber(
  lines: readonly DiffHunkLine[],
  startIndex: number,
): number | undefined {
  for (let index = startIndex; index < lines.length; index += 1) {
    const newLineNumber = lines[index]?.newLineNumber
    if (newLineNumber !== undefined) return newLineNumber
  }

  return undefined
}

function clampBufferRow(file: DiffFile, row: number): number {
  return Math.max(0, Math.min(row, Math.max(0, file.newLines.length - 1)))
}

function hunkEndLine(start: number, count: number): number {
  if (count <= 0) return Math.max(0, start)
  return start + count - 1
}

function rowClassName(type: 'addition' | 'deletion'): string {
  return `${DIFF_ROW_CLASS} ${DIFF_ROW_CLASS}-${type}`
}

function gutterRowClassName(type: 'addition' | 'deletion'): string {
  return `${DIFF_GUTTER_ROW_CLASS} ${DIFF_GUTTER_ROW_CLASS}-${type}`
}

function deletionRowId(row: DiffRenderRow, hunkIndex: number, lineIndex: number): string {
  if (row.oldLineNumber !== undefined) return `diff-delete-old-${row.oldLineNumber}`
  return `diff-delete-${hunkIndex}-${lineIndex}`
}
