import { isCombiningMark, isVariationSelector } from './graphemes'
import { RTL_BIDI_CHARACTER } from './virtualization/bidiClassData'
import type { MeasuredText } from './textMeasurements'
import type { TextContent } from './textContent'

export const BIDI_CONTROL_CODE_POINTS = [
  0x061c, 0x200e, 0x200f, 0x202a, 0x202b, 0x202c, 0x202d, 0x202e, 0x2066, 0x2067, 0x2068, 0x2069,
] as const

export function containsRTL(content: TextContent | MeasuredText): boolean {
  if (typeof content !== 'string' && content.measurements) return content.measurements.containsRTL
  const text = contentText(content)
  if (typeof text !== 'string') return text.measurements.containsRTL
  if (RTL_BIDI_CHARACTER.test(text)) return true
  for (const codePoint of BIDI_CONTROL_CODE_POINTS) {
    if (text.includes(String.fromCodePoint(codePoint))) return true
  }
  return false
}

export function isSimpleRowText(content: TextContent | MeasuredText): boolean {
  if (typeof content !== 'string' && content.measurements) return content.measurements.isSimple
  const text = contentText(content)
  if (typeof text !== 'string') return text.measurements.isSimple
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index)
    if (code !== 9 && (code < 32 || code > 126)) return false
  }
  return true
}

function contentText(content: TextContent | MeasuredText): TextContent {
  if (typeof content === 'string') return content
  if ('text' in content) return content.text
  return content
}

export type ControlCharacterInfo = {
  readonly label: string
  readonly widthCells: number
  readonly key: string
}

export function controlCharacterInfo(code: number): ControlCharacterInfo | null {
  if (code === 9) return null
  if (code >= 128 && code <= 159) return c1ControlCharacterInfo(code)
  return null
}

export function oneCellControlCharacterLabel(code: number): string | null {
  // Replacing a tab with a label would lose its CSS tab-stop width.
  if (code === 9) return null
  if (code >= 0 && code <= 31) return String.fromCodePoint(0x2400 + code)
  if (code === 127) return '\u2421'
  return null
}

function c1ControlCharacterInfo(code: number): ControlCharacterInfo {
  const label = `[U+${hexCode(code)}]`
  return {
    label,
    widthCells: label.length,
    key: `U+${hexCode(code)}`,
  }
}

function hexCode(code: number): string {
  return code.toString(16).toUpperCase().padStart(4, '0')
}

function isWideCodePoint(codePoint: number): boolean {
  if (codePoint >= 0x1100 && codePoint <= 0x115f) return true
  if (codePoint >= 0x2329 && codePoint <= 0x232a) return true
  if (codePoint >= 0x2e80 && codePoint <= 0xa4cf) return true
  if (codePoint >= 0xac00 && codePoint <= 0xd7a3) return true
  if (codePoint >= 0xf900 && codePoint <= 0xfaff) return true
  if (codePoint >= 0xfe10 && codePoint <= 0xfe6f) return true
  if (codePoint >= 0xff00 && codePoint <= 0xff60) return true
  if (codePoint >= 0xffe0 && codePoint <= 0xffe6) return true
  return codePoint >= 0x1f300 && codePoint <= 0x1faff
}

export function estimatedCodePointWidth(codePoint: number): number {
  const control = controlCharacterInfo(codePoint)
  if (control) return control.widthCells
  if (isCombiningMark(codePoint) || isVariationSelector(codePoint)) return 0
  return isWideCodePoint(codePoint) ? 2 : 1
}
