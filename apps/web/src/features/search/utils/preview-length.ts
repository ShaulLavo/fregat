const SEARCH_PREVIEW_MAX_CHARACTERS = 96
const SEARCH_PREVIEW_MIN_CHARACTERS = 16
const SEARCH_RESULT_CHARACTER_WIDTH = 7
const SEARCH_RESULT_ROW_CHROME_WIDTH = 84
const SEARCH_RESULT_REPLACE_WIDTH = 62

export function searchPreviewMaxLength(width: number | null, replaceVisible: boolean | undefined) {
  if (width === null) return undefined

  const replaceWidth = replaceVisible ? SEARCH_RESULT_REPLACE_WIDTH : 0
  const availableWidth = width - SEARCH_RESULT_ROW_CHROME_WIDTH - replaceWidth
  const visibleCharacters = Math.floor(availableWidth / SEARCH_RESULT_CHARACTER_WIDTH)

  return Math.min(
    SEARCH_PREVIEW_MAX_CHARACTERS,
    Math.max(SEARCH_PREVIEW_MIN_CHARACTERS, visibleCharacters),
  )
}
