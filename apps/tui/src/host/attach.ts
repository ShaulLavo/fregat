import type { TerminalConnection } from '@/terminal/state/connection'
import { createTuiError } from '@/host/utils/structured-errors'

export type AttachTerminalRequest = {
  readonly open: () => TerminalConnection
  readonly signal: AbortSignal
}

export type AttachHost = {
  readonly input: {
    readonly isRaw?: boolean
    on(event: 'data', listener: (data: Uint8Array) => void): unknown
    off(event: 'data', listener: (data: Uint8Array) => void): unknown
    setRawMode(value: boolean): unknown
    resume(): unknown
    pause(): unknown
  }
  readonly output: {
    readonly columns: number
    readonly rows: number
    write(data: string | Uint8Array): unknown
    on(event: 'resize', listener: () => void): unknown
    off(event: 'resize', listener: () => void): unknown
  }
}

export async function runTerminalAttach(
  request: AttachTerminalRequest,
  host: AttachHost = { input: process.stdin, output: process.stdout },
) {
  request.signal.throwIfAborted()
  const connection = request.open()
  const complete = Promise.withResolvers<void>()
  const wasRaw = host.input.isRaw ?? false
  const decoder = createDetachDecoder(connection.send, complete.resolve)
  const output = connection.observeOutput((data) => host.output.write(data))
  const resize = () => connection.resize(host.output.columns || 80, host.output.rows || 24)
  const state = connection.subscribe(() => {
    const current = connection.getSnapshot()
    if (current.kind === 'ready') return resize()
    if (current.kind === 'exited' || current.kind === 'closed') return complete.resolve()
    if (current.kind === 'failed')
      complete.reject(createTuiError(current.message, 'Reconnect to the terminal.'))
  })
  const abort = () => complete.reject(request.signal.reason)
  request.signal.addEventListener('abort', abort, { once: true })
  host.output.on('resize', resize)
  host.input.on('data', decoder)
  try {
    // The renderer has released the host. The inner application negotiates its own modes.
    host.output.write('\x1b[?1049h\x1b[2J\x1b[H')
    host.input.setRawMode(true)
    host.input.resume()
    resize()
    if (request.signal.aborted) abort()
    await complete.promise
  } finally {
    host.input.off('data', decoder)
    host.output.off('resize', resize)
    request.signal.removeEventListener('abort', abort)
    output()
    state()
    try {
      connection.close()
    } finally {
      host.input.pause()
      host.input.setRawMode(wasRaw)
      host.output.write(
        '\x1b[<99u\x1b[=0u\x1b[?2026l\x1b[?2027l\x1b[?2031l\x1b[?2048l\x1b[?1l\x1b>\x1b[?1000l\x1b[?1002l\x1b[?1003l\x1b[?1006l\x1b[?1004l\x1b[?2004l\x1b[?25h\x1b[0m\x1b[?1049l',
      )
    }
  }
}

export function createDetachDecoder(send: (data: Uint8Array) => void, detach: () => void) {
  let prefix = false
  let detached = false
  return (data: Uint8Array) => {
    if (detached || data.length === 0) return
    let offset = 0
    if (prefix) {
      prefix = false
      detached = data[0] === 0x64
      if (detached) return detach()
      send(new Uint8Array(data[0] === 0x1d ? [0x1d] : [0x1d, data[0]]))
      offset = 1
    }
    while (offset < data.length) {
      const next = data.indexOf(0x1d, offset)
      if (next === -1) return send(data.subarray(offset))
      if (next > offset) send(data.subarray(offset, next))
      prefix = next + 1 === data.length
      if (prefix) return
      detached = data[next + 1] === 0x64
      if (detached) return detach()
      send(data.subarray(next, next + (data[next + 1] === 0x1d ? 1 : 2)))
      offset = next + 2
    }
  }
}
