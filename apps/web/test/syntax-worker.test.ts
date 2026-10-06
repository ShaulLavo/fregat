import { expect, test } from './fixtures'
import { installSyntaxWorker } from './factories/syntax-worker'
import type {
  TreeSitterWorkerRequestPayload,
  TreeSitterWorkerResponse,
} from '../../../editor/packages/tree-sitter/src/treeSitter/types'

const identity = {
  documentId: 'review',
  documentGeneration: 1,
  endpointGeneration: 1,
  registrationId: 1,
}
const point = { segment: 'review', revision: 0, textVersion: 0 }
const source = { identity, point, readId: 'review-read' }
const parse: TreeSitterWorkerRequestPayload = {
  type: 'parse',
  generation: 1,
  documentId: 'review',
  runtimeSessionId: 'runtime-review',
  languageId: 'typescript',
  snapshotVersion: 1,
  source,
  includeHighlights: true,
}
function harness() {
  installSyntaxWorker((text) => [{ start: 0, end: text.length, style: { color: 'red' } }])
  const worker = new Worker(new URL('treeSitter.worker.ts', 'http://localhost'))
  let id = 0
  const send = (payload: TreeSitterWorkerRequestPayload) =>
    new Promise<TreeSitterWorkerResponse>((resolve) => {
      worker.onmessage = (event) => resolve(event.data)
      worker.postMessage({ id: ++id, payload })
    })
  const initialize = async () => {
    await send({ type: 'source', command: { kind: 'register', identity } })
    await send({
      type: 'source',
      command: {
        kind: 'reset',
        identity,
        base: null,
        target: point,
        chunks: ['known-good'],
        lineEnding: '\n',
        byteOrderMark: '',
        containsUnusualLineTerminators: false,
      },
    })
    await send({ type: 'source', command: { kind: 'pin', identity, point, readId: source.readId } })
    const answer = await send(parse)
    expect(
      answer.ok && answer.result && 'tokensPacked' in answer.result
        ? answer.result.tokensPacked?.starts.length
        : 0,
    ).toBe(1)
  }
  return { worker, send, initialize }
}

test('a known-good parsed source becomes unavailable after source release', async () => {
  const { initialize, send } = harness()
  await initialize()
  await send({ type: 'source', command: { kind: 'release', identity } })
  const answer = await send({
    type: 'queryRange',
    generation: 1,
    documentId: 'review',
    runtimeSessionId: 'runtime-review',
    languageId: 'typescript',
    snapshotVersion: 1,
    range: { startIndex: 0, endIndex: 10 },
    includeHighlights: true,
  })
  expect(answer.ok ? answer.result : undefined).toBeUndefined()
})

test('termination suppresses a previously queued domain reply', async () => {
  const { worker, initialize } = harness()
  await initialize()
  const replies: unknown[] = []
  worker.onmessage = (event) => replies.push(event.data)
  worker.postMessage({ id: 100, payload: parse })
  worker.terminate()
  await Promise.resolve()
  expect(replies).toEqual([])
})
