import { useActiveChatProjection } from '@/features/chat/hooks/use-active-projection'
import type { InteractionMode, RuntimeMode, SessionId } from '@workspace/contracts'
import { useRef } from 'react'

import { useElementWidth } from '@/features/workspace/hooks/use-element-width'
import { contextUsageForActivities } from '@workspace/client-core/chat/context-usage'
import { selectChatSessionById } from '@workspace/client-core/chat/selectors'
import type { ChatInputDraftTarget } from '@/features/chat/state/chat-input-draft-store'
import { ChatInputAttachButton } from './chat-input-attach-button'
import { ChatInputSubmitButton } from './chat-input-submit-button'
import { ComposerControlsMenu } from './composer-controls-menu'
import { ContextUsageRing } from './context-usage-ring'
import { ModelOptionsMenu } from './model-options-menu'
import { ModelPicker } from './model-picker'
import { PromptStashBadge } from './prompt-stash-badge'
import type { ComposerPendingAction } from '@/features/chat/utils/composer-state'

/**
 * Below this the control row cannot hold its labels and the send button at once.
 * The composer lives in both a ~300px side panel and a full-width stage, so the
 * layout is decided by the measured row rather than by a viewport breakpoint.
 */
const COMPACT_ACTIONS_WIDTH = 380

const EMPTY_ACTIVITIES: readonly [] = []

export function ChatInputActions({
  busy,
  correctionDisabledReason = null,
  disabled,
  disabledReason = null,
  draftTarget,
  interactionMode,
  onSelectImageFiles,
  onStop,
  onSubmit,
  pendingAction = null,
  runtimeMode,
  sendDisabled,
  statusLabel,
}: {
  busy: boolean
  correctionDisabledReason?: string | null
  disabled: boolean
  disabledReason?: string | null
  pendingAction?: ComposerPendingAction
  draftTarget: ChatInputDraftTarget
  interactionMode: InteractionMode
  onSelectImageFiles: (files: readonly File[]) => void
  onStop: () => void
  onSubmit: () => Promise<boolean>
  runtimeMode: RuntimeMode
  sendDisabled: boolean
  statusLabel: string | null
}) {
  const actionsRef = useRef<HTMLDivElement | null>(null)
  const width = useElementWidth(actionsRef)
  // Only once measured: assuming compact before the first layout would flash the
  // whole row through its narrow arrangement on every mount.
  const compact = width !== null && width < COMPACT_ACTIONS_WIDTH
  // The context-window snapshots live on the session detail, so the composer
  // reads them for the session it is drafting into. A draft key that is not a
  // session finds nothing, which is the correct answer: no session, no usage.
  const activities = useActiveChatProjection(
    (state) =>
      selectChatSessionById(state, draftTarget.draftKey as SessionId | null)?.activities ??
      EMPTY_ACTIVITIES,
  )
  const contextUsage = contextUsageForActivities(activities)

  return (
    <div
      className='flex min-w-0 flex-col gap-1 px-(--density-control-padding-x) pb-(--density-section-gap)'
      data-composer-actions
      data-compact={compact}
      ref={actionsRef}
    >
      <div className='flex min-w-0 items-center justify-between gap-2'>
        <div className='flex min-w-0 flex-1 items-center gap-1'>
          <ModelPicker busy={busy} disabled={disabled} />
          <ComposerControlsMenu
            disabled={disabled}
            draftTarget={draftTarget}
            interactionMode={interactionMode}
            runtimeMode={runtimeMode}
          />
          <ModelOptionsMenu compact={compact} disabled={disabled} draftTarget={draftTarget} />
          <ChatInputAttachButton disabled={disabled} onSelectFiles={onSelectImageFiles} />
          {contextUsage ? <ContextUsageRing compact={compact} usage={contextUsage} /> : null}
          {statusLabel && !compact ? (
            <span
              className='text-muted-foreground text-2xs min-w-0 flex-1 truncate pl-1'
              title={statusLabel}
            >
              {statusLabel}
            </span>
          ) : null}
        </div>
        <div className='flex shrink-0 items-center gap-1'>
          <PromptStashBadge disabled={disabled} draftTarget={draftTarget} />
          <ChatInputSubmitButton
            correctionDisabledReason={correctionDisabledReason}
            busy={busy}
            disabled={disabled}
            disabledReason={disabledReason}
            pendingAction={pendingAction}
            draftTarget={draftTarget}
            sendDisabled={sendDisabled}
            onStop={onStop}
            onSubmit={onSubmit}
          />
        </div>
      </div>
      {/* Narrow: the status wraps onto its own line instead of squeezing the
          controls it shares the row with down to their icons. */}
      {statusLabel && compact ? (
        <span className='text-muted-foreground text-2xs min-w-0 truncate' title={statusLabel}>
          {statusLabel}
        </span>
      ) : null}
    </div>
  )
}
