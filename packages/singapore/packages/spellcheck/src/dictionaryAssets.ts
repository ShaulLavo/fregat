import english from './dictionaries/english.trie.gz?url'
import suggestionWeights from './dictionaries/suggestion-weights.json'
import type { SpellDictionaryUrls } from './dictionaryData'

/** US and British spellings are both accepted, with software vocabulary on top. */
export const ENGLISH_DICTIONARIES: SpellDictionaryUrls = {
  dictionaries: [english],
  suggestionWeights,
}
