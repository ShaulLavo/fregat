import { createTypeScriptLanguageSession } from './worker/session'

const workerGlobal = globalThis as unknown as DedicatedWorkerGlobalScope
const session = createTypeScriptLanguageSession({
  post: (message) => workerGlobal.postMessage(message),
})
workerGlobal.onmessage = (event: MessageEvent<unknown>): void => session.receive(event.data)
