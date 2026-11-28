import { TerminalView } from '@shaulavo/workbench-terminal'
import type { TerminalAttachment } from '@shaulavo/workbench-core'
import { useQueryClient } from '@tanstack/react-query'
import { Spinner } from '@workspace/ui/components/spinner'
import { cn } from '@workspace/ui/lib/utils'
import { playFeedback } from '@workspace/ui/patterns/feedback-layer'
import { ToolPane } from '@workspace/ui/patterns/tool-pane'
import { elapsedMs, nowMs } from '@workspace/utils/timing'
import type { Terminal } from 'ghostty-webgpu'
import {
  useEffect,
  useEffectEvent,
  useRef,
  useState,
  type ComponentPropsWithoutRef,
  type MouseEvent as ReactMouseEvent,
} from 'react'

import { FixWithAgentButton } from '@/components/fix-with-agent-button'
import { ConnectionNotice } from '@/features/terminal/components/connection-notice'
import { TerminalMenu } from '@/features/terminal/components/menu'
import { OutputTiming } from '@/features/terminal/components/output-timing'
import { SavedViewport } from '@/features/terminal/components/saved-viewport'
import { useTerminalCommandInbox } from '@/features/terminal/hooks/use-command-inbox'
import { useTerminalLinks } from '@/features/terminal/hooks/use-links'
import { useTerminalOutputTiming } from '@/features/terminal/hooks/use-output-timing'
import { useTerminalActions } from '@/features/terminal/hooks/use-terminal-actions'
import {
  buildFregatThemeInput,
  createFregatHotkeyAdapter,
  createFregatRuntimeLoader,
  createFregatSavedScrollStore,
  createFregatTerminalAdapter,
  createFregatThemeStore,
} from '@/features/terminal/state/fregat-adapter'
import {
  captureTerminal,
  discardTerminal,
  savedTerminal,
  terminalReloadGeneration,
} from '@/features/terminal/state/reload'
import { terminalSessionKey } from '@/features/terminal/state/session-registry'
import { readTerminalMenuTarget, type TerminalMenuTarget } from '@/features/terminal/utils/commands'
import { useSettingValue } from '@/hooks/use-setting-value'
import { useCommand } from '@/keymap/hooks/use-command'
import { useContextMenu } from '@/keymap/menus/hooks/use-context-menu'
import { usePalette } from '@/lib/appearance/hooks/use-palette'
import { toClientError } from '@/lib/client-error-taxonomy'
import { reportError } from '@/lib/client-error-feedback'
import { log } from '@/lib/client-logging'
import { useServerRestarting } from '@/lib/environments/hooks/use-server-restarting'
import { useUnavailableEnvironment } from '@/lib/environments/hooks/use-unavailable-environment'
import { clientForQueryClient, originForQueryClient } from '@/lib/environments/state/query-clients'
import { useFocusService } from '@/lib/focus/hooks/use-service'
import { useFocusTarget } from '@/lib/focus/hooks/use-target'
import { registeredFocusTarget } from '@/lib/focus/state/service'
import { fontStack } from '@/lib/fonts/utils/stack'
import { addLifecycleFlush } from '@/lib/lifecycle-flush'

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
  const serverRestarting = useServerRestarting()
  const queryClient = useQueryClient()
  const origin = originForQueryClient(queryClient)
  const focus = useFocusService()
  const { keymap } = useCommand()
  const restoreFocusAfterRemountRef = useRef<string | null>(null)
  const scrollbackLengthRef = useRef(0)
  const sendInputRef = useRef<((data: string) => boolean) | null>(null)
  const attachmentRef = useRef<TerminalAttachment | null>(null)
  const inputReadyRef = useRef(false)
  const terminalRef = useRef<Terminal | null>(null)
  const mountStartedAtRef = useRef(nowMs())
  const captureTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  // State as well as the ref: the timing readout subscribes to whichever terminal is mounted.
  const [liveTerminal, setLiveTerminal] = useState<Terminal | null>(null)
  const { resolved: palette } = usePalette()
  const terminalColors = palette.terminal
  const paletteHash = palette.contentHash
  const colorScheme = palette.mode === 'light' ? 'light' : 'dark'
  const cursorBlink = useSettingValue('terminal.integrated.cursorBlinking')
  const fontSize = useSettingValue('terminal.integrated.fontSize')
  const fontFamily = fontStack(useSettingValue('editor.fontFamily'), 'code')
  const screenReader = useSettingValue('terminal.integrated.screenReader')
  const scrollback = useSettingValue('terminal.integrated.scrollback')
  const lowLatency = useSettingValue('terminal.integrated.lowLatencyRendering')
  const showOutputTiming = useSettingValue('terminal.integrated.showOutputTiming')
  const contextMenu = useContextMenu()
  const terminalActions = useTerminalActions({ rootPath, terminalId: sessionId })
  const [menuTarget, setMenuTarget] = useState<TerminalMenuTarget | null>(null)
  const [connectedIdentity, setConnectedIdentity] = useState<string | null>(null)
  const [paintedIdentity, setPaintedIdentity] = useState<string | null>(null)
  // Counts the times the terminal started accepting input, so a restart of the shell on the same
  // socket and canvas is observable even when the canvas never looks disconnected.
  const [inputGeneration, setInputGeneration] = useState(0)
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
  const [savedScrollStore] = useState(createFregatSavedScrollStore)
  const focusIdentity = terminalSessionKey(rootPath, sessionId)
  const terminalMountIdentity = `${origin}\u0000${focusIdentity}\u0000${scrollback}`
  const hasLivePaint = paintedIdentity === terminalMountIdentity
  const socketConnected = connectedIdentity === terminalMountIdentity && !machineUnavailable
  const [terminalFailure, setTerminalFailure] = useState<{
    identity: string
    message: string
  } | null>(null)
  const outputTiming = useTerminalOutputTiming(liveTerminal, showOutputTiming && socketConnected)
  const registerTerminalLinks = useTerminalLinks(rootPath)
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

  const themeKey = `${paletteHash}\u0000${colorScheme}\u0000${fontFamily}\u0000${fontSize}\u0000${cursorBlink}`
  const [themeStore] = useState(() =>
    createFregatThemeStore(
      buildFregatThemeInput({
        colors: terminalColors,
        colorScheme,
        fontFamily,
        fontSize,
        cursorBlink,
      }),
      themeKey,
    ),
  )
  useEffect(() => {
    themeStore.update(
      buildFregatThemeInput({
        colors: terminalColors,
        colorScheme,
        fontFamily,
        fontSize,
        cursorBlink,
      }),
      themeKey,
    )
  }, [themeStore, terminalColors, colorScheme, fontFamily, fontSize, cursorBlink, themeKey])

  useEffect(() => {
    savedScrollStore.setPaint(savedPaint)
  }, [savedScrollStore, savedPaint])
  const reloadGenerationRef = useRef(terminalReloadGeneration(queryClient))
  const flushCapture = () => {
    clearTimeout(captureTimerRef.current)
    captureTimerRef.current = undefined
    const terminal = terminalRef.current
    if (!terminal || !inputReadyRef.current || !active) return
    captureTerminal(queryClient, display, terminal.captureViewport(), reloadGenerationRef.current)
  }
  const flushCaptureOnLifecycle = useEffectEvent(() => flushCapture())
  const captureRemountFocus = useEffectEvent(() => {
    restoreFocusAfterRemountRef.current = terminalFocused ? focusIdentity : null
  })

  const adapterKey = `${origin}\u0000${rootPath}`
  const [adapterState, setAdapterState] = useState(() => ({
    key: adapterKey,
    adapter: createFregatTerminalAdapter({
      origin,
      client: clientForQueryClient(queryClient),
      rootPath,
      getSavedScroll: () => savedScrollStore.read(),
    }),
    loadRuntime: createFregatRuntimeLoader(origin),
  }))
  if (adapterState.key !== adapterKey) {
    setAdapterState({
      key: adapterKey,
      adapter: createFregatTerminalAdapter({
        origin,
        client: clientForQueryClient(queryClient),
        rootPath,
        getSavedScroll: () => savedScrollStore.read(),
      }),
      loadRuntime: createFregatRuntimeLoader(origin),
    })
  }

  const hotkeyScopeParent = keymap.parentFor('terminal')
  const [hotkeyState, setHotkeyState] = useState(() => ({
    dispatcher: keymap.hotkeys,
    parent: hotkeyScopeParent,
    adapter: createFregatHotkeyAdapter({
      dispatcher: keymap.hotkeys,
      parent: hotkeyScopeParent,
    }),
  }))
  if (hotkeyState.dispatcher !== keymap.hotkeys || hotkeyState.parent !== hotkeyScopeParent) {
    setHotkeyState({
      dispatcher: keymap.hotkeys,
      parent: hotkeyScopeParent,
      adapter: createFregatHotkeyAdapter({
        dispatcher: keymap.hotkeys,
        parent: hotkeyScopeParent,
      }),
    })
  }

  useEffect(() => {
    mountStartedAtRef.current = nowMs()
    reloadGenerationRef.current = terminalReloadGeneration(queryClient)
    const removeFlush = addLifecycleFlush(() => flushCaptureOnLifecycle())
    return () => {
      removeFlush()
      captureRemountFocus()
      clearTimeout(captureTimerRef.current)
      captureTimerRef.current = undefined
      setConnectedIdentity((current) => (current === terminalMountIdentity ? null : current))
      setPaintedIdentity((current) => (current === terminalMountIdentity ? null : current))
      sendInputRef.current = null
      attachmentRef.current = null
      inputReadyRef.current = false
      scrollbackLengthRef.current = 0
      terminalRef.current = null
      setLiveTerminal(null)
      setMenuTarget(null)
    }
  }, [machineUnavailable, queryClient, terminalMountIdentity, lowLatency])

  useEffect(() => {
    if (!terminalFocusTargetToken) return
    const restoreIdentity = restoreFocusAfterRemountRef.current
    restoreFocusAfterRemountRef.current = null
    if (restoreIdentity !== focusIdentity) return
    const snapshot = focus.getSnapshot()
    if (snapshot.currentOwner || snapshot.requested) return
    void focus.request(registeredFocusTarget(terminalFocusTargetToken)).completion
  }, [focus, focusIdentity, terminalFocusTargetToken])

  const handleReadyChange = (ready: boolean) => {
    if (!ready) flushCapture()
    inputReadyRef.current = ready
    setConnectedIdentity(ready ? terminalMountIdentity : null)
    if (ready) {
      setPaintedIdentity(terminalMountIdentity)
      setInputGeneration((generation) => generation + 1)
      flushCapture()
      return
    }
    setDisconnectedPaint({
      key: displayKey,
      paint: savedTerminal(queryClient, display),
    })
    setMenuTarget(null)
  }

  const handleTerminalReady = (terminal: Terminal) => {
    terminalRef.current = terminal
    setLiveTerminal(terminal)
    registerTerminalLinks(terminal)
    log.info({
      action: 'terminal.mount',
      area: 'terminal',
      durationMs: elapsedMs(mountStartedAtRef.current),
      rendererBackend: terminal.diagnostics.rendererBackend ?? null,
      desynchronized: terminal.diagnostics.desynchronized,
      sessionId,
    })
    sendInputRef.current = (data) => {
      if (!inputReadyRef.current || !attachmentRef.current) return false
      const sent = adapterState.adapter.tryWrite(attachmentRef.current, data)
      if (!sent) setConnectedIdentity(null)
      return sent
    }
  }

  const handleBeforeDispose = () => {
    flushCapture()
    clearTimeout(captureTimerRef.current)
    captureTimerRef.current = undefined
    terminalRef.current = null
    attachmentRef.current = null
    sendInputRef.current = null
    inputReadyRef.current = false
    setLiveTerminal(null)
  }

  const handleTerminalAttached = (_terminal: Terminal, attachment: TerminalAttachment) => {
    attachmentRef.current = attachment
  }

  const handleFramePainted = () => {
    if (!inputReadyRef.current || captureTimerRef.current !== undefined) return
    captureTimerRef.current = setTimeout(() => flushCapture(), 250)
  }

  const handleTerminalContextMenu = (
    event: ReactMouseEvent<HTMLDivElement>,
    terminal: Terminal | null,
  ) => {
    if (!terminal || !socketConnected) return
    event.stopPropagation()
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

  return (
    <ToolPane
      header={null}
      bodyClassName='relative flex min-h-0 min-w-0 flex-col'
      scroll={false}
      aria-label='Terminal'
      {...sectionProps}
      className={cn('relative flex min-h-0 min-w-0 flex-col overflow-hidden', className)}
      ref={terminalFocusTargetRef}
    >
      <div
        className='relative flex min-h-0 min-w-0 flex-1 flex-col'
        data-terminal-input-generation={inputGeneration}
      >
        {!machineUnavailable ? (
          <TerminalView
            adapter={adapterState.adapter}
            sessionId={sessionId}
            active={active}
            loadRuntime={adapterState.loadRuntime}
            themeOverride={themeStore.subscribable}
            backgroundOpacity={0}
            cursorBlink={cursorBlink}
            scrollbackLimit={scrollback}
            lowLatency={lowLatency}
            screenReader={screenReader}
            hotkeys={hotkeyState.adapter}
            onHotkeyError={(cause, operation) =>
              reportError({ ...toClientError(cause), operation })
            }
            disableContextMenu
            inertWhenNotReady
            className='flex min-h-0 min-w-0 flex-1 flex-col'
            canvasHostClassName={cn(
              'min-h-0 min-w-0 flex-1 overflow-hidden px-(--density-control-padding-x) py-(--density-section-gap) font-mono',
              savedPaint && !hasLivePaint && 'invisible',
            )}
            onTerminalReady={handleTerminalReady}
            onBeforeDispose={handleBeforeDispose}
            onAttached={handleTerminalAttached}
            onReadyChange={handleReadyChange}
            onFramePainted={handleFramePainted}
            onScrollbackLengthChange={(length) => {
              scrollbackLengthRef.current = length
            }}
            onBell={() => playFeedback('bell', 'terminalBell')}
            onExit={onExit}
            onProcessChange={onProcessChange}
            onTitleChange={onTitleChange}
            onContextMenuCapture={handleTerminalContextMenu}
            renderError={() => null}
            onError={(_message, cause) => {
              setTerminalFailure({
                identity: terminalMountIdentity,
                message: 'Could not open the terminal. Close this terminal tab and open a new one.',
              })
              reportError(toClientError(cause))
            }}
          />
        ) : null}
      </div>
      {savedPaint && !hasLivePaint && active ? (
        <SavedViewport
          key={`${terminalMountIdentity}:${paletteHash}:${fontSize}:${fontFamily}`}
          paint={savedPaint}
          fontFamily={fontFamily}
          fontSize={fontSize}
          onAdmitted={(scrollbar) => {
            savedScrollStore.setAdmitted(savedPaint, scrollbar)
          }}
          onRejected={() => {
            savedScrollStore.clear()
            discardTerminal(queryClient, display, savedPaint)
            setRejectedPaint({ key: displayKey, paint: savedPaint })
          }}
        />
      ) : null}
      {outputTiming ? <OutputTiming timing={outputTiming} /> : null}
      {/* Keyed: the socket reconnects just after a restart ends, so the warning waits afresh. */}
      {!socketConnected && (machineUnavailable || savedPaint || hasLivePaint) ? (
        <ConnectionNotice
          key={serverRestarting ? 'restarting' : 'pending'}
          restarting={serverRestarting}
          unreachable={unavailable ? (unavailable.label ?? unavailable.name) : null}
        />
      ) : null}
      {!machineUnavailable && terminalFailure?.identity === terminalMountIdentity ? (
        <div
          role='alert'
          className='absolute inset-0 flex flex-col items-center justify-center gap-(--density-gap-tight) p-4'
        >
          <p className='text-destructive text-sm wrap-anywhere'>{terminalFailure.message}</p>
          <FixWithAgentButton error={{ message: terminalFailure.message, title: 'Terminal' }} />
        </div>
      ) : null}
      {!machineUnavailable &&
      !savedPaint &&
      !hasLivePaint &&
      terminalFailure?.identity !== terminalMountIdentity ? (
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
