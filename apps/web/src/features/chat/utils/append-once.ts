/** Appends `text` at the end, separated by a space, unless the text already ends with it. */
export function appendOnce(current: string, text: string) {
  const trimmed = current.trimEnd()
  const start = trimmed.length - text.length
  const endsWithText =
    start >= 0 &&
    trimmed.slice(start) === text &&
    (start === 0 || /\s/.test(trimmed[start - 1] ?? ''))
  if (endsWithText) return current

  return `${current}${current.length > 0 && !/\s$/.test(current) ? ' ' : ''}${text}`
}
