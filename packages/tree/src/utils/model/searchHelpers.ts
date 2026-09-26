// Modified for Platform from Pierre. Apache-2.0; see LICENSE-pierre and UPSTREAM.md.
export const normalizeSearchQuery = (value: string): string => {
  const trimmedValue = value.trim()
  if (trimmedValue.length === 0) {
    return ''
  }

  const normalizedSeparators = trimmedValue.includes('\\')
    ? trimmedValue.replaceAll('\\', '/')
    : trimmedValue
  return normalizedSeparators.toLowerCase()
}
