export function nonEmptyText(value: string | null | undefined) {
  const text = value?.trim()

  return text ? text : null
}

export function normalizeText(value: string) {
  return value.trim().toLowerCase()
}

export function lineStartOffset(text: string, targetLine: number): number | null {
  let line = 0
  let lineStart = 0
  for (let index = 0; index < text.length; index += 1) {
    if (line >= targetLine) break
    if (text[index] !== '\n') continue
    line += 1
    lineStart = index + 1
  }
  return line < targetLine ? null : lineStart
}
