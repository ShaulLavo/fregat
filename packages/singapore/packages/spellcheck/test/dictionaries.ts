import { readFileSync } from 'node:fs'
import { gunzipSync } from 'node:zlib'
import suggestionWeights from '../src/dictionaries/suggestion-weights.json'
import type { SpellEngineSource } from '../src/engine'

const DICTIONARIES = ['english.trie.gz']

export function readDictionary(name: string): Uint8Array<ArrayBuffer> {
  return new Uint8Array(readFileSync(new URL(`../src/dictionaries/${name}`, import.meta.url)))
}

/** The bundled dictionaries, read from disk: what the worker fetches, without a worker. */
export function bundledEngineSource(): SpellEngineSource {
  const dictionaries = DICTIONARIES.map((name) => new Uint8Array(gunzipSync(readDictionary(name))))
  return { dictionaries, suggestionWeights }
}
