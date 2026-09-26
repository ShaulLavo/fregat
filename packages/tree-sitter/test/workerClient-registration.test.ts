import { afterEach, describe, expect, it, vi } from 'vitest'

import type { TreeSitterLanguageDescriptor } from '../src/treeSitter/registry.ts'
import type { TreeSitterWorkerRequest } from '../src/treeSitter/types.ts'
import { TreeSitterWorkerClient } from '../src/treeSitter/workerClient.ts'

// A worker that acknowledges every request, so registration traffic is observable.
class EchoWorker {
  static readonly requests: TreeSitterWorkerRequest[] = []
  onmessage: ((event: MessageEvent) => void) | null = null
  onerror: ((event: ErrorEvent) => void) | null = null

  postMessage(request: TreeSitterWorkerRequest): void {
    EchoWorker.requests.push(request)
    queueMicrotask(() => this.onmessage?.({ data: { id: request.id, ok: true } } as MessageEvent))
  }

  terminate(): void {}
}

const descriptor = (wasmUrl: string): TreeSitterLanguageDescriptor => ({
  id: 'fixture',
  extensions: ['.fx'],
  aliases: [],
  wasmUrl,
  highlightQuerySource: '(identifier) @variable',
})

const registrations = () =>
  EchoWorker.requests.filter((request) => request.payload.type === 'registerLanguages')

describe('tree-sitter worker client language registration', () => {
  afterEach(() => {
    EchoWorker.requests.length = 0
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('registers a descriptor once and never serialises its wasm', async () => {
    vi.stubGlobal('Worker', EchoWorker)
    const client = new TreeSitterWorkerClient()
    const wasmUrl = `data:application/wasm;base64,${'A'.repeat(64 * 1024)}`
    const language = descriptor(wasmUrl)
    const stringify = vi.spyOn(JSON, 'stringify')

    await client.registerLanguages([language])
    await client.registerLanguages([language])
    await client.registerLanguages([language, language])

    expect(registrations()).toHaveLength(1)
    const serialisedWasm = stringify.mock.results.filter(
      (result) => typeof result.value === 'string' && result.value.includes(wasmUrl),
    )
    expect(serialisedWasm).toHaveLength(0)
  })

  it('re-registers an equal id whose grammar or queries changed', async () => {
    vi.stubGlobal('Worker', EchoWorker)
    const client = new TreeSitterWorkerClient()

    await client.registerLanguages([descriptor('data:one')])
    await client.registerLanguages([descriptor('data:one')])
    await client.registerLanguages([descriptor('data:two')])
    await client.registerLanguages([{ ...descriptor('data:two'), highlightQuerySource: '' }])

    expect(registrations()).toHaveLength(3)
  })
})
