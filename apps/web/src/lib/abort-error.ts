export function isAbortError(error: unknown) {
  if (error instanceof DOMException) return error.name === 'AbortError'
  if (error instanceof Error) return error.name === 'AbortError'

  return false
}
