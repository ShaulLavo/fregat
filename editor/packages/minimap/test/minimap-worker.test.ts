import { afterEach, describe, expect, it, vi } from 'vitest'
import type { MinimapWorkerRequest, MinimapWorkerResponse } from '../src/types'

describe('minimap worker', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.resetModules()
    Reflect.deleteProperty(globalThis, '__EDITOR_PERFORMANCE_DIAGNOSTICS__')
    globalThis.onmessage = null
  })

  it('routes renderer errors to error responses', async () => {
    const postMessage = vi.spyOn(globalThis, 'postMessage').mockImplementation(() => undefined)
    await import('../src/minimap.worker')

    const onmessage = globalThis.onmessage as ((event: MessageEvent) => void) | null
    onmessage?.(
      new MessageEvent('message', {
        data: {
          type: 'init',
          mainCanvas: { getContext: () => null } as unknown as OffscreenCanvas,
          decorationsCanvas: { getContext: () => null } as unknown as OffscreenCanvas,
          options: { enabled: true },
          baseStyles: {},
        } as MinimapWorkerRequest,
      }),
    )

    expect(postMessage).toHaveBeenCalledWith({
      type: 'error',
      message: 'Unable to create minimap canvas context',
    } satisfies MinimapWorkerResponse)
  })

  it('does not post a render response before initialization', async () => {
    const postMessage = vi.spyOn(globalThis, 'postMessage').mockImplementation(() => undefined)
    await import('../src/minimap.worker')

    const onmessage = globalThis.onmessage as ((event: MessageEvent) => void) | null
    onmessage?.(
      new MessageEvent('message', {
        data: { type: 'render', sequence: 7 } as MinimapWorkerRequest,
      }),
    )

    expect(postMessage).not.toHaveBeenCalled()
  })

  it('acknowledges dispose requests', async () => {
    const postMessage = vi.spyOn(globalThis, 'postMessage').mockImplementation(() => undefined)
    await import('../src/minimap.worker')

    const onmessage = globalThis.onmessage as ((event: MessageEvent) => void) | null
    onmessage?.(
      new MessageEvent('message', {
        data: { type: 'dispose' } as MinimapWorkerRequest,
      }),
    )

    expect(postMessage).toHaveBeenCalledWith({ type: 'disposed' } satisfies MinimapWorkerResponse)
  })

  it('records request diagnostics through the shared diagnostics sink', async () => {
    const diagnostics: {
      readonly name: string
      readonly durationMs?: number
      readonly detail?: Readonly<Record<string, unknown>>
    }[] = []
    vi.spyOn(globalThis, 'postMessage').mockImplementation(() => undefined)
    Object.defineProperty(globalThis, '__EDITOR_PERFORMANCE_DIAGNOSTICS__', {
      configurable: true,
      value: { record: (diagnostic: (typeof diagnostics)[number]) => diagnostics.push(diagnostic) },
    })
    await import('../src/minimap.worker')

    const onmessage = globalThis.onmessage as ((event: MessageEvent) => void) | null
    onmessage?.(
      new MessageEvent('message', {
        data: { type: 'render', sequence: 7 } as MinimapWorkerRequest,
      }),
    )

    expect(diagnostics).toEqual([
      expect.objectContaining({
        name: 'minimap.worker.request',
        detail: { request: 'render' },
      }),
    ])
  })
})
