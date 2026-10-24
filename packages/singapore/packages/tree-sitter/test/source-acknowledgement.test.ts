import { expect, it } from 'vitest'
import { DocumentWorkerReader } from '@singapore-editor/core/internal/document-worker'
import type { TreeSitterWorkerRequest, TreeSitterWorkerResponse } from '../src/treeSitter/types'
import { TreeSitterWorkerClient } from '../src/treeSitter/workerClient'

class SourceTransport extends EventTarget implements Worker {
  readonly reader = new DocumentWorkerReader()
  onerror: Worker['onerror'] = null
  onmessage: Worker['onmessage'] = null
  onmessageerror: Worker['onmessageerror'] = null
  corruptPin = false
  stopped = false

  postMessage(request: TreeSitterWorkerRequest): void {
    const payload = request.payload
    const result = payload.type === 'source' ? this.reader.apply(payload.command) : undefined
    const response: TreeSitterWorkerResponse = {
      id: request.id,
      ok: true,
      result:
        result?.kind === 'pinned' && this.corruptPin
          ? { ...result, reference: { ...result.reference, readId: 'wrong-request' } }
          : result,
    }
    queueMicrotask(() =>
      this.onmessage?.call(this, new MessageEvent('message', { data: response })),
    )
  }

  terminate(): void {
    this.stopped = true
    this.reader.dispose()
  }
}

it.each([false, true])(
  'accepts a nested pin acknowledgement and rejects mismatched request association: %s',
  async (corrupt) => {
    const worker = new SourceTransport()
    const client = new TreeSitterWorkerClient({ workerFactory: () => worker })
    const connection = await client.sourceEndpoint.connect()
    if (!connection) throw new TypeError('The configured external worker is required')
    const identity = {
      documentId: 'ack',
      documentGeneration: 1,
      endpointGeneration: connection.generation,
      registrationId: connection.nextRegistration(),
    }
    const point = { segment: 'issued-segment', revision: 0, textVersion: 0 }
    const signal = new AbortController().signal
    try {
      expect(await connection.send({ kind: 'register', identity }, signal)).toMatchObject({
        kind: 'registered',
      })
      expect(
        await connection.send(
          {
            kind: 'reset',
            identity,
            base: null,
            target: point,
            chunks: ['exact😀'],
            lineEnding: '\n',
            byteOrderMark: '',
            containsUnusualLineTerminators: false,
          },
          signal,
        ),
      ).toMatchObject({ kind: 'applied' })
      worker.corruptPin = corrupt
      const pending = connection.send({ kind: 'pin', identity, point, readId: 'request' }, signal)
      if (corrupt)
        await expect(pending).rejects.toMatchObject({ code: 'DOCUMENT_SOURCE_ACKNOWLEDGEMENT' })
      else {
        const receipt = await pending
        expect(receipt).toEqual({
          kind: 'pinned',
          reference: { identity, point, readId: 'request' },
        })
        expect('identity' in receipt).toBe(false)
      }
      connection.release(identity)
      expect(worker.reader.inspect()).toEqual({ documents: 0, reads: 0, pins: 0, sourceUnits: 0 })
    } finally {
      await client.dispose()
    }
    expect(worker.stopped).toBe(true)
    expect(client.inspect()).toMatchObject({ lifecycle: 'disposed', pendingRequests: 0 })
  },
)
