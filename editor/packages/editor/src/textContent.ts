import type { TextMeasurements } from './textMeasurements'

export type TextContent = string | RangeText

export class RangeText {
  constructor(
    readonly length: number,
    private readonly readRange: (start: number, end: number) => string,
    readonly measurements: TextMeasurements,
    private readonly onCodeUnitsRead?: (count: number) => void,
  ) {}

  slice(start = 0, end = this.length): string {
    const from = sliceOffset(start, this.length)
    const to = sliceOffset(end, this.length)
    return this.readRange(from, Math.max(from, to))
  }

  charCodeAt(offset: number): number {
    const index = textOffset(offset)
    if (index < 0 || index >= this.length) return Number.NaN
    this.onCodeUnitsRead?.(1)
    return this.measurements.codeUnitAt(index)
  }

  charAt(offset: number): string {
    const index = textOffset(offset)
    if (index < 0 || index >= this.length) return ''
    return String.fromCharCode(this.charCodeAt(index))
  }

  codePointAt(offset: number): number | undefined {
    const index = textOffset(offset)
    if (index < 0 || index >= this.length) return undefined
    const first = this.charCodeAt(index)
    if (first < 0xd800 || first > 0xdbff || index + 1 === this.length) return first
    const next = this.charCodeAt(index + 1)
    if (next < 0xdc00 || next > 0xdfff) return first
    return 0x10000 + ((first - 0xd800) << 10) + next - 0xdc00
  }

  sliceContent(start: number, end: number): RangeText {
    const from = sliceOffset(start, this.length)
    const to = Math.max(from, sliceOffset(end, this.length))
    return new RangeText(
      to - from,
      (rangeStart, rangeEnd) => this.slice(from + rangeStart, from + rangeEnd),
      this.measurements.slice(from, to),
      this.onCodeUnitsRead,
    )
  }
}

export function sliceTextContent(text: TextContent, start: number, end: number): TextContent {
  if (typeof text === 'string') return text.slice(start, end)
  return text.sliceContent(start, end)
}

function sliceOffset(offset: number, length: number): number {
  const integer = textOffset(offset)
  if (integer < 0) return Math.max(0, length + integer)
  return Math.min(length, integer)
}

function textOffset(offset: number): number {
  return Number.isNaN(offset) ? 0 : Math.trunc(offset)
}
