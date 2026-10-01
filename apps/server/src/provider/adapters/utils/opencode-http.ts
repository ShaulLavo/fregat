import { openCodeErrors } from './opencode-errors'

export class OpenCodeHttp {
  readonly url: string

  constructor(url: string) {
    this.url = url
  }

  async request<T>(
    path: string,
    cwd: string,
    body?: unknown,
    method = body === undefined ? 'GET' : 'POST',
  ): Promise<T> {
    const response = await fetch(this.endpoint(path, cwd), {
      method,
      headers: { 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(30_000),
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
    const response = await fetch(this.endpoint('/event', cwd), {
      headers: { Accept: 'text/event-stream' },
      signal,
    })
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
      pending += decoder.decode(next.value, { stream: true })
      let boundary = pending.search(/\r?\n\r?\n/)
      while (boundary >= 0) {
        const frame = pending.slice(0, boundary)
        const separator = pending.slice(boundary).match(/^\r?\n\r?\n/)![0]
        pending = pending.slice(boundary + separator.length)
        const data = frame
          .split(/\r?\n/)
          .filter((line) => line.startsWith('data:'))
          .map((line) => line.slice(5).trimStart())
          .join('\n')
        if (data) onEvent(JSON.parse(data))
        boundary = pending.search(/\r?\n\r?\n/)
      }
    }
  } finally {
    await reader.cancel().catch(() => undefined)
    reader.releaseLock()
  }
}
