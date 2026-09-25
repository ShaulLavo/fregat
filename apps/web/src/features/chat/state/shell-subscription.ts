import { errorMessage } from '@/lib/error-message'
import type { ChatTransport } from '@/features/chat/transport/chat-transport'
import {
  selectChatProjectionSlice,
  useChatProjectionStore,
} from '@/features/chat/state/chat-projection-store'
import {
  isBlockedStreamError,
  streamReconnectDelayMs,
} from '@/features/chat/utils/stream-reconnect'

/**
 * What the shell transport is doing right now.
 * - `connecting` / `live` — first attempt, then frames are flowing.
 * - `reconnecting` — the stream died and a backoff rung is being served.
 * - `offline` — the browser says there is no network; parked, no timer burning.
 * - `blocked` — the server refused us (auth) or the resource is gone; retrying
 *   on a timer would never succeed, so we wait for the user to come back.
 */
type ChatShellConnectionPhase = 'blocked' | 'connecting' | 'live' | 'offline' | 'reconnecting'

export type ChatShellSubscriptionState = {
  /** Consecutive failed attempts; zero while live. */
  attempt: number
  error: string | null
  phase: ChatShellConnectionPhase
}

type ShellStreamOutcome = {
  blocked: boolean
  error: string | null
  /** True once the attempt delivered a frame, which proves the transport works. */
  established: boolean
}

type WakeSource = {
  stop: () => void
  /** Resolves `true` when the app woke early, `false` when the delay elapsed. */
  wait: (delayMs: number | null) => Promise<boolean>
}

type ShellSupervisor = {
  transport: ChatTransport
  setState: (state: ChatShellSubscriptionState) => void
  signal: AbortSignal
  wake: WakeSource
}

const SHELL_STREAM_FAILED = 'Chat connection failed.'
export const CONNECTING_STATE: ChatShellSubscriptionState = {
  attempt: 0,
  error: null,
  phase: 'connecting',
}

export function subscribeChatShell(
  transport: ChatTransport,
  setState: (state: ChatShellSubscriptionState) => void,
) {
  const abortController = new AbortController()
  const wake = createWakeSource()
  void superviseShellSubscription({ transport, setState, signal: abortController.signal, wake })
  return () => {
    abortController.abort()
    wake.stop()
  }
}

/**
 * A fixed retry interval hammered an unreachable (or rejecting) server forever.
 * This walks the shared backoff ladder instead, parks while the browser is
 * offline or the server refused us, and treats a wake — regaining network,
 * refocusing the tab — as a probe that resets the ladder.
 */
async function superviseShellSubscription(supervisor: ShellSupervisor) {
  let failureCount = 0
  let lastError: string | null = null

  while (!supervisor.signal.aborted) {
    if (!isBrowserOnline()) {
      supervisor.setState({ attempt: failureCount, error: lastError, phase: 'offline' })
      await supervisor.wake.wait(null)
      failureCount = 0
      continue
    }

    supervisor.setState({
      attempt: failureCount,
      error: lastError,
      phase: connectingPhase(failureCount),
    })
    const outcome = await runShellStream(supervisor)
    if (supervisor.signal.aborted) return

    lastError = outcome.error
    // An attempt that ran proves the transport works, so its failure starts the
    // ladder from the bottom instead of the rung it happened to die on.
    if (outcome.established) failureCount = 0
    if (outcome.blocked) {
      supervisor.setState({ attempt: failureCount, error: lastError, phase: 'blocked' })
      await supervisor.wake.wait(null)
      failureCount = 0
      continue
    }

    failureCount += 1
    supervisor.setState({ attempt: failureCount, error: lastError, phase: 'reconnecting' })
    const wokeEarly = await supervisor.wake.wait(streamReconnectDelayMs(failureCount))
    if (!wokeEarly) continue

    failureCount = 0
  }
}

async function runShellStream(supervisor: ShellSupervisor): Promise<ShellStreamOutcome> {
  let live = false
  const markLive = () => {
    if (live || supervisor.signal.aborted || supervisor.transport.closed) return
    live = true
    supervisor.setState({ attempt: 0, error: null, phase: 'live' })
  }

  try {
    const afterSequence = selectChatProjectionSlice(
      useChatProjectionStore.getState(),
      supervisor.transport.environmentId,
    ).lastAppliedShellSequence

    for await (const item of supervisor.transport.shellStream({
      afterSequence,
      onSynchronized: markLive,
      signal: supervisor.signal,
    })) {
      if (supervisor.signal.aborted || supervisor.transport.closed)
        return { blocked: false, error: null, established: live }
      useChatProjectionStore
        .getState()
        .applyShellStreamItem(supervisor.transport.environmentId, item)
    }

    return { blocked: false, error: null, established: live }
  } catch (error) {
    if (supervisor.signal.aborted) return { blocked: false, error: null, established: live }

    return {
      blocked: isBlockedStreamError(error),
      error: errorMessage(error, SHELL_STREAM_FAILED),
      established: live,
    }
  }
}

function connectingPhase(failureCount: number): ChatShellConnectionPhase {
  if (failureCount === 0) return 'connecting'

  return 'reconnecting'
}

function isBrowserOnline() {
  if (typeof navigator === 'undefined') return true

  return navigator.onLine !== false
}

/**
 * Wake signals: regaining network, refocusing the window, or the tab becoming
 * visible again. Any of them short-circuits a pending backoff sleep so a user
 * returning to the app gets an immediate probe instead of the rest of the rung.
 */
function createWakeSource(): WakeSource {
  const waiters = new Set<(woke: boolean) => void>()

  // Copied: settling a waiter removes it from the set mid-iteration.
  const notify = () => {
    for (const settle of Array.from(waiters)) {
      settle(true)
    }
  }
  const notifyIfVisible = () => {
    if (document.visibilityState !== 'visible') return

    notify()
  }

  window.addEventListener('online', notify)
  window.addEventListener('focus', notify)
  document.addEventListener('visibilitychange', notifyIfVisible)

  return {
    stop: () => {
      window.removeEventListener('online', notify)
      window.removeEventListener('focus', notify)
      document.removeEventListener('visibilitychange', notifyIfVisible)

      for (const settle of Array.from(waiters)) {
        settle(false)
      }
    },
    wait: (delayMs) => waitForWake(waiters, delayMs),
  }
}

function waitForWake(waiters: Set<(woke: boolean) => void>, delayMs: number | null) {
  return new Promise<boolean>((resolve) => {
    const settle = (woke: boolean) => {
      waiters.delete(settle)
      if (timeoutId !== null) window.clearTimeout(timeoutId)
      resolve(woke)
    }
    const timeoutId = delayMs === null ? null : window.setTimeout(() => settle(false), delayMs)

    waiters.add(settle)
  })
}
