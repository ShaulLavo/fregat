import { closeSync, writeSync } from 'node:fs'
import { isRecord } from '@workspace/utils/objects'
import { launcherErrors } from './structured-errors'

export type CdpEvent = { method: string; params: Record<string, unknown>; sessionId?: string }
type Pending = {
  method: string
  resolve(value: Record<string, unknown>): void
  reject(error: unknown): void
  timer: ReturnType<typeof setTimeout>
}
type CdpTransport = {
  input: ReadableStream<Uint8Array>
  write(bytes: Uint8Array): Promise<void>
  close(): void
}

export class CdpClient {
  private nextId = 0
  private pending = new Map<number, Pending>()
  private listeners = new Map<string, Set<(event: CdpEvent) => void>>()
  private closed = false
  private writeTail: Promise<void> = Promise.resolve()
  private readBytes = 0
  private writtenBytes = 0
  private frames = 0
  private reader: ReadableStreamDefaultReader<Uint8Array>
  private disconnect = Promise.withResolvers<unknown>()
  readonly disconnected = this.disconnect.promise
  readonly done: Promise<void>

  private transport: CdpTransport

  constructor(transport: CdpTransport) {
    this.transport = transport
    this.reader = transport.input.getReader()
    this.done = this.read().catch((error: unknown) => this.close(error))
  }

  request(
    method: string,
    params: Record<string, unknown> = {},
    sessionId?: string,
    timeoutMs = 5000,
  ): Promise<Record<string, unknown>> {
    if (this.closed) return Promise.reject(this.failure('closed'))
    const id = ++this.nextId
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(this.failure('timeout', { method, id }))
      }, timeoutMs)
      this.pending.set(id, { resolve, reject, timer, method })
      const bytes = new TextEncoder().encode(
        JSON.stringify({ id, method, params, sessionId }) + '\0',
      )
      this.writeTail = this.writeTail
        .then(async () => {
          if (this.closed) return
          await this.transport.write(bytes)
          this.writtenBytes += bytes.length
        })
        .catch((error: unknown) => this.close(error))
    })
  }

  snapshot() {
    return { readBytes: this.readBytes, writtenBytes: this.writtenBytes, frames: this.frames }
  }

  on(method: string, handler: (event: CdpEvent) => void) {
    const listeners = this.listeners.get(method) ?? new Set()
    this.listeners.set(method, listeners)
    listeners.add(handler)
    return () => {
      listeners.delete(handler)
    }
  }

  close(error: unknown = this.failure('closed')) {
    if (this.closed) return
    this.closed = true
    this.disconnect.resolve(error)
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer)
      pending.reject(error)
    }
    this.pending.clear()
    this.listeners.clear()
    void this.reader.cancel().catch(() => {})
    this.transport.close()
  }

  private async read() {
    const decoder = new TextDecoder('utf-8', { fatal: true })
    let buffer = ''
    while (!this.closed) {
      const chunk = await this.reader.read()
      if (chunk.done) break
      this.readBytes += chunk.value.length
      buffer += decoder.decode(chunk.value, { stream: true })
      if (buffer.length > 8 * 1024 * 1024) throw this.failure('frame-size')
      let end = buffer.indexOf('\0')
      while (end !== -1) {
        this.receive(buffer.slice(0, end))
        buffer = buffer.slice(end + 1)
        end = buffer.indexOf('\0')
      }
    }
    this.close(this.failure(buffer.length ? 'truncated-frame' : 'eof'))
  }

  private receive(frame: string) {
    this.frames++
    let message: unknown
    try {
      message = JSON.parse(frame)
    } catch {
      throw this.failure('invalid-json')
    }
    if (!isRecord(message)) throw this.failure('invalid-message')
    if (typeof message.id === 'number') {
      const pending = this.pending.get(message.id)
      if (!pending) return
      this.pending.delete(message.id)
      clearTimeout(pending.timer)
      if (isRecord(message.error)) {
        pending.reject(
          this.failure('request-error', {
            id: message.id,
            method: pending.method,
            protocolCode:
              typeof message.error.code === 'number' && Number.isFinite(message.error.code)
                ? message.error.code
                : null,
          }),
        )
        return
      }
      if (!isRecord(message.result)) {
        pending.reject(this.failure('invalid-result'))
        return
      }
      pending.resolve(message.result)
      return
    }
    if (
      typeof message.method !== 'string' ||
      (message.sessionId !== undefined && typeof message.sessionId !== 'string')
    )
      throw this.failure('invalid-event')
    const params = message.params === undefined ? {} : message.params
    if (!isRecord(params)) throw this.failure('invalid-params')
    const event = {
      method: message.method,
      params,
      sessionId: message.sessionId as string | undefined,
    }
    for (const listener of this.listeners.get(message.method) ?? []) listener(event)
  }

  private failure(reason: string, facts: Record<string, unknown> = {}) {
    return launcherErrors.CDP_FAILED({ internal: { reason, ...facts } })
  }
}

export function cdpPipe(writeFd: number, readFd: number) {
  let open = true
  return new CdpClient({
    input: Bun.file(readFd).stream(),
    write: async (bytes) => {
      let offset = 0
      while (offset < bytes.length) {
        if (!open) throw launcherErrors.CDP_FAILED({ internal: { reason: 'write-after-close' } })
        try {
          offset += writeSync(writeFd, bytes, offset, bytes.length - offset)
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'EAGAIN') throw error
          await Bun.sleep(1)
        }
      }
    },
    // Bun leaves extra stdio descriptors open after the child exits.
    close: () => {
      open = false
      closeSync(writeFd)
      closeSync(readFd)
    },
  })
}
