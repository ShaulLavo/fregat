import type { CellStyle, RenderCell, RgbColor } from '../../core/types.js'

function colorKey(color: RgbColor | undefined): string {
  if (!color) return '-'
  return `${color.r},${color.g},${color.b}`
}

function styleKey(style: CellStyle | undefined): string {
  if (!style) return '-'
  const flags =
    Number(style.blink) |
    (Number(style.bold) << 1) |
    (Number(style.faint) << 2) |
    (Number(style.invisible) << 3) |
    (Number(style.inverse) << 4) |
    (Number(style.italic) << 5) |
    (Number(style.overline) << 6) |
    (Number(style.strikethrough) << 7)
  return `${flags},${style.underline}`
}

export function canvasRowKey(cells: readonly RenderCell[]): string {
  let key = ''
  for (const cell of cells) {
    const flags = Number(cell.continuation) | (Number(cell.selected) << 1)
    // Length framing keeps arbitrary cell text from creating ambiguous row identities.
    key += `${cell.x}/${flags}/${colorKey(cell.foreground)}/${colorKey(cell.background)}/${styleKey(cell.style)}/${cell.text.length}:${cell.text}`
  }
  return key
}
