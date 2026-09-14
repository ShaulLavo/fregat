import { RingLoader } from '@workspace/ui/components/ring-loader'
import { errorMessage } from '@/lib/error-message'
import { fetchTerminalCheckout } from '@/features/terminal/state/register-checkout'
import {
  registerTerminalSession,
  terminalSessionKey,
} from '@/features/terminal/state/session-registry'
import type { WorktreeId } from '@workspace/contracts'
import { useQueryClient } from '@tanstack/react-query'
import type { Client } from '@/lib/client'
import {
  clientForQueryClient,
  originForQueryClient,
  queryClientFor,
} from '@/lib/environments/state/query-clients'
import { environmentActivitySignal } from '@/lib/environments/state/activity'
import { parseTerminalServerMessage, type TerminalServerMessage } from '@workspace/contracts'
import { cn } from '@workspace/ui/lib/utils'
import {
  GhosttyRuntime,
  Terminal,
  type GhosttyWebGpuTerminalSubscription,
  type TerminalCursorStyle,
} from 'ghostty-webgpu'
import {
  useEffect,
  useEffectEvent,
  useRef,
  useState,
  type ComponentPropsWithoutRef,
  type FocusEvent,
  type MouseEvent as ReactMouseEvent,
} from 'react'

import { usePalette } from '@/lib/appearance/hooks/use-palette'
import { useContextMenu } from '@/keymap/menus/hooks/use-context-menu'
import { reportError, toClientError } from '@/lib/client-error-taxonomy'
import { DEFAULT_MONO_FONT_STACK } from '@/lib/default-nerd-font'
import { useFocusService } from '@/lib/focus/hooks/use-service'
import { useFocusTarget } from '@/lib/focus/hooks/use-target'
import { registeredFocusTarget } from '@/lib/focus/state/service'
import { connectTerminalSocket, type EdenServerSocket } from '@/lib/server-sockets'

import { TerminalMenu } from '@/features/terminal/components/menu'
import { useTerminalCommandInbox } from '@/features/terminal/hooks/use-command-inbox'
import { useTerminalKeybindings } from '@/features/terminal/hooks/use-keybindings'
import { useTerminalLinks } from '@/features/terminal/hooks/use-links'
import { sendTerminalClientMessage } from '@/features/terminal/utils/socket'
import { readTerminalMenuTarget, type TerminalMenuTarget } from '@/features/terminal/utils/commands'
import { terminalThemeFor } from '@/features/terminal/utils/theme'
import type { TerminalColors } from '@workspace/client-core/themes/palette'
import { isFocusOutsideElement } from '@/features/terminal/utils/focus-target'
import { useSettingValue } from '@/features/settings/hooks/use-setting-value'
import { useUnavailableEnvironment } from '@/lib/environments/hooks/use-unavailable-environment'

/** Writes to the terminal's socket. False when the connection is not up yet. */
type TerminalInputSender = (data: string) => boolean

type TerminalDimensions = {
  cols: number
  rows: number
}

type TerminalCursorOptions = {
  cursorBlink: boolean
  cursorStyle: TerminalCursorStyle
}

/**
 * Focus owns the cursor's *shape*; `terminal.integrated.cursorBlinking` owns
 * whether it blinks.
 *
 * They used to be one constant carrying both, which meant every focus, blur and
 * click wrote a hardcoded blink over the setting — and the settings effect does
 * not re-run on focus, so the setting never won again.
 */
const FOCUSED_TERMINAL_CURSOR_STYLE: TerminalCursorStyle = 'block'
const UNFOCUSED_TERMINAL_CURSOR_STYLE: TerminalCursorStyle = 'outline'

function terminalCursorOptions(focused: boolean, cursorBlink: boolean): TerminalCursorOptions {
  return {
    // Scoped to a focused terminal, per the setting's own description: an
    // unfocused cursor is a static outline whatever the preference says.
    cursorBlink: focused && cursorBlink,
    cursorStyle: focused ? FOCUSED_TERMINAL_CURSOR_STYLE : UNFOCUSED_TERMINAL_CURSOR_STYLE,
  }
}

let ghosttyRuntimePromise: Promise<GhosttyRuntime> | null = null

export function TerminalPanel({
  active = true,
  className,
  rootPath,
  sessionId,
  onExit,
  onProcessChange,
  onTitleChange,
  ...sectionProps
}: TerminalPanelProps) {
  const unavailable = useUnavailableEnvironment()
  const machineUnavailable = unavailable !== null
  const queryClient = useQueryClient()
  const origin = originForQueryClient(queryClient)
  const focus = useFocusService()
  const hostRef = useRef<HTMLDivElement | null>(null)
  const restoreFocusAfterRemountRef = useRef<string | null>(null)
  const scrollbackLengthRef = useRef(0)
  const sendInputRef = useRef<TerminalInputSender | null>(null)
  const terminalRef = useRef<Terminal | null>(null)
  const { resolved: palette } = usePalette()
  const terminalColors = palette.terminal
  const paletteHash = palette.contentHash
  // Read as primitives, not an object: an object literal is a new value every
  // render, which would make the effect below run on every render and, worse,
  // tempt someone into making it a dependency of the mount effect.
  const cursorBlink = useSettingValue('terminal.integrated.cursorBlinking')
  const fontSize = useSettingValue('terminal.integrated.fontSize')
  const scrollback = useSettingValue('terminal.integrated.scrollback')
  const contextMenu = useContextMenu()
  const [menuTarget, setMenuTarget] = useState<TerminalMenuTarget | null>(null)
  const [socketConnected, setSocketConnected] = useState(false)
  const focusIdentity = terminalSessionKey(rootPath, sessionId)
  const terminalMountIdentity = `${origin}\u0000${focusIdentity}\u0000${scrollback}`
  const [terminalFailure, setTerminalFailure] = useState<{
    identity: string
    message: string
  } | null>(null)
  const [readyTerminalIdentity, setReadyTerminalIdentity] = useState<string | null>(null)
  const registerTerminalLinks = useTerminalLinks(rootPath)
  useTerminalKeybindings(hostRef)
  useTerminalCommandInbox({
    active: active && socketConnected && !machineUnavailable,
    sendInputRef,
  })
  const {
    focused: terminalFocused,
    ref: terminalFocusTargetRef,
    token: terminalFocusTargetToken,
  } = useFocusTarget<HTMLElement>(
    {
      area: 'terminal',
      id: { kind: 'terminal', rootPath, sessionId },
      onIntent: (intent) => {
        if (intent !== 'focus' || !active || machineUnavailable) return false

        const terminal = terminalRef.current
        if (!terminal) return false

        terminal.focus()
        return true
      },
    },
    active && !machineUnavailable && readyTerminalIdentity === terminalMountIdentity,
  )
  const captureTerminalRemountFocus = useEffectEvent(() => {
    restoreFocusAfterRemountRef.current = terminalFocused ? focusIdentity : null
  })
  // ghostty resolves long after the effect that asked for it, so the handover
  // runs as an effect event and sees the current render rather than the one
  // that started the mount.
  const handleTerminalReady = useEffectEvent(
    (terminal: Terminal, sendInput: TerminalInputSender) => {
      terminalRef.current = terminal
      sendInputRef.current = sendInput
      setReadyTerminalIdentity(terminalMountIdentity)
      // At handover rather than at construction: ghostty resolves long after the
      // mount effect started, and this is an effect event, so it sees the
      // current settings rather than the ones the mount began with.
      applyTerminalAppearance(terminal, { cursorBlink, fontSize })
      applyTerminalCursorOptions(terminal, terminalCursorOptions(terminalFocused, cursorBlink))
      applyTerminalTheme(terminal, terminalColors)
      registerTerminalLinks(terminal)
    },
  )
  // State, not just the ref: a script queued before the socket opened has to
  // wake the effect that runs it, and writing a ref never re-renders.
  const handleTerminalConnectedChange = useEffectEvent((connected: boolean) => {
    setSocketConnected(connected)
  })
  const handleTerminalScrollbackLengthChange = useEffectEvent((length: number) => {
    scrollbackLengthRef.current = length
  })
  const handleTerminalExit = useEffectEvent((exitCode: number | null) => {
    onExit?.(exitCode)
  })
  const handleTerminalProcessChange = useEffectEvent((process: string | null) => {
    onProcessChange?.(process)
  })
  const handleTerminalTitleChange = useEffectEvent((title: string) => {
    onTitleChange?.(title)
  })
  const handleTerminalFocus = () => {
    applyTerminalCursorOptions(terminalRef.current, terminalCursorOptions(true, cursorBlink))
  }
  const handleTerminalBlur = (event: FocusEvent<HTMLElement>) => {
    if (!isFocusOutsideElement(event.currentTarget, event.relatedTarget)) return

    applyTerminalCursorOptions(terminalRef.current, terminalCursorOptions(false, cursorBlink))
  }
  // ghostty registers its own `contextmenu` listener on the canvas and never
  // calls preventDefault — it parks a hidden textarea under the cursor so the
  // native menu can copy and paste. That listener runs in the target phase, so
  // only a capture-phase handler above the canvas can take the event first.
  const handleTerminalContextMenu = (event: ReactMouseEvent<HTMLElement>) => {
    const terminal = terminalRef.current
    if (!terminal) return

    event.stopPropagation()
    // Snapshotted here because ghostty drops the selection from a document
    // `click` handler the moment a portalled menu item is pressed.
    setMenuTarget(readTerminalMenuTarget(terminal, sessionId, scrollbackLengthRef.current > 0))
    contextMenu.openAtEvent(event, event.currentTarget)
  }
  const handleTerminalMenuOpenChange = (open: boolean) => {
    contextMenu.onOpenChange(open)
    if (open) return

    setMenuTarget(null)
  }

  useEffect(() => {
    applyTerminalAppearance(terminalRef.current, { cursorBlink, fontSize })
  }, [cursorBlink, fontSize])

  // Keyed on the content hash, not the mode: a dark-to-dark palette change
  // repaints the ANSI table without a remount.
  useEffect(() => {
    applyTerminalTheme(terminalRef.current, terminalColors)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the hash is the colors' identity
  }, [paletteHash])

  useEffect(() => {
    if (machineUnavailable) return
    const host = hostRef.current
    if (!host) return

    const unmountTerminal = mountTerminal({
      origin,
      client: clientForQueryClient(queryClient),
      signal: environmentActivitySignal(origin),
      host,
      rootPath,
      scrollback,
      sessionId,
      onConnectedChange: handleTerminalConnectedChange,
      onExit: handleTerminalExit,
      onProcessChange: handleTerminalProcessChange,
      onTitleChange: handleTerminalTitleChange,
      onFailed: (message) => setTerminalFailure({ identity: terminalMountIdentity, message }),
      onReady: handleTerminalReady,
      onScrollbackLengthChange: handleTerminalScrollbackLengthChange,
    })

    return () => {
      captureTerminalRemountFocus()
      setReadyTerminalIdentity((current) => (current === terminalMountIdentity ? null : current))
      scrollbackLengthRef.current = 0
      terminalRef.current = null
      // The open menu holds the terminal it was opened against. Dropping it
      // here keeps a settings-driven remount from leaving items pointed at a disposed one.
      setMenuTarget(null)
      unmountTerminal()
    }
  }, [
    machineUnavailable,
    origin,
    queryClient,
    rootPath,
    scrollback,
    sessionId,
    terminalMountIdentity,
  ])

  useEffect(() => {
    if (!terminalFocusTargetToken) return

    const restoreIdentity = restoreFocusAfterRemountRef.current
    restoreFocusAfterRemountRef.current = null
    if (restoreIdentity !== focusIdentity) return

    const snapshot = focus.getSnapshot()
    if (snapshot.currentOwner || snapshot.requested) return

    void focus.request(registeredFocusTarget(terminalFocusTargetToken)).completion
  }, [focus, focusIdentity, terminalFocusTargetToken])

  useEffect(() => {
    applyTerminalCursorOptions(
      terminalRef.current,
      terminalCursorOptions(terminalFocused, cursorBlink),
    )
  }, [cursorBlink, terminalFocused])

  if (unavailable)
    return (
      <section
        {...sectionProps}
        aria-label='Terminal'
        className={cn(
          'text-warning flex min-h-0 flex-col items-center justify-center gap-1 p-4 text-sm',
          className,
        )}
        role='status'
      >
        <span>{unavailable.label ?? unavailable.name} is unreachable.</span>
        <span className='text-muted-foreground text-xs'>
          The terminal will reconnect when the machine is available.
        </span>
      </section>
    )

  return (
    <section
      aria-label='Terminal'
      {...sectionProps}
      className={cn('relative flex min-h-0 min-w-0 flex-col overflow-hidden', className)}
      onBlurCapture={handleTerminalBlur}
      onContextMenuCapture={handleTerminalContextMenu}
      onFocusCapture={handleTerminalFocus}
      ref={terminalFocusTargetRef}
    >
      <div
        className='min-h-0 min-w-0 flex-1 overflow-hidden px-(--density-control-padding-x) py-(--density-section-gap) font-mono'
        ref={hostRef}
      />
      {terminalFailure?.identity === terminalMountIdentity ? (
        <p
          role='alert'
          className='text-destructive absolute inset-0 flex items-center justify-center p-4 text-sm'
        >
          {terminalFailure.message}
        </p>
      ) : null}
      {readyTerminalIdentity !== terminalMountIdentity &&
      terminalFailure?.identity !== terminalMountIdentity ? (
        <div className='pointer-events-none absolute inset-0 flex items-center justify-center'>
          <RingLoader label='Opening terminal' className='text-muted-foreground size-6' />
        </div>
      ) : null}
      {contextMenu.anchor && menuTarget ? (
        <TerminalMenu
          anchor={contextMenu.anchor}
          onOpenChange={handleTerminalMenuOpenChange}
          target={menuTarget}
        />
      ) : null}
    </section>
  )
}

type TerminalPanelProps = ComponentPropsWithoutRef<'section'> & {
  active?: boolean
  rootPath: string
  sessionId: string
  onExit?: (exitCode: number | null) => void
  onProcessChange?: (process: string | null) => void
  onTitleChange?: (title: string) => void
}

function mountTerminal({
  origin,
  client,
  signal,
  host,
  rootPath,
  scrollback,
  sessionId,
  onConnectedChange,
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
  onExit: (exitCode: number | null) => void
  onFailed: (message: string) => void
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
  let socket: EdenServerSocket | null = null
  let terminal: Terminal | null = null
  let terminalDimensions: TerminalDimensions | null = null
  let unregisterSession: (() => void) | null = null
  const inputEncoder = new TextEncoder()

  const open = async () => {
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
      if (data.byteLength === 0) return
      sendTerminalClientMessage(socket, { data, type: 'input' })
    })
    resizeDisposable = terminal.onResize((dimensions) => {
      terminalDimensions = dimensions
      sendTerminalResize(socket, dimensions)
    })
    scrollDisposable = terminal.on('scroll', ({ scrollbackLength }) => {
      onScrollbackLengthChange(scrollbackLength)
    })
    titleDisposable = terminal.on('title', (title) => onTitleChange(title))
    await terminal.open(host)
    if (cancelled || signal.aborted) return

    // The theme lands in onReady, which sees the palette current at handover.
    terminalDimensions = currentTerminalDimensions(terminal)
    // The socket is opened below, so the sender is deliberately late-bound:
    // a command queued before the connection lands must not be written into a
    // null socket and silently dropped.
    onReady(terminal, (data) =>
      sendTerminalClientMessage(socket, { data: inputEncoder.encode(data), type: 'input' }),
    )
    socket = openTerminalSocket({
      client,
      signal,
      getTerminalDimensions: () => terminalDimensions,
      isCancelled: () => cancelled,
      onConnectedChange,
      onExit,
      onProcessChange,
      worktreeId,
      sessionId,
      terminal,
    })
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
    cancelled = true
    unregisterSession?.()
    dataDisposable?.dispose()
    resizeDisposable?.dispose()
    scrollDisposable?.dispose()
    titleDisposable?.dispose()
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
  onExit: (exitCode: number | null) => void
  onProcessChange: (process: string | null) => void
  worktreeId: WorktreeId
  sessionId: string
  terminal: Terminal
}) {
  const socket = connectTerminalSocket({ worktreeId, terminalId: sessionId }, client, signal)

  socket.addEventListener('open', () => {
    if (isCancelled() || signal.aborted) return

    onConnectedChange(true)
  })
  socket.addEventListener('close', () => {
    if (isCancelled() || signal.aborted) return

    onConnectedChange(false)
  })
  socket.addEventListener('message', (event) => {
    if (isCancelled() || signal.aborted) return

    const message = parseTerminalServerMessage((event as MessageEvent).data)
    if (!message) return
    if (message.type === 'ready') {
      sendTerminalResize(socket, getTerminalDimensions())
      return
    }

    handleTerminalServerMessage({ message, onExit, onProcessChange, terminal })
  })

  return socket
}

function handleTerminalServerMessage({
  message,
  onExit,
  onProcessChange,
  terminal,
}: {
  message: Exclude<TerminalServerMessage, { type: 'ready' }>
  onExit: (exitCode: number | null) => void
  onProcessChange: (process: string | null) => void
  terminal: Terminal
}) {
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
        family: DEFAULT_MONO_FONT_STACK,
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

export type TerminalAppearance = {
  readonly cursorBlink: boolean
  readonly fontSize: number
}

/** Pushes live appearance settings without rebuilding the terminal. */
export function applyTerminalAppearance(terminal: Terminal | null, appearance: TerminalAppearance) {
  if (!terminal) return

  terminal.setFont({ size: appearance.fontSize })
  terminal.setCursor({ blink: appearance.cursorBlink })
}

function applyTerminalCursorOptions(terminal: Terminal | null, options: TerminalCursorOptions) {
  if (!terminal) return

  terminal.setCursor({ blink: options.cursorBlink, style: options.cursorStyle })
}

function applyTerminalTheme(terminal: Terminal | null, colors: TerminalColors) {
  if (!terminal) return
  terminal.setTheme(terminalThemeFor(colors, terminal.appearance.theme))
}

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
