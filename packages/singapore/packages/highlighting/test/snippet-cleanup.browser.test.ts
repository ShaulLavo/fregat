import { expect, test, vi } from 'vitest'
import { createHighlightingService } from '../src/index'

function isSourceRelease(value: unknown): boolean {
  if (typeof value !== 'object' || value === null || !('payload' in value)) return false
  const payload = value.payload
  if (
    typeof payload !== 'object' ||
    payload === null ||
    !('type' in payload) ||
    payload.type !== 'source' ||
    !('command' in payload)
  )
    return false
  const command = payload.command
  return (
    typeof command === 'object' &&
    command !== null &&
    'kind' in command &&
    command.kind === 'release'
  )
}

test('retires the real snippet counter and analysis before propagating an external cleanup failure', async () => {
  const OriginalWorker = globalThis.Worker
  const failure = new TypeError('Controlled release failure')
  let fail = false
  let releases = 0
  class BoundaryWorker extends OriginalWorker {
    override postMessage(
      message: unknown,
      transferOrOptions: Transferable[] | StructuredSerializeOptions = [],
    ): void {
      if (Array.isArray(transferOrOptions)) super.postMessage(message, transferOrOptions)
      else super.postMessage(message, transferOrOptions)
      if (!isSourceRelease(message)) return
      releases++
      if (fail) throw failure
    }
  }
  vi.stubGlobal('Worker', BoundaryWorker)
  const service = createHighlightingService()
  try {
    const healthy = await service.highlight('const value = 1;\n', {
      language: 'typescript',
      theme: { format: 'editor', definition: {} },
    })
    expect(healthy.tokens.length).toBeGreaterThan(0)
    expect(service.inspect().snippetSessions).toBe(0)
    expect(releases).toBe(1)
    fail = true
    await expect(
      service.highlight('const value = 2;\n', {
        language: 'typescript',
        theme: { format: 'editor', definition: {} },
      }),
    ).rejects.toBe(failure)
    expect(releases).toBe(2)
    expect(service.inspect().snippetSessions).toBe(0)
  } finally {
    fail = false
    await service.dispose()
    vi.unstubAllGlobals()
  }
})
