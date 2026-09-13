import {
  normalizeTerminalCols,
  normalizeTerminalRows,
  parseTerminalServerMessage,
  type TerminalOpenInput,
} from '@workspace/contracts'
import type { SettingsSession } from '@/connection/state/session'
import type { ServiceSocket } from '@/connection/utils/service-socket'

export type TerminalState =
  | { readonly kind: 'connecting' }
  | { readonly kind: 'ready'; readonly cwd: string; readonly shell: string }
  | { readonly kind: 'exited'; readonly exitCode: number | null }
  | { readonly kind: 'failed'; readonly message: string }
  | { readonly kind: 'closed' }

export type TerminalConnection = ReturnType<typeof openTerminalConnection>

export function openTerminalConnection(
  session: Pick<SettingsSession, 'origin' | 'createServiceSocket' | 'record'>,
  input: TerminalOpenInput,
) {
  let dimensions = {
    cols: normalizeTerminalCols(input.cols) ?? 80,
    rows: normalizeTerminalRows(input.rows) ?? 24,
  }
  const url = new URL('/terminal', session.origin)
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
  url.searchParams.set('worktreeId', input.worktreeId)
  url.searchParams.set('terminalId', input.terminalId)
  if (input.agentSessionId) url.searchParams.set('agentSessionId', input.agentSessionId)
  url.searchParams.set('cols', String(dimensions.cols))
  url.searchParams.set('rows', String(dimensions.rows))
  const socket: ServiceSocket = session.createServiceSocket(url.href)
  socket.binaryType = 'arraybuffer'
  const listeners = new Set<() => void>()
  const outputs = new Set<(data: Uint8Array) => void>()
  let state: TerminalState = { kind: 'connecting' }
  const started = performance.now()
  let inputBytes = 0
  let outputBytes = 0
  let resizeCount = 0
  let recorded = false
  let closed = false
  const timeout = setTimeout(() => fail('The terminal did not become ready.'), 10_000)
  timeout.unref?.()

  function publish(next: TerminalState) {
    state = next
    for (const listener of listeners) listener()
  }
  function fail(message: string) {
    if (closed) return
    clearTimeout(timeout)
    publish({ kind: 'failed', message })
    record()
    socket.close()
  }
  function send(data: Uint8Array) {
    if (closed || socket.readyState !== 1 || state.kind !== 'ready') return
    inputBytes += data.byteLength
    socket.send(data)
  }
  function resize(cols: number, rows: number) {
    dimensions = {
      cols: normalizeTerminalCols(cols) ?? 80,
      rows: normalizeTerminalRows(rows) ?? 24,
    }
    if (closed || socket.readyState !== 1 || state.kind !== 'ready') return
    resizeCount += 1
    socket.send(JSON.stringify({ type: 'resize', ...dimensions }))
  }
  function receive(event: MessageEvent) {
    if (closed) return
    const message = parseTerminalServerMessage(event.data)
    if (!message) return fail('The server sent an invalid terminal frame.')
    if (message.type === 'output') {
      outputBytes += message.data.byteLength
      for (const output of outputs) output(message.data)
      return
    }
    clearTimeout(timeout)
    if (message.type === 'ready') {
      publish({ kind: 'ready', cwd: message.cwd, shell: message.shell })
      resize(dimensions.cols, dimensions.rows)
      return
    }
    if (message.type === 'exit') return publish({ kind: 'exited', exitCode: message.exitCode })
    if (message.type === 'process') return
    fail(message.message)
  }
  function disconnected() {
    clearTimeout(timeout)
    if (closed || state.kind === 'failed' || state.kind === 'exited') return
    publish({ kind: 'failed', message: 'Terminal disconnected. Reopen it to reconnect.' })
    record()
  }
  function record() {
    if (recorded) return
    recorded = true
    session.record({
      area: 'terminal',
      operation: 'connection',
      terminalId: input.terminalId,
      worktreeId: input.worktreeId,
      outcome: state.kind,
      message: state.kind === 'failed' ? state.message : undefined,
      durationMs: performance.now() - started,
      inputBytes,
      outputBytes,
      resizeCount,
    })
  }
  const error = () => fail('The terminal connection failed.')
  socket.addEventListener('message', receive)
  socket.addEventListener('close', disconnected)
  socket.addEventListener('error', error)

  return {
    getSnapshot: () => state,
    subscribe(listener: () => void) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    observeOutput(listener: (data: Uint8Array) => void) {
      outputs.add(listener)
      return () => {
        outputs.delete(listener)
      }
    },
    send,
    resize,
    close(dispose = false) {
      if (closed) return
      closed = true
      clearTimeout(timeout)
      if (dispose && socket.readyState === 1) socket.send(JSON.stringify({ type: 'dispose' }))
      socket.removeEventListener('message', receive)
      socket.removeEventListener('close', disconnected)
      socket.removeEventListener('error', error)
      socket.close()
      record()
      publish({ kind: 'closed' })
      listeners.clear()
      outputs.clear()
    },
  }
}
