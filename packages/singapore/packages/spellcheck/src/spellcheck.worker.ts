import { ENGLISH_DICTIONARIES } from './dictionaryAssets'
import { loadSpellEngineSource } from './dictionaryData'
import { createSpellEngine, type SpellEngine } from './engine'
import type { SpellcheckWorkerRequest, SpellcheckWorkerResponse } from './protocol'

const scope = self as unknown as DedicatedWorkerGlobalScope
// Every request waits on the one load, so requests are answered in the order they were posted.
const engine: Promise<SpellEngine> =
  loadSpellEngineSource(ENGLISH_DICTIONARIES).then(createSpellEngine)

scope.onmessage = (event: MessageEvent<SpellcheckWorkerRequest>) => {
  const request = event.data
  engine.then(
    (loaded) => respond(loaded, request),
    (error: unknown) =>
      post({ type: 'error', id: requestId(request), message: errorMessage(error) }),
  )
}

function respond(loaded: SpellEngine, request: SpellcheckWorkerRequest): void {
  if (request.type === 'setAcceptedWords') {
    loaded.setAcceptedWords(request.words)
    return
  }
  if (request.type === 'check') {
    post({ type: 'check', id: request.id, misspelled: loaded.check(request.words) })
    return
  }
  post({
    type: 'suggest',
    id: request.id,
    suggestions: loaded.suggest(request.word, request.limit),
  })
}

function requestId(request: SpellcheckWorkerRequest): number | null {
  return request.type === 'setAcceptedWords' ? null : request.id
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function post(response: SpellcheckWorkerResponse): void {
  scope.postMessage(response)
}
