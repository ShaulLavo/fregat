const SEARCH_PREVIEW_MAX_CHARACTERS = 96
const SEARCH_PREVIEW_MIN_CHARACTERS = 16

/** How many characters of a match line fit a preview cell of `cellWidth` pixels. */
export function searchPreviewMaxLength(cellWidth: number, glyphWidth: number) {
  if (!Number.isFinite(cellWidth) || glyphWidth <= 0) return undefined

  const visibleCharacters = Math.floor(cellWidth / glyphWidth)
  return Math.min(
    SEARCH_PREVIEW_MAX_CHARACTERS,
    Math.max(SEARCH_PREVIEW_MIN_CHARACTERS, visibleCharacters),
  )
}
