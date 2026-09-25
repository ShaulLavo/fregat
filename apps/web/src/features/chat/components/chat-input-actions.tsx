import { useSettingValue } from '@/hooks/use-setting-value'
import { EMPTY_ACTIVITIES } from '@/lib/empty-activities'
import { useActiveChatProjection } from '@/features/chat/hooks/use-active-projection'
import { useModelPicker } from '@/features/chat/hooks/use-model-picker'
import { useProviderUsage } from '@/features/chat/hooks/use-provider-usage'
import type { InteractionMode, RuntimeMode, SessionId } from '@workspace/contracts'

import { useElementWidth } from '@/hooks/use-element-width'
import { contextUsageForActivities } from '@workspace/client-core/chat/context-usage'
import { selectChatSessionById } from '@workspace/client-core/chat/selectors'
import type { ChatInputDraftTarget } from '@/features/chat/state/chat-input-draft-store'
import { ChatInputAttachButton } from './chat-input-attach-button'
import { ChatInputSubmitButton } from './chat-input-submit-button'
import { ComposerControlsMenu } from './composer-controls-menu'
import { ContextUsageRing } from './context-usage-ring'
import { UsageLimitsMeter } from './usage-limits-meter'
import { ModelOptionsMenu } from './model-options-menu'
import { ModelPicker } from './model-picker'
import { PromptStashBadge } from './prompt-stash-badge'
import type { ComposerPendingAction } from '@/features/chat/utils/composer-state'

/**
 * Below this the control row cannot hold its labels and the send button at once.
 * The composer lives in both a ~300px side panel and a full-width stage, so the
 * layout is decided by the measured row rather than by a viewport breakpoint.
 */
const COMPACT_ACTIONS_WIDTH = 520
/** Below this the access and options menus are icons alone. */
const NARROW_ACTIONS_WIDTH = 420
/**
 * Below this the two read-only gauges go: the row is one line at every width, the model
 * name is the only thing that shrinks, and past its limit only actions keep their place.
 */
const TINY_ACTIONS_WIDTH = 300

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
  const contextMeterEnabled = useSettingValue('chat.contextWindowMeterEnabled')
  const [actionsRef, width] = useElementWidth<HTMLDivElement>()
  // Only once measured: assuming compact before the first layout would flash the
  // whole row through its narrow arrangement on every mount.
  const compact = width !== null && width < COMPACT_ACTIONS_WIDTH
  const narrow = width !== null && width < NARROW_ACTIONS_WIDTH
  const tiny = width !== null && width < TINY_ACTIONS_WIDTH
  // The context-window snapshots live on the session detail, so the composer
  // reads them for the session it is drafting into. A draft key that is not a
  // session finds nothing, which is the correct answer: no session, no usage.
  const activities = useActiveChatProjection(
    (state) =>
      selectChatSessionById(state, draftTarget.draftKey as SessionId | null)?.activities ??
      EMPTY_ACTIVITIES,
  )
  const contextUsage = contextUsageForActivities(activities)
  const { modelSelection } = useModelPicker()
  const accountUsage = useProviderUsage(
    modelSelection?.providerInstanceId,
    draftTarget.draftKey as SessionId | null,
  )

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
            narrow={narrow}
            runtimeMode={runtimeMode}
          />
          <ModelOptionsMenu
            compact={compact}
            disabled={disabled}
            draftTarget={draftTarget}
            narrow={narrow}
          />
          <ChatInputAttachButton
            captureScope={`${draftTarget.environmentId}:${draftTarget.draftKey}`}
            disabled={disabled}
            onSelectFiles={onSelectImageFiles}
          />
          {contextMeterEnabled && contextUsage && !tiny ? (
            <ContextUsageRing compact={compact} usage={contextUsage} />
          ) : null}
          {accountUsage && !tiny ? (
            <UsageLimitsMeter account={accountUsage} compact={compact} />
          ) : null}
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
