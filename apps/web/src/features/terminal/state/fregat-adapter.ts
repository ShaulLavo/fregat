import { isCancelledError } from '@tanstack/react-query'
import type {
  HotkeyAdapter,
  Subscribable,
  TerminalAdapter,
  TerminalAttachment,
  TerminalSavedScroll,
  TerminalSessionInfo,
  TerminalStreamEvent,
} from '@shaulavo/workbench-core'
import type { TerminalThemeInput } from '@shaulavo/workbench-terminal'
import type { ServerSocket } from '@workspace/client-core/transport/socket'
import { parseTerminalServerMessage, type TerminalServerMessage } from '@workspace/contracts'
import type { TerminalColors } from '@workspace/contracts/themes/palette-rendering'
import type { GhosttyRuntime } from 'ghostty-webgpu'
import type { BrowserDispatcher, FocusNode } from '@shaulavo/hotkeys'

import { fetchTerminalCheckout } from '@/features/terminal/state/register-checkout'
import { initializeGhostty } from '@/features/terminal/state/runtime'
import {
  registerTerminalSession,
  terminalSessionKey,
} from '@/features/terminal/state/session-registry'
import { sendTerminalClientMessage } from '@/features/terminal/utils/socket'
import type { Client } from '@/lib/client'
import { environmentActivitySignal } from '@/lib/environments/state/activity'
import { queryClientFor } from '@/lib/environments/state/query-clients'
import { connectTerminalSocket } from '@/lib/server-sockets'
import { startPageSubscription } from '@/lib/state/page-subscription'

const EMPTY_SESSIONS: Subscribable<readonly TerminalSessionInfo[]> = {
  getSnapshot: () => [],
  subscribe: () => () => {},
}

const EMPTY_ID: Subscribable<string | undefined> = {
  getSnapshot: () => undefined,
  subscribe: () => () => {},
}

interface CancelledQueryRetry<T> {
  settled: boolean
  pageActive: boolean
  retryPending: boolean
  retryTimer: ReturnType<typeof setTimeout> | undefined
  stopPageSubscription: () => void
  readonly signal: AbortSignal
  readonly run: () => Promise<T>
  readonly resolve: (value: T) => void
  readonly reject: (reason: unknown) => void
  readonly onAbort: () => void
}

function finishCancelledQueryRetry<T>(retry: CancelledQueryRetry<T>, outcome: () => void): void {
  if (retry.settled) return
  retry.settled = true
  clearTimeout(retry.retryTimer)
  retry.stopPageSubscription()
  retry.signal.removeEventListener('abort', retry.onAbort)
  outcome()
}

function scheduleCancelledQueryRetry<T>(retry: CancelledQueryRetry<T>): void {
  if (retry.settled || !retry.retryPending || !retry.pageActive || retry.signal.aborted) return
  runCancelledQueryAttempt(retry)
}

function handleCancelledQueryError<T>(retry: CancelledQueryRetry<T>, error: unknown): void {
  if (retry.settled || retry.signal.aborted || !isCancelledError(error)) {
    finishCancelledQueryRetry(retry, () => retry.reject(error))
    return
  }
  retry.retryPending = true
  // A native departure can run this rejection before the mount's departure handler.
  retry.retryTimer = setTimeout(() => scheduleCancelledQueryRetry(retry), 0)
}

function runCancelledQueryAttempt<T>(retry: CancelledQueryRetry<T>): void {
  retry.retryPending = false
  clearTimeout(retry.retryTimer)
  void retry.run().then(
    (value) => finishCancelledQueryRetry(retry, () => retry.resolve(value)),
    (error: unknown) => handleCancelledQueryError(retry, error),
  )
}

function subscribeToPageActivity<T>(retry: CancelledQueryRetry<T>): () => void {
  return startPageSubscription(() => {
    retry.pageActive = true
    scheduleCancelledQueryRetry(retry)
    return () => {
      retry.pageActive = false
    }
  })
}

function attachCancelledQueryRetry<T>(
  signal: AbortSignal,
  run: () => Promise<T>,
  resolve: (value: T) => void,
  reject: (reason: unknown) => void,
): void {
  const retry: CancelledQueryRetry<T> = {
    settled: false,
    pageActive: true,
    retryPending: false,
    retryTimer: undefined,
    stopPageSubscription: () => {},
    signal,
    run,
    resolve,
    reject,
    onAbort: () => finishCancelledQueryRetry(retry, () => reject(signal.reason)),
  }
  retry.stopPageSubscription = subscribeToPageActivity(retry)
  if (signal.aborted) return retry.onAbort()
  signal.addEventListener('abort', retry.onAbort, { once: true })
  runCancelledQueryAttempt(retry)
}

/**
 * Retries a TanStack Query call when `pagehide` / `beforeunload` cancelled it, resuming once
 * `pageshow` restores the page (or immediately on the next macrotask after an early restore).
 */
function retryOnCancelledPageQuery<T>(signal: AbortSignal, run: () => Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    attachCancelledQueryRetry(signal, run, resolve, reject)
  })
}

export function createFregatRuntimeLoader(
  origin: string,
  explicitSignal?: AbortSignal,
): (viewSignal: AbortSignal) => Promise<GhosttyRuntime> {
  return (viewSignal) =>
    retryOnCancelledPageQuery(
      AbortSignal.any([explicitSignal ?? environmentActivitySignal(origin), viewSignal]),
      initializeGhostty,
    )
}

export function buildFregatThemeInput(options: {
  readonly colors: TerminalColors
  readonly colorScheme: 'light' | 'dark'
  readonly fontFamily: string
  readonly fontSize: number
  readonly cursorBlink: boolean
}): TerminalThemeInput {
  const { colors, colorScheme, fontFamily, fontSize, cursorBlink } = options
  return {
    colorScheme,
    // The panel paints the backdrop (theme color or wallpaper) behind the transparent grid.
    background: colors.cursorAccent,
    foreground: colors.foreground,
    cursor: colors.cursor,
    cursorAccent: colors.cursorAccent,
    selectionBackground: colors.selection,
    selectionForeground: colors.selectionForeground,
    ansi: colors.ansi,
    backgroundOpacity: 0,
    fontFamily,
    fontSize,
    // Matches SavedViewport's exact cell height so replay handoff has zero vertical jump.
    lineHeight: 1,
    cursorBlink,
  }
}

export interface FregatSavedScrollStore {
  setPaint(paint: string | null): void
  setAdmitted(paint: string, scrollbar: TerminalSavedScroll): void
  clear(): void
  read(): TerminalSavedScroll | null
}

export function createFregatSavedScrollStore(): FregatSavedScrollStore {
  let activePaint: string | null = null
  let admitted: { readonly paint: string; readonly scrollbar: TerminalSavedScroll } | null = null
  return {
    setPaint(paint) {
      activePaint = paint
    },
    setAdmitted(paint, scrollbar) {
      admitted = { paint, scrollbar }
    },
    clear() {
      admitted = null
    },
    read() {
      return activePaint && admitted?.paint === activePaint ? admitted.scrollbar : null
    },
  }
}

export interface FregatThemeStore {
  readonly subscribable: Subscribable<TerminalThemeInput>
  update(next: TerminalThemeInput, key: string): void
}

export function createFregatThemeStore(
  initial: TerminalThemeInput,
  initialKey: string,
): FregatThemeStore {
  let current = initial
  let currentKey = initialKey
  const listeners = new Set<() => void>()
  return {
    subscribable: {
      getSnapshot: () => current,
      subscribe(listener) {
        listeners.add(listener)
        return () => {
          listeners.delete(listener)
        }
      },
    },
    update(next, key) {
      if (key === currentKey) return
      current = next
      currentKey = key
      for (const listener of listeners) listener()
    },
  }
}

export function createFregatHotkeyAdapter(scope: {
  readonly dispatcher: BrowserDispatcher
  readonly parent: FocusNode<KeyboardEvent>
}): HotkeyAdapter {
  return {
    registerCommands: () => () => {},
    getBindings: () => [],
    formatHint: () => undefined,
    isTextEntryTarget: () => false,
    getTerminalParentScope: () => scope,
  }
}

function toStreamEvent(message: TerminalServerMessage): TerminalStreamEvent {
  if (message.type === 'ready') {
    return { type: 'ready', restoredHistory: message.restoredHistory }
  }
  if (message.type === 'replay-complete') return { type: 'replay-complete' }
  if (message.type === 'cleared') return { type: 'cleared' }
  if (message.type === 'output') return { type: 'output', data: message.data }
  if (message.type === 'process') return { type: 'process', name: message.name }
  if (message.type === 'exit') return { type: 'exit', exitCode: message.exitCode }
  return { type: 'error', message: message.message }
}

function closeSocket(socket: ServerSocket | null): void {
  if (!socket || socket.readyState === 2 || socket.readyState === 3) return
  socket.close()
}

export interface CreateFregatTerminalAdapterOptions {
  readonly origin: string
  readonly client: Client
  readonly rootPath: string
  readonly signal?: AbortSignal
  readonly getSavedScroll: () => TerminalSavedScroll | null
}

export interface FregatTerminalAdapter extends TerminalAdapter {
  tryWrite(attachment: TerminalAttachment, data: string): boolean
}

export function createFregatTerminalAdapter({
  origin,
  client,
  rootPath,
  signal: explicitSignal,
  getSavedScroll,
}: CreateFregatTerminalAdapterOptions): FregatTerminalAdapter {
  const inputEncoder = new TextEncoder()
  const writers = new WeakMap<TerminalAttachment, (data: string) => boolean>()

  return {
    sessions: EMPTY_SESSIONS,
    activeId: EMPTY_ID,
    splitId: EMPTY_ID,
    createSession: async () => '',
    closeSession: async () => {},
    selectSession: () => {},
    renameSession: () => {},
    toggleSplit: () => {},
    getSavedScroll: () => getSavedScroll(),
    tryWrite(attachment, data) {
      return writers.get(attachment)?.(data) ?? false
    },
    async attach(sessionId, { signal: viewSignal, onEvent }) {
      const envSignal = explicitSignal ?? environmentActivitySignal(origin)
      const combined = AbortSignal.any([envSignal, viewSignal])
      const worktreeId = await retryOnCancelledPageQuery(combined, () =>
        fetchTerminalCheckout(queryClientFor(origin), rootPath),
      )
      if (combined.aborted) {
        return { write: () => {}, resize: () => {}, detach: () => {} }
      }

      const socket = connectTerminalSocket({ worktreeId, terminalId: sessionId }, client, combined)
      const onClose = () => {
        onEvent({ type: 'disconnected', willReconnect: false })
      }
      const onMessage: EventListener = (event) => {
        if (combined.aborted) return
        const message = parseTerminalServerMessage((event as MessageEvent).data)
        if (!message) return
        onEvent(toStreamEvent(message))
      }
      socket.addEventListener('close', onClose)
      socket.addEventListener('message', onMessage)

      const unregisterSession = registerTerminalSession(terminalSessionKey(rootPath, sessionId), {
        dispose: () => sendTerminalClientMessage(socket, { type: 'dispose' }),
      })

      let detached = false
      const sendInput = (data: string) => {
        if (detached) return false
        return sendTerminalClientMessage(socket, { data: inputEncoder.encode(data), type: 'input' })
      }
      const attachment: TerminalAttachment = {
        write(data) {
          sendInput(data)
        },
        writeBytes(bytes) {
          if (detached) return
          sendTerminalClientMessage(socket, { data: bytes, type: 'input' })
        },
        resize(cols, rows) {
          if (detached) return
          sendTerminalClientMessage(socket, { cols, rows, type: 'resize' })
        },
        detach() {
          if (detached) return
          detached = true
          writers.delete(attachment)
          unregisterSession()
          socket.removeEventListener('message', onMessage)
          socket.removeEventListener('close', onClose)
          closeSocket(socket)
        },
      }
      writers.set(attachment, sendInput)
      return attachment
    },
  }
}
