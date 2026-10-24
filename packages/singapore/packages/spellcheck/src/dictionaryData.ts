import type { SpellEngineSource } from './engine'

export type SpellDictionaryUrls = {
  readonly dictionaries: readonly string[]
  readonly suggestionWeights: SpellEngineSource['suggestionWeights']
}

/** Fetches and inflates each dictionary. Every fetch starts before any is awaited. */
export async function loadSpellEngineSource(urls: SpellDictionaryUrls): Promise<SpellEngineSource> {
  const dictionaries = await Promise.all(urls.dictionaries.map(fetchDictionary))
  return { dictionaries, suggestionWeights: urls.suggestionWeights }
}

async function fetchDictionary(url: string): Promise<Uint8Array<ArrayBuffer>> {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`Spellcheck dictionary failed to load: HTTP ${response.status}`)
  return inflateDictionary(new Uint8Array(await response.arrayBuffer()))
}

/**
 * A server that labels `.gz` files `Content-Encoding: gzip` hands fetch the inflated bytes, so the
 * gzip magic number decides whether there is anything left to inflate.
 */
export async function inflateDictionary(
  bytes: Uint8Array<ArrayBuffer>,
): Promise<Uint8Array<ArrayBuffer>> {
  if (bytes[0] !== 0x1f || bytes[1] !== 0x8b) return bytes

  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}
