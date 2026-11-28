import { openCodeErrors } from './opencode-errors'

export class OpenCodeHttp {
  readonly url: string

  private readonly operationTimeoutMs: number

  constructor(url: string, operationTimeoutMs = 30_000) {
    this.url = url
    this.operationTimeoutMs = operationTimeoutMs
  }

  async request<T>(
    path: string,
    cwd: string,
    body?: unknown,
    method = body === undefined ? 'GET' : 'POST',
    signal?: AbortSignal,
  ): Promise<T> {
    const response = await fetch(this.endpoint(path, cwd), {
      method,
      headers: { 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(this.operationTimeoutMs)])
        : AbortSignal.timeout(this.operationTimeoutMs),
    })
    if (!response.ok)
      throw openCodeErrors.OPENCODE_REQUEST_FAILED({
        internal: { operation: path.split('/').at(-1), status: response.status },
      })
    if (response.status === 204) return undefined as T
    const text = await response.text()
    return (text ? JSON.parse(text) : undefined) as T
  }

  async events(cwd: string, signal: AbortSignal) {
    const connection = new AbortController()
    const deadline = setTimeout(() => connection.abort(), this.operationTimeoutMs)
    let response: Response
    try {
      response = await fetch(this.endpoint('/event', cwd), {
        headers: { Accept: 'text/event-stream' },
        signal: AbortSignal.any([signal, connection.signal]),
      })
    } catch {
      throw openCodeErrors.OPENCODE_REQUEST_FAILED({
        internal: {
          operation: 'subscribe',
          cancelled: signal.aborted,
          timeoutMs: this.operationTimeoutMs,
        },
      })
    } finally {
      clearTimeout(deadline)
    }
    if (!response.ok || !response.body)
      throw openCodeErrors.OPENCODE_REQUEST_FAILED({
        internal: { operation: 'subscribe', status: response.status },
      })
    return response.body
  }

  private endpoint(path: string, cwd: string) {
    const url = new URL(`${this.url.replace(/\/$/, '')}${path}`)
    if (cwd) url.searchParams.set('directory', cwd)
    return url
  }
}

export async function readOpenCodeEvents(
  stream: ReadableStream<Uint8Array>,
  onEvent: (event: unknown) => void,
) {
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  let pending = ''
  try {
    while (true) {
      const next = await reader.read()
      if (next.done) return
      pending = dispatchEventFrames(pending + decoder.decode(next.value, { stream: true }), onEvent)
    }
  } finally {
    await reader.cancel().catch(() => undefined)
    reader.releaseLock()
  }
}

function dispatchEventFrames(pending: string, onEvent: (event: unknown) => void) {
  let boundary = /\r?\n\r?\n/.exec(pending)
  while (boundary) {
    const data = pending
      .slice(0, boundary.index)
      .split(/\r?\n/)
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trimStart())
      .join('\n')
    if (data) onEvent(JSON.parse(data))
    pending = pending.slice(boundary.index + boundary[0].length)
    boundary = /\r?\n\r?\n/.exec(pending)
  }
  return pending
}
