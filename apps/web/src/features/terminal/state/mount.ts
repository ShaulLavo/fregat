import { createReplayGate } from '@/features/terminal/state/replay'
import { errorMessage } from '@/lib/error-message'
import { fetchTerminalCheckout } from '@/features/terminal/state/register-checkout'
import {
  registerTerminalSession,
  terminalSessionKey,
} from '@/features/terminal/state/session-registry'
import { queryClientFor } from '@/lib/environments/state/query-clients'
import type { Client } from '@/lib/client'
import {
  parseTerminalServerMessage,
  type TerminalServerMessage,
  type WorktreeId,
} from '@workspace/contracts'
import {
  GhosttyRuntime,
  Terminal,
  type GhosttyWebGpuTerminalSubscription,
  type TerminalScrollbar,
} from 'ghostty-webgpu'
import { addLifecycleFlush } from '@/lib/lifecycle-flush'
import { connectTerminalSocket, type EdenServerSocket } from '@/lib/server-sockets'
import { sendTerminalClientMessage } from '@/features/terminal/utils/socket'
import { reportError, toClientError } from '@/lib/client-error-taxonomy'
import { fontStack } from '@/lib/fonts/utils/stack'
import { DEFAULT_CODE_FONT } from '@workspace/contracts'
import { UNFOCUSED_TERMINAL_CURSOR_STYLE } from '@/features/terminal/utils/appearance'
import { playFeedback } from '@workspace/ui/patterns/feedback-layer'
import { log } from '@/lib/client-logging'
import { elapsedMs, nowMs } from '@workspace/utils/timing'

export type TerminalInputSender = (data: string) => boolean
type TerminalDimensions = { cols: number; rows: number }
let ghosttyRuntimePromise: Promise<GhosttyRuntime> | null = null

export function mountTerminal({
  origin,
  client,
  signal,
  host,
  rootPath,
  scrollback,
  sessionId,
  onConnectedChange,
  getSavedScroll,
  onCapture,
  onExit,
  onFailed,
  onProcessChange,
  onReady,
  onScrollbackLengthChange,
  onTitleChange,
}: {
  origin: string
  client: Client
  signal: AbortSignal
  host: HTMLDivElement
  rootPath: string
  scrollback: number
  sessionId: string
  onConnectedChange: (connected: boolean) => void
  getSavedScroll: () => Readonly<TerminalScrollbar> | null
  onExit: (exitCode: number | null) => void
  onFailed: (message: string) => void
  onCapture: (terminal: Terminal) => void
  onProcessChange: (process: string | null) => void
  onReady: (terminal: Terminal, sendInput: TerminalInputSender) => void
  onScrollbackLengthChange: (length: number) => void
  onTitleChange: (title: string) => void
}) {
  let cancelled = false
  let dataDisposable: GhosttyWebGpuTerminalSubscription | null = null
  let resizeDisposable: GhosttyWebGpuTerminalSubscription | null = null
  let scrollDisposable: GhosttyWebGpuTerminalSubscription | null = null
  let titleDisposable: GhosttyWebGpuTerminalSubscription | null = null
  let bellDisposable: GhosttyWebGpuTerminalSubscription | null = null
  let socket: EdenServerSocket | null = null
  let disposeSocket: (() => void) | undefined
  let terminal: Terminal | null = null
  let terminalDimensions: TerminalDimensions | null = null
  let inputReady = false
  let captureTimer: ReturnType<typeof setTimeout> | undefined
  let frameDisposable: GhosttyWebGpuTerminalSubscription | null = null
  const flushCapture = () => {
    clearTimeout(captureTimer)
    captureTimer = undefined
    if (terminal && inputReady && !cancelled) onCapture(terminal)
  }
  const removeFlush = addLifecycleFlush(flushCapture)
  let unregisterSession: (() => void) | null = null
  const inputEncoder = new TextEncoder()

  const open = async () => {
    const startedAt = nowMs()
    const [runtime, worktreeId] = await Promise.all([
      initializeGhostty(),
      fetchTerminalCheckout(queryClientFor(origin), rootPath),
    ])
    if (cancelled || signal.aborted) return

    const nextTerminal = await createTerminal(runtime, scrollback)
    if (cancelled || signal.aborted) {
      nextTerminal.dispose()
      return
    }

    terminal = nextTerminal
    dataDisposable = terminal.onData((data) => {
      if (data.byteLength === 0 || !inputReady) return
      sendTerminalClientMessage(socket, { data, type: 'input' })
    })
    resizeDisposable = terminal.onResize((dimensions) => {
      terminalDimensions = dimensions
      sendTerminalResize(socket, dimensions)
    })
    scrollDisposable = terminal.on('scroll', ({ scrollbackLength }) => {
      onScrollbackLengthChange(scrollbackLength)
    })
    frameDisposable = terminal.on('frame', () => {
      if (!inputReady || captureTimer !== undefined) return
      captureTimer = setTimeout(flushCapture, 250)
    })
    titleDisposable = terminal.on('title', (title) => onTitleChange(title))
    bellDisposable = terminal.on('bell', () => playFeedback('bell', 'terminalBell'))
    await terminal.open(host)
    if (cancelled || signal.aborted) return

    // `open` installs the renderer, so the tier is known from here on.
    log.info({
      action: 'terminal.mount',
      area: 'terminal',
      durationMs: elapsedMs(startedAt),
      rendererBackend: terminal.diagnostics.rendererBackend ?? null,
      sessionId,
    })

    // The theme lands in onReady, which sees the palette current at handover.
    terminalDimensions = currentTerminalDimensions(terminal)
    // The socket is opened below, so the sender is deliberately late-bound:
    // a command queued before the connection lands must not be written into a
    // null socket and silently dropped.
    onReady(
      terminal,
      (data) =>
        inputReady &&
        sendTerminalClientMessage(socket, { data: inputEncoder.encode(data), type: 'input' }),
    )
    const connection = openTerminalSocket({
      client,
      signal,
      getTerminalDimensions: () => terminalDimensions,
      isCancelled: () => cancelled,
      getSavedScroll,
      onConnectedChange: (ready) => {
        inputReady = ready
        onConnectedChange(ready)
        if (ready) flushCapture()
      },
      onExit,
      onProcessChange,
      worktreeId,
      sessionId,
      terminal,
    })
    socket = connection.socket
    disposeSocket = connection.dispose
    unregisterSession = registerTerminalSession(terminalSessionKey(rootPath, sessionId), {
      dispose: () => sendTerminalClientMessage(socket, { type: 'dispose' }),
    })
  }

  void open().catch((error: unknown) => {
    if (cancelled || signal.aborted) return

    onFailed(errorMessage(error, 'Could not open the terminal.'))
    reportError(toClientError(error))
  })

  return () => {
    flushCapture()
    removeFlush()
    frameDisposable?.dispose()
    cancelled = true
    unregisterSession?.()
    dataDisposable?.dispose()
    resizeDisposable?.dispose()
    scrollDisposable?.dispose()
    titleDisposable?.dispose()
    bellDisposable?.dispose()
    disposeSocket?.()
    terminal?.dispose()
    closeTerminalSocket(socket)
    host.replaceChildren()
  }
}

function openTerminalSocket({
  client,
  signal,
  getTerminalDimensions,
  isCancelled,
  onConnectedChange,
  getSavedScroll,
  onExit,
  onProcessChange,
  worktreeId,
  sessionId,
  terminal,
}: {
  client: Client
  signal: AbortSignal
  getTerminalDimensions: () => TerminalDimensions | null
  isCancelled: () => boolean
  onConnectedChange: (connected: boolean) => void
  getSavedScroll: () => Readonly<TerminalScrollbar> | null
  onExit: (exitCode: number | null) => void
  onProcessChange: (process: string | null) => void
  worktreeId: WorktreeId
  sessionId: string
  terminal: Terminal
}) {
  const socket = connectTerminalSocket({ worktreeId, terminalId: sessionId }, client, signal)

  const gate = createReplayGate({ terminal, getSavedScroll, onReady: onConnectedChange })
  const frame = terminal.on('frame', () => {
    if (isCancelled() || signal.aborted) return
    gate.paint()
  })
  const onClose = () => {
    frame.dispose()
    gate.close()
  }
  socket.addEventListener('close', onClose)
  const onMessage: EventListener = (event) => {
    if (isCancelled() || signal.aborted) return

    const message = parseTerminalServerMessage((event as MessageEvent).data)
    if (!message) return
    if (message.type === 'replay-complete') {
      gate.complete()
      return
    }
    if (message.type === 'ready') {
      gate.begin()
      if (message.restoredHistory)
        terminal.writeln('\r\n[Previous output restored. A new terminal process has started.]')
      sendTerminalResize(socket, getTerminalDimensions())
      return
    }

    handleTerminalServerMessage({ message, onExit, onProcessChange, terminal })
  }
  socket.addEventListener('message', onMessage)

  return {
    socket,
    dispose: () => {
      frame.dispose()
      socket.removeEventListener('message', onMessage)
      socket.removeEventListener('close', onClose)
      gate.close()
    },
  }
}

function handleTerminalServerMessage({
  message,
  onExit,
  onProcessChange,
  terminal,
}: {
  message: Exclude<TerminalServerMessage, { type: 'ready' | 'replay-complete' }>
  onExit: (exitCode: number | null) => void
  onProcessChange: (process: string | null) => void
  terminal: Terminal
}) {
  if (message.type === 'cleared') {
    terminal.reset()
    return
  }
  if (message.type === 'output') {
    terminal.write(message.data)
    return
  }
  if (message.type === 'exit') {
    terminal.writeln('')
    terminal.writeln(exitDetail(message.exitCode))
    onExit(message.exitCode)
    return
  }
  if (message.type === 'process') {
    onProcessChange(message.name)
    return
  }

  terminal.writeln('')
  terminal.writeln(message.message)
}

function createTerminal(runtime: GhosttyRuntime, scrollback: number) {
  return Terminal.create({
    appearance: {
      // Constructed unfocused; the real values arrive at handover, before paint.
      cursor: { blink: false, style: UNFOCUSED_TERMINAL_CURSOR_STYLE },
      font: {
        boldWeight: 700,
        family: fontStack(DEFAULT_CODE_FONT, 'code'),
        letterSpacing: 0,
        lineHeight: 1,
        size: DEFAULT_TERMINAL_FONT_SIZE,
        weight: 400,
      },
      scrollbackLimit: scrollback,
    },
    links: { activateUri: openTerminalUri },
    runtime: { kind: 'borrowed', runtime },
  })
}

/** Construction defaults; the real values arrive at handover, before first paint. */
const DEFAULT_TERMINAL_FONT_SIZE = 12

function currentTerminalDimensions(terminal: Terminal) {
  const grid = terminal.appearance.grid
  return {
    cols: grid.columns,
    rows: grid.rows,
  }
}

function initializeGhostty() {
  if (ghosttyRuntimePromise) return ghosttyRuntimePromise

  const loading = GhosttyRuntime.create()
  ghosttyRuntimePromise = loading
  void loading.catch(() => {
    if (ghosttyRuntimePromise === loading) ghosttyRuntimePromise = null
  })
  return loading
}

function openTerminalUri(uri: string) {
  window.open(uri, '_blank', 'noopener,noreferrer')
}

function sendTerminalResize(
  socket: EdenServerSocket | null,
  dimensions: TerminalDimensions | null,
) {
  if (!dimensions) return false

  return sendTerminalClientMessage(socket, {
    cols: dimensions.cols,
    rows: dimensions.rows,
    type: 'resize',
  })
}

function closeTerminalSocket(socket: EdenServerSocket | null) {
  if (!socket) return
  if (socket.readyState === 3) return
  if (socket.readyState === 2) return

  socket.close()
}

function exitDetail(exitCode: number | null) {
  if (exitCode === null) return 'Process exited'

  return `Process exited ${exitCode}`
}
