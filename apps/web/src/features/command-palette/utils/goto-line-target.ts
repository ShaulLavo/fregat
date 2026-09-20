/**
 * A `:line[:column]` quick-access target.
 *
 * Line and column are what the user typed — one-based, the numbers shown in the gutter — because
 * this is the only place those numbers are entered by hand. They become zero-based at the
 * navigation boundary, not here.
 */
export type GotoLineTarget = {
  readonly line: number
  readonly column: number
}

/**
 * Parses the text after `:`. Returns null for anything that is not a line number, so an
 * in-progress `:` shows no target rather than a wrong one.
 *
 * A column past the end of the line is not rejected: the editor clamps it, and refusing to move
 * would be worse than landing at the line end.
 */
export function parseGotoLineTarget(query: string): GotoLineTarget | null {
  const trimmed = query.trim()
  if (trimmed.length === 0) return null

  const [lineText, columnText, ...rest] = trimmed.split(':')
  if (rest.length > 0) return null

  const line = parsePositiveInteger(lineText)
  if (line === null) return null

  if (columnText === undefined) return { column: 1, line }

  const column = parsePositiveInteger(columnText)
  if (column === null) return null

  return { column, line }
}

/** Human-readable summary of where the target will land, for the palette row. */
export function gotoLineTargetLabel(target: GotoLineTarget): string {
  if (target.column === 1) return `Go to line ${target.line}`

  return `Go to line ${target.line}, column ${target.column}`
}

function parsePositiveInteger(text: string | undefined): number | null {
  if (text === undefined) return null

  const trimmed = text.trim()
  // Number() accepts '', '0x10', and '1e3'; a gutter number is plain digits.
  if (!/^\d+$/.test(trimmed)) return null

  const value = Number(trimmed)
  return value > 0 ? value : null
}
