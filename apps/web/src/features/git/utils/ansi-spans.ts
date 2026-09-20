/** An ANSI palette slot (0–15), or an exact color from the 256 table or truecolor. */
export type AnsiRgb = { readonly r: number; readonly g: number; readonly b: number }
export type AnsiColor = number | AnsiRgb

export type AnsiSpan = {
  readonly text: string
  readonly color?: AnsiColor
  readonly bold: boolean
  readonly dim: boolean
  readonly italic: boolean
  readonly underline: boolean
}

type AnsiStyle = Omit<AnsiSpan, 'text'>

const PLAIN: AnsiStyle = { bold: false, dim: false, italic: false, underline: false }

// CSI sequences, OSC strings, and two-byte escapes. Only SGR (`…m`) is interpreted.
// eslint-disable-next-line no-control-regex
const ESCAPE = /\x1b\[([0-9;:]*)([@-~])|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[@-Z\\-_]/g

const CUBE_LEVELS = [0, 95, 135, 175, 215, 255] as const

/** One line of process output as styled runs. Style resets at the line's start. */
export function ansiSpans(line: string): AnsiSpan[] {
  const spans: AnsiSpan[] = []
  let style = PLAIN
  let cursor = 0

  for (const match of line.matchAll(ESCAPE)) {
    pushSpan(spans, line.slice(cursor, match.index), style)
    cursor = match.index + match[0].length
    if (match[2] === 'm') style = applySgr(style, match[1] ?? '')
  }
  pushSpan(spans, line.slice(cursor), style)

  return spans
}

function pushSpan(spans: AnsiSpan[], text: string, style: AnsiStyle) {
  if (text.length > 0) spans.push({ ...style, text })
}

function applySgr(style: AnsiStyle, parameters: string): AnsiStyle {
  const codes = parameters.split(/[;:]/).map((code) => Number(code || 0))
  let next = style

  for (let index = 0; index < codes.length; index += 1) {
    const code = codes[index] ?? 0
    if (code === 38) {
      const extended = extendedColor(codes, index + 1)
      next = { ...next, color: extended.color }
      index += extended.consumed
      continue
    }
    // Backgrounds are skipped whole, so their operands are not read as codes.
    if (code === 48) {
      index += extendedColor(codes, index + 1).consumed
      continue
    }

    next = applyCode(next, code)
  }

  return next
}

function applyCode(style: AnsiStyle, code: number): AnsiStyle {
  if (code === 0) return PLAIN
  if (code === 1) return { ...style, bold: true }
  if (code === 2) return { ...style, dim: true }
  if (code === 3) return { ...style, italic: true }
  if (code === 4) return { ...style, underline: true }
  if (code === 22) return { ...style, bold: false, dim: false }
  if (code === 23) return { ...style, italic: false }
  if (code === 24) return { ...style, underline: false }
  if (code === 39) return { ...style, color: undefined }
  if (code >= 30 && code <= 37) return { ...style, color: code - 30 }
  if (code >= 90 && code <= 97) return { ...style, color: code - 90 + 8 }

  return style
}

function extendedColor(codes: readonly number[], start: number) {
  const mode = codes[start]
  if (mode === 5) return { color: indexedColor(codes[start + 1] ?? 0), consumed: 2 }
  if (mode !== 2) return { color: undefined, consumed: 0 }

  const color = { r: codes[start + 1] ?? 0, g: codes[start + 2] ?? 0, b: codes[start + 3] ?? 0 }
  return { color, consumed: 4 }
}

function indexedColor(index: number): AnsiColor {
  if (index < 16) return index
  if (index >= 232) {
    const level = 8 + (index - 232) * 10
    return { r: level, g: level, b: level }
  }

  const cube = index - 16
  return {
    r: CUBE_LEVELS[Math.floor(cube / 36)] ?? 0,
    g: CUBE_LEVELS[Math.floor(cube / 6) % 6] ?? 0,
    b: CUBE_LEVELS[cube % 6] ?? 0,
  }
}
