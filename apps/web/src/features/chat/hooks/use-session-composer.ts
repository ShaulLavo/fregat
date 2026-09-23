import { useEffect, useEffectEvent } from 'react'
import { useIsMutating, useMutation } from '@tanstack/react-query'
import { scopedSessionKey, type ScopedSessionRef } from '@workspace/contracts'
import { createSessionInterruptCommand } from '@workspace/client-core/chat/commands'
import { isChatSessionBusy } from '@workspace/client-core/chat/session-busy'
import type { ChatSession } from '@workspace/client-core/chat/types'
import { useSettingValue } from '@/hooks/use-setting-value'
import { useSettingsReady } from '@/hooks/use-settings-ready'
import { errorMessage } from '@/lib/error-message'
import type { ChatTransport } from '../transport/chat-transport'
import type { ChatInputSubmitPayload, ChatInputSubmitResult } from '../utils/composed-message'
import type { ChatInputDraftTarget } from '../state/chat-input-draft-store'
import { queuedFollowUps, useFollowUpStore } from '../state/follow-up-store'
import { restoreFollowUps } from '../state/restore-follow-ups'
import { sendFollowUp } from '../state/send-follow-up'
import {
  followUpDue,
  followUpPhase,
  latestCompletedToolActivityId,
} from '../utils/follow-up-policy'
import { chatMutationKeys } from '../utils/mutation-keys'
import { correctionUnavailableReason } from '../utils/composer-state'
import { sessionStopFailure } from '../utils/session-stop'
import { dispatchChatCommand, replayAfterDispatch } from '../utils/command-dispatch'
import { syncSessionProjectionAfterDispatch } from '../utils/command-sync'
import { useProvider } from './use-provider'

export function useSessionComposer({
  transport,
  session,
  target,
  blocked,
}: {
  transport: ChatTransport
  session: ChatSession | undefined
  target: ChatInputDraftTarget
  blocked: boolean
}) {
  const followUpBehavior = useSettingValue('chat.followUpBehavior')
  const settingsReady = useSettingsReady()
  const provider = useProvider(session?.modelSelection.providerInstanceId)
  const ref: ScopedSessionRef | null = session
    ? { environmentId: transport.environmentId, sessionId: session.id }
    : null
  const queue = useFollowUpStore((state) => queuedFollowUps(state, ref))
  const mutationKey = chatMutationKeys.composer(transport.environmentId, session?.id ?? null)
  const sending = useIsMutating({ mutationKey }) > 0
  const busy = isChatSessionBusy(session)
  const latestToolId = latestCompletedToolActivityId(session?.activities ?? [])
  const mutation = useMutation({
    mutationKey,
    scope: { id: `composer:${ref ? scopedSessionKey(ref) : 'none'}` },
    mutationFn: async (
      input:
        | { kind: 'draft'; payload: ChatInputSubmitPayload; alternate: boolean }
        | { kind: 'queued'; id: string },
    ): Promise<ChatInputSubmitResult> => {
      if (!session || !ref || blocked || !settingsReady) return 'rejected'
      return sendFollowUp({ transport, session, target, followUpBehavior, input })
    },
  })
  const stop = useMutation({
    mutationKey: chatMutationKeys.stop(transport.environmentId, session?.id ?? null),
    mutationFn: async () => {
      if (!session || !ref) return null
      restoreFollowUps(ref, useFollowUpStore.getState().drain(ref))
      const command = createSessionInterruptCommand({
        sessionId: session.id,
        turnId: session.latestTurn?.turnId,
      })
      const outcome = await dispatchChatCommand({
        action: 'chat.stop.dispatch.summary',
        command,
        dispatchCommand: transport.dispatchCommand,
      })
      if (!outcome.ok) throw outcome.error
      await syncSessionProjectionAfterDispatch({
        transport,
        sessionId: session.id,
        replayAfterSequence: replayAfterDispatch(command, outcome.result),
      })
      return command
    },
  })
  const restore = useMutation({
    mutationKey: chatMutationKeys.restoreFollowUp(transport.environmentId, session?.id ?? null),
    mutationFn: async (id: string) => {
      if (!ref) return
      const message = useFollowUpStore.getState().remove(ref, id)
      if (message) restoreFollowUps(ref, [message])
    },
  })
  const interruptFailure = sessionStopFailure(session, stop.data ?? null)
  const interrupting =
    stop.isPending ||
    Boolean(
      busy &&
      stop.data &&
      stop.data.sessionId === session?.id &&
      stop.data.turnId === session?.latestTurn?.turnId &&
      !interruptFailure,
    )
  const pendingRequest = Boolean(session?.pendingApprovalCount || session?.pendingUserInputCount)
  const correctionBlocked =
    busy &&
    Boolean(session && (correctionUnavailableReason(session) || provider?.driverKind !== 'codex'))
  const sendBlocked =
    blocked ||
    !settingsReady ||
    !provider ||
    sending ||
    interrupting ||
    pendingRequest ||
    correctionBlocked
  const phase = followUpPhase(busy, session?.runtime?.status === 'starting')
  const next = queue[0]
  const sendQueued = useEffectEvent((id: string) => mutation.mutate({ kind: 'queued', id }))
  useEffect(() => {
    if (!next || sendBlocked) return
    if (followUpDue({ ...next, phase, latestToolActivityId: latestToolId })) sendQueued(next.id)
  }, [next, sendBlocked, phase, latestToolId])

  return {
    queue,
    sending,
    interrupting,
    error:
      interruptFailure ??
      (mutation.error || stop.error
        ? errorMessage(mutation.error ?? stop.error, 'Chat action failed.')
        : null),
    send: (payload: ChatInputSubmitPayload, alternate = false) =>
      mutation
        .mutateAsync({ kind: 'draft', payload, alternate })
        .catch((): ChatInputSubmitResult => 'rejected'),
    stop: () => stop.mutate(),
    sendNow: (id: string) => {
      if (!sendBlocked) mutation.mutate({ kind: 'queued', id })
    },
    restore: (id: string) => restore.mutate(id),
    sendBlocked,
  }
}
