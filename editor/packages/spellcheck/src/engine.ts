import {
  buildITrieFromWords,
  decodeTrie,
  type ITrie,
  mapDictionaryInformationToWeightMap,
  type SuggestionResult,
  type WeightMap,
} from 'cspell-trie-lib'

type DictionaryInformation = Parameters<typeof mapDictionaryInformationToWeightMap>[0]

export type SpellEngine = {
  isCorrect(word: string): boolean
  /** The words among `words` that are misspelled, each once, in first-seen order. */
  check(words: readonly string[]): readonly string[]
  suggest(word: string, limit: number): readonly string[]
  /** Replaces the accepted list. Accepted words are never misspelled and can be suggested. */
  setAcceptedWords(words: readonly string[]): void
}

export type SpellEngineSource = {
  /** Decompressed tries, in either of cspell-trie-lib's encodings. */
  readonly dictionaries: readonly Uint8Array<ArrayBuffer>[]
  readonly suggestionWeights: DictionaryInformation
}

type Suggestion = { readonly word: string; readonly cost: number }

export function createSpellEngine(source: SpellEngineSource): SpellEngine {
  const tries = source.dictionaries.map((bytes) => decodeTrie(bytes))
  const weightMap = mapDictionaryInformationToWeightMap(source.suggestionWeights)
  let accepted = new Set<string>()
  let acceptedTrie: ITrie | null = null

  const isCorrect = (word: string): boolean => {
    if (accepted.has(word) || accepted.has(word.toLowerCase())) return true
    return tries.some((trie) => inTrie(trie, word))
  }

  return {
    isCorrect,
    check: (words) => [...new Set(words)].filter((word) => !isCorrect(word)),
    suggest(word, limit) {
      const sources = acceptedTrie ? [...tries, acceptedTrie] : tries
      return rankedSuggestions(sources, word, limit, weightMap)
    },
    setAcceptedWords(words) {
      accepted = new Set(words)
      acceptedTrie = words.length === 0 ? null : buildITrieFromWords(words)
    },
  }
}

function inTrie(trie: ITrie, word: string): boolean {
  if (trie.hasWord(word, true)) return true
  if (isCapitalized(word) && trie.hasWord(word.toLowerCase(), true)) return true
  return trie.hasWord(word, false)
}

function rankedSuggestions(
  tries: readonly ITrie[],
  word: string,
  limit: number,
  weightMap: WeightMap,
): readonly string[] {
  const options = { numSuggestions: limit, weightMap, ignoreCase: true }
  const candidates = tries.flatMap((trie) => trie.suggestWithCost(word, options))
  const best = new Map<string, Suggestion>()

  for (const candidate of candidates.toSorted(byCost)) {
    const shaped = matchCase(word, candidate.word)
    const key = shaped.toLowerCase()
    if (key === word.toLowerCase() || best.has(key)) continue
    best.set(key, { word: shaped, cost: candidate.cost })
  }

  return [...best.values()].slice(0, limit).map((suggestion) => suggestion.word)
}

function byCost(left: SuggestionResult, right: SuggestionResult): number {
  return left.cost - right.cost
}

/** A capitalized word at a sentence start should be offered capitalized replacements. */
function matchCase(original: string, suggestion: string): string {
  if (!isCapitalized(original)) return suggestion
  if (suggestion.length === 0 || /[A-Z]/.test(suggestion[0] ?? '')) return suggestion
  return (suggestion[0] ?? '').toUpperCase() + suggestion.slice(1)
}

function isCapitalized(word: string): boolean {
  return /^[A-Z][^A-Z]*$/.test(word)
}
