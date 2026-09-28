import { shikiLanguageForDocument } from '@singapore-editor/core/shiki'
import { EDITOR_SHIKI_LANGUAGE_MAP } from '@/features/editor/utils/shiki-languages'
import { languageIdForFilePath, treeSitterLanguageId } from '@/lib/file-language'

const PRELOAD_FILE_SHARE = 0.005

export function shikiGrammarsForCensus(
  counts: Readonly<Record<string, number>>,
): readonly string[] {
  return languagesAboveFloor(counts, (key) =>
    shikiLanguageForDocument(
      { documentId: key, languageId: languageIdForFilePath(key) },
      EDITOR_SHIKI_LANGUAGE_MAP,
    ),
  )
}

export function treeSitterLanguagesForCensus(
  counts: Readonly<Record<string, number>>,
): readonly string[] {
  return languagesAboveFloor(counts, (key) => {
    const languageId = languageIdForFilePath(key)
    return languageId ? treeSitterLanguageId(languageId) : null
  })
}

// Aliases aggregate before the floor; unsupported keys still count in the denominator.
function languagesAboveFloor(
  counts: Readonly<Record<string, number>>,
  languageForKey: (key: string) => string | null | undefined,
): readonly string[] {
  const languages = new Map<string, number>()
  let total = 0
  for (const [key, count] of Object.entries(counts)) {
    total += count
    const language = languageForKey(key)
    if (language) languages.set(language, (languages.get(language) ?? 0) + count)
  }
  return [...languages]
    .filter(([, count]) => count > 0 && count >= total * PRELOAD_FILE_SHARE)
    .map(([language]) => language)
}
