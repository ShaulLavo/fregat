import { mountTerminal, type TerminalInputSender } from '@/features/terminal/state/mount'
import {
  applyTerminalAppearance,
  applyTerminalCursorOptions,
  applyTerminalTheme,
  terminalCursorOptions,
} from '@/features/terminal/utils/appearance'
import { SavedViewport } from '@/features/terminal/components/saved-viewport'
import {
  captureTerminal,
  discardTerminal,
  savedTerminal,
  terminalReloadGeneration,
} from '@/features/terminal/state/reload'
import { useTerminalActions } from '@/features/terminal/hooks/use-terminal-actions'
import { ToolPane } from '@workspace/ui/patterns/tool-pane'
import { Spinner } from '@workspace/ui/components/spinner'
import { terminalSessionKey } from '@/features/terminal/state/session-registry'
import { useQueryClient } from '@tanstack/react-query'
import { clientForQueryClient, originForQueryClient } from '@/lib/environments/state/query-clients'
import { environmentActivitySignal } from '@/lib/environments/state/activity'
import { cn } from '@workspace/ui/lib/utils'
import type { Terminal, TerminalScrollbar } from 'ghostty-webgpu'
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
import { useFocusService } from '@/lib/focus/hooks/use-service'
import { useFocusTarget } from '@/lib/focus/hooks/use-target'
import { registeredFocusTarget } from '@/lib/focus/state/service'

import { TerminalMenu } from '@/features/terminal/components/menu'
import { useTerminalCommandInbox } from '@/features/terminal/hooks/use-command-inbox'
import { useTerminalKeybindings } from '@/features/terminal/hooks/use-keybindings'
import { useTerminalLinks } from '@/features/terminal/hooks/use-links'
import { readTerminalMenuTarget, type TerminalMenuTarget } from '@/features/terminal/utils/commands'
import { isFocusOutsideElement } from '@/features/terminal/utils/focus-target'
import { useSettingValue } from '@/hooks/use-setting-value'
import { fontStack } from '@/lib/fonts/utils/stack'
import { useUnavailableEnvironment } from '@/lib/environments/hooks/use-unavailable-environment'
import { FixWithAgentButton } from '@/components/fix-with-agent-button'

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
  const fontFamily = fontStack(useSettingValue('editor.fontFamily'), 'code')
  const scrollback = useSettingValue('terminal.integrated.scrollback')
  const contextMenu = useContextMenu()
  const terminalActions = useTerminalActions({ rootPath, terminalId: sessionId })
  const [menuTarget, setMenuTarget] = useState<TerminalMenuTarget | null>(null)
  const [connectedIdentity, setConnectedIdentity] = useState<string | null>(null)
  const [paintedIdentity, setPaintedIdentity] = useState<string | null>(null)
  const [disconnectedPaint, setDisconnectedPaint] = useState<{
    key: string
    paint: string | null
  } | null>(null)
  const displayKey = `${origin}\u0000${rootPath}\u0000${sessionId}\u0000${fontSize}\u0000${fontFamily}\u0000${paletteHash}`
  const display = { root: rootPath, sessionId, fontSize, fontFamily, paletteHash }
  const [rejectedPaint, setRejectedPaint] = useState<{ key: string; paint: string } | null>(null)
  const initialPaint = savedTerminal(queryClient, display)
  const candidate = disconnectedPaint?.key === displayKey ? disconnectedPaint.paint : initialPaint
  const savedPaint =
    rejectedPaint?.key === displayKey && rejectedPaint.paint === candidate ? null : candidate
  const savedScrollRef = useRef<{ paint: string; scrollbar: Readonly<TerminalScrollbar> } | null>(
    null,
  )
  const focusIdentity = terminalSessionKey(rootPath, sessionId)
  const terminalMountIdentity = `${origin}\u0000${focusIdentity}\u0000${scrollback}`
  const hasLivePaint = paintedIdentity === terminalMountIdentity
  const socketConnected = connectedIdentity === terminalMountIdentity && !machineUnavailable
  const [terminalFailure, setTerminalFailure] = useState<{
    identity: string
    message: string
  } | null>(null)
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
        if (intent !== 'focus' || !active || !socketConnected) return false

        const terminal = terminalRef.current
        if (!terminal) return false

        terminal.focus()
        return true
      },
    },
    active && socketConnected,
  )
  const captureTerminalRemountFocus = useEffectEvent(() => {
    restoreFocusAfterRemountRef.current = terminalFocused ? focusIdentity : null
  })
  // ghostty resolves long after the effect that asked for it, so the handover
  // runs as an effect event and sees the current render rather than the one
  // that started the mount.
  const handleTerminalReady = useEffectEvent(
    (terminal: Terminal, sendInput: TerminalInputSender, identity: string) => {
      if (identity !== terminalMountIdentity) return
      terminalRef.current = terminal
      sendInputRef.current = sendInput
      // At handover rather than at construction: ghostty resolves long after the
      // mount effect started, and this is an effect event, so it sees the
      // current settings rather than the ones the mount began with.
      applyTerminalAppearance(terminal, { cursorBlink, fontFamily, fontSize })
      applyTerminalCursorOptions(terminal, terminalCursorOptions(terminalFocused, cursorBlink))
      applyTerminalTheme(terminal, terminalColors)
      registerTerminalLinks(terminal)
    },
  )
  // State, not just the ref: a script queued before the socket opened has to
  // wake the effect that runs it, and writing a ref never re-renders.
  const handleTerminalConnectedChange = useEffectEvent((connected: boolean, identity: string) => {
    if (identity !== terminalMountIdentity) return
    setConnectedIdentity(connected ? identity : null)
    if (connected) {
      setPaintedIdentity(identity)
      return
    }
    setDisconnectedPaint({
      key: displayKey,
      paint: savedTerminal(queryClient, display),
    })
    setMenuTarget(null)
  })
  const handleTerminalCapture = useEffectEvent(
    (
      terminal: Terminal,
      identity: string,
      generation: ReturnType<typeof terminalReloadGeneration>,
    ) => {
      if (!active || identity !== terminalMountIdentity) return
      captureTerminal(queryClient, display, terminal.captureViewport(), generation)
    },
  )
  const readSavedScroll = useEffectEvent(() => {
    const saved = savedScrollRef.current
    return savedPaint && saved?.paint === savedPaint ? saved.scrollbar : null
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
    if (!socketConnected) return
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
    if (!terminal || !socketConnected) return

    event.stopPropagation()
    // Snapshotted here because ghostty drops the selection from a document
    // `click` handler the moment a portalled menu item is pressed.
    setMenuTarget(
      readTerminalMenuTarget(terminal, sessionId, scrollbackLengthRef.current > 0, {
        clearHistory: () => terminalActions.mutate('clear'),
        restart: () => terminalActions.mutate('restart'),
      }),
    )
    contextMenu.openAtEvent(event, event.currentTarget)
  }
  const handleTerminalMenuOpenChange = (open: boolean) => {
    contextMenu.onOpenChange(open)
    if (open) return

    setMenuTarget(null)
  }

  useEffect(() => {
    applyTerminalAppearance(terminalRef.current, { cursorBlink, fontFamily, fontSize })
  }, [cursorBlink, fontFamily, fontSize])

  // Keyed on the content hash, not the mode: a dark-to-dark palette change repaints the ANSI
  // table without a remount, and the same colors arriving as a fresh object repaint nothing.
  const appliedPaletteRef = useRef<string | null>(null)
  useEffect(() => {
    if (appliedPaletteRef.current === paletteHash) return

    appliedPaletteRef.current = paletteHash
    applyTerminalTheme(terminalRef.current, terminalColors)
  }, [paletteHash, terminalColors])

  useEffect(() => {
    if (machineUnavailable) return
    const host = hostRef.current
    if (!host) return

    const generation = terminalReloadGeneration(queryClient)
    const unmountTerminal = mountTerminal({
      origin,
      client: clientForQueryClient(queryClient),
      signal: environmentActivitySignal(origin),
      host,
      rootPath,
      scrollback,
      sessionId,
      onConnectedChange: (connected) =>
        handleTerminalConnectedChange(connected, terminalMountIdentity),
      getSavedScroll: readSavedScroll,
      onCapture: (terminal) => handleTerminalCapture(terminal, terminalMountIdentity, generation),
      onExit: handleTerminalExit,
      onProcessChange: handleTerminalProcessChange,
      onTitleChange: handleTerminalTitleChange,
      onFailed: (message) => setTerminalFailure({ identity: terminalMountIdentity, message }),
      onReady: (terminal, sendInput) =>
        handleTerminalReady(terminal, sendInput, terminalMountIdentity),
      onScrollbackLengthChange: handleTerminalScrollbackLengthChange,
    })

    return () => {
      captureTerminalRemountFocus()
      setConnectedIdentity((current) => (current === terminalMountIdentity ? null : current))
      setPaintedIdentity((current) => (current === terminalMountIdentity ? null : current))
      sendInputRef.current = null
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

  return (
    <ToolPane
      header={null}
      bodyClassName='relative flex min-h-0 min-w-0 flex-col'
      scroll={false}
      aria-label='Terminal'
      {...sectionProps}
      className={cn('relative flex min-h-0 min-w-0 flex-col overflow-hidden', className)}
      onBlurCapture={handleTerminalBlur}
      onContextMenuCapture={handleTerminalContextMenu}
      onFocusCapture={handleTerminalFocus}
      ref={terminalFocusTargetRef}
    >
      <div
        className={cn(
          'min-h-0 min-w-0 flex-1 overflow-hidden px-(--density-control-padding-x) py-(--density-section-gap) font-mono',
          savedPaint && !hasLivePaint && 'invisible',
        )}
        inert={!socketConnected}
        ref={hostRef}
      />
      {savedPaint && !hasLivePaint && active ? (
        <SavedViewport
          key={`${terminalMountIdentity}:${paletteHash}:${fontSize}:${fontFamily}`}
          paint={savedPaint}
          fontFamily={fontFamily}
          fontSize={fontSize}
          onAdmitted={(scrollbar) => {
            savedScrollRef.current = { paint: savedPaint, scrollbar }
          }}
          onRejected={() => {
            savedScrollRef.current = null
            discardTerminal(queryClient, display, savedPaint)
            setRejectedPaint({ key: displayKey, paint: savedPaint })
          }}
        />
      ) : null}
      {!socketConnected && (savedPaint || hasLivePaint) ? (
        <p
          role='status'
          className='text-warning bg-popover-solid absolute right-0 bottom-0 px-2 py-1 text-xs'
        >
          Terminal connection pending. Saved output is read-only.
        </p>
      ) : null}
      {terminalFailure?.identity === terminalMountIdentity ? (
        <div
          role='alert'
          className='absolute inset-0 flex flex-col items-center justify-center gap-(--density-gap-tight) p-4'
        >
          <p className='text-destructive text-sm wrap-anywhere'>{terminalFailure.message}</p>
          <FixWithAgentButton error={{ message: terminalFailure.message, title: 'Terminal' }} />
        </div>
      ) : null}
      {!savedPaint && !hasLivePaint && terminalFailure?.identity !== terminalMountIdentity ? (
        <div className='pointer-events-none absolute inset-0 flex items-center justify-center'>
          <Spinner size='md' label='Opening terminal' />
        </div>
      ) : null}
      {contextMenu.anchor && menuTarget ? (
        <TerminalMenu
          anchor={contextMenu.anchor}
          onOpenChange={handleTerminalMenuOpenChange}
          rootPath={rootPath}
          target={menuTarget}
        />
      ) : null}
    </ToolPane>
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
