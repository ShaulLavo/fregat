import type { LspWorkerLike } from '@singapore-editor/lsp'
import { describe, expect, it, vi } from 'vitest'
import { createTypeScriptLspServerSession } from '../src/server'

type Listener = (event: Event) => void

class FakeWorker implements LspWorkerLike {
  public readonly sent: unknown[] = []
  public terminated = false
  private readonly listeners = new Map<string, Set<Listener>>()

  public postMessage(message: unknown): void {
    this.sent.push(message)
  }

  public addEventListener(type: 'message' | 'error', handler: Listener): void {
    this.listenersFor(type).add(handler)
  }

  public removeEventListener(type: 'message' | 'error', handler: Listener): void {
    this.listenersFor(type).delete(handler)
  }

  public terminate(): void {
    this.terminated = true
  }

  public listenerCount(type: string): number {
    return this.listenersFor(type).size
  }

  public receive(message: unknown): void {
    const event = new MessageEvent('message', { data: message })
    for (const listener of this.listenersFor('message')) listener(event)
  }

  public fail(message: string): void {
    const event = errorEvent(message)
    for (const listener of this.listenersFor('error')) listener(event)
  }

  private listenersFor(type: string): Set<Listener> {
    let listeners = this.listeners.get(type)
    if (listeners) return listeners

    listeners = new Set()
    this.listeners.set(type, listeners)
    return listeners
  }
}

describe('createTypeScriptLspServerSession', () => {
  it('bridges WebSocket JSON-RPC messages to a TypeScript LSP worker', () => {
    const worker = new FakeWorker()
    const send = vi.fn()
    const session = createTypeScriptLspServerSession({
      send,
      workerFactory: () => worker,
    })
    const initialize = JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {},
    })

    session.receive(initialize)
    expect(worker.sent).toEqual([initialize])
    expect(worker.listenerCount('message')).toBe(1)
    expect(worker.listenerCount('error')).toBe(1)
    expect(session.inspectWorker()).toMatchObject({
      lifecycle: 'ready',
      postedMessages: 1,
      messageListeners: 1,
      errorListeners: 1,
      lastError: null,
    })

    worker.receive({
      jsonrpc: '2.0',
      id: 1,
      result: { capabilities: { hoverProvider: true } },
    })

    expect(JSON.parse(send.mock.calls[0]?.[0] as string)).toEqual({
      jsonrpc: '2.0',
      id: 1,
      result: { capabilities: { hoverProvider: true } },
    })

    session.dispose()
    expect(worker.terminated).toBe(true)
    expect(worker.listenerCount('message')).toBe(0)
    expect(worker.listenerCount('error')).toBe(0)
    expect(session.inspectWorker()).toMatchObject({
      lifecycle: 'disposed',
      postedMessages: 1,
      messageListeners: 0,
      errorListeners: 0,
    })
  })

  it('decodes binary WebSocket messages before forwarding to the worker', () => {
    const worker = new FakeWorker()
    const session = createTypeScriptLspServerSession({
      send: vi.fn(),
      workerFactory: () => worker,
    })
    const message = '{"jsonrpc":"2.0","method":"initialized","params":{}}'

    session.receive(new TextEncoder().encode(message))

    expect(worker.sent).toEqual([message])
  })

  it('tells the socket why the worker exited and tears down worker ownership', () => {
    const worker = new FakeWorker()
    const errors: unknown[] = []
    const send = vi.fn()
    const session = createTypeScriptLspServerSession({
      send,
      workerFactory: () => worker,
      onError: (error) => errors.push(error),
    })

    worker.fail('worker crashed')

    expect(errorMessage(errors[0])).toBe('worker crashed')
    expect(JSON.parse(send.mock.calls.at(-1)?.[0] as string)).toMatchObject({
      method: '$/serverExited',
      params: { outcome: 'crashed', error: { message: 'worker crashed' } },
    })
    expect(worker.terminated).toBe(true)
    expect(worker.listenerCount('message')).toBe(0)
    expect(worker.listenerCount('error')).toBe(0)
    expect(session.inspectWorker()).toMatchObject({
      lifecycle: 'crashed',
      lastError: 'worker crashed',
      messageListeners: 0,
      errorListeners: 0,
    })
  })
})

function errorEvent(message: string): Event {
  if (typeof ErrorEvent !== 'undefined') return new ErrorEvent('error', { message })
  return { message } as ErrorEvent
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}
