/** Tool input pretty-printed when it is a JSON object or array, else null. */
export function prettyJsonInput(value: string) {
  const trimmed = value.trim()
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return null

  try {
    return JSON.stringify(JSON.parse(trimmed), null, 2)
  } catch {
    return null
  }
}
