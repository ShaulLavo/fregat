import { shikiLanguageForDocument } from '@singapore-editor/core/shiki'
import { EDITOR_SHIKI_LANGUAGE_MAP } from '@/features/editor/utils/shiki-languages'
import { languageIdForFilePath } from '@/lib/file-language'

const PRELOAD_FILE_SHARE = 0.005

export function shikiGrammarsForCensus(
  counts: Readonly<Record<string, number>>,
): readonly string[] {
  const grammars = new Map<string, number>()
  let total = 0
  for (const [key, count] of Object.entries(counts)) {
    total += count
    const grammar = shikiLanguageForDocument(
      { documentId: key, languageId: languageIdForFilePath(key) },
      EDITOR_SHIKI_LANGUAGE_MAP,
    )
    if (grammar) grammars.set(grammar, (grammars.get(grammar) ?? 0) + count)
  }
  return [...grammars]
    .filter(([, count]) => count > 0 && count >= total * PRELOAD_FILE_SHARE)
    .map(([grammar]) => grammar)
}
