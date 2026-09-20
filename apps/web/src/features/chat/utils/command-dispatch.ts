import { elapsedMs } from '@workspace/utils/timing'
import { chatCommandSummary } from '@workspace/contracts'
import type { ClientOrchestrationCommand, OrchestrationDispatchResult } from '@workspace/contracts'

import { errorMessage } from '@/lib/error-message'
import type { ChatTransport } from '@/features/chat/transport/chat-transport'

import {
  createChatPipelineScope,
  type ChatPipelineScope,
} from '@/features/chat/utils/pipeline-logging'

export type DispatchCommand = ChatTransport['dispatchCommand']

export type ChatCommandDispatchOutcome =
  | { readonly ok: true; readonly result: OrchestrationDispatchResult }
  | { readonly error: unknown; readonly message: string; readonly ok: false }

/**
 * The one door every chat command dispatch goes through.
 *
 * Before this existed the same try/catch/finally was hand-copied ten times in
 * three telemetry dialects, so a dashboard over `command.dispatchAcceptedCount`
 * missed every chat-mode action and a grep over `action:"chat.session.*"` missed
 * every chat-view command. Worse, writing the envelope by hand cost enough that
 * four more call sites skipped error handling entirely and dispatched into
 * `void`. One entry point is what makes the telemetry uniform and the rejection
 * boundary free.
 *
 * Never rejects. Every hook it calls is guarded, so `void dispatchChatCommand({…})`
 * is a real rejection boundary — which `void transport.dispatchCommand(…)` was not.
 */
export async function dispatchChatCommand({
  action,
  beforeDispatch,
  command,
  context,
  dispatchCommand,
  onAccepted,
  onFailed,
}: {
  /** The wide event's `action`. Keep the name the call site already used. */
  readonly action: string
  /**
   * Optimistic writes and their counters, on the same wide event. Runs inside
   * the guard: a throw here emits the event with `dispatchFailedCount` and no
   * `dispatchStartCount`, which is exactly "never left the client".
   */
  readonly beforeDispatch?: (scope: ChatPipelineScope) => void
  readonly command: ClientOrchestrationCommand
  /** Extra fields for the wide event, merged over `chatCommandSummary`. */
  readonly context?: Record<string, unknown>
  readonly dispatchCommand: DispatchCommand
  /**
   * Host work the server's acceptance unlocks. Guarded separately: the command
   * is accepted either way, and a host that cannot show the result must not
   * read back as a failed dispatch.
   */
  readonly onAccepted?: (result: OrchestrationDispatchResult) => void
  /** Rollback for whatever the call site committed optimistically. */
  readonly onFailed?: (error: unknown) => void
}): Promise<ChatCommandDispatchOutcome> {
  const startedAt = performance.now()
  const scope = createChatPipelineScope(action, {
    ...chatCommandSummary(command),
    ...context,
  })

  try {
    beforeDispatch?.(scope)
    scope.increment('command.dispatchStartCount')
    const result = await dispatchCommand(command)
    scope.increment('command.dispatchAcceptedCount')
    scope.set({ deduped: result.deduped, outcome: 'ok', sequence: result.sequence })
    runGuarded(() => onAccepted?.(result), scope, 'command.acceptedCallbackFailedCount')

    return { ok: true, result }
  } catch (error) {
    runGuarded(() => onFailed?.(error), scope, 'command.failedCallbackFailedCount')
    scope.increment('command.dispatchFailedCount')
    scope.warn('Chat command dispatch failed.', { error })
    scope.set({ outcome: 'error' })

    return { error, message: errorMessage(error, 'Chat command failed.'), ok: false }
  } finally {
    scope.end({ durationMs: elapsedMs(startedAt) })
  }
}

/**
 * How many events the server appends for this command, so the replay window
 * opens just before the first of them. `result.sequence` is the last committed
 * event: a plain turn start decides message-sent + turn-start-requested, and a
 * bootstrapped one prepends session.created. Everything else replays two wide —
 * one more than a single-event command needs, which replay's idempotence makes
 * free and which is what the call sites already did.
 */
export function replayAfterDispatch(
  command: ClientOrchestrationCommand,
  result: OrchestrationDispatchResult,
) {
  return Math.max(0, result.sequence - eventsCommittedBy(command))
}

function eventsCommittedBy(command: ClientOrchestrationCommand) {
  if (command.type !== 'session.turn.start') return 2

  const bootstrap = command.bootstrap?.createSession
  if (!bootstrap) return 2
  return bootstrap.worktreeTarget.kind === 'new' ? 4 : 3
}

function runGuarded(run: () => void, scope: ChatPipelineScope, counter: string) {
  try {
    run()
  } catch (error) {
    scope.increment(counter)
    scope.warn('Chat command dispatch callback failed.', { error })
  }
}
