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
import type { useVoiceInput } from '../hooks/use-voice-input'
import { ChatInputDictation } from './chat-input-dictation'
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
  voice,
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
  voice?: ReturnType<typeof useVoiceInput>
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
      // Send sits in the corner with the same inset below and beside it.
      className='phone:pl-[calc(var(--density-section-padding)-var(--density-control-padding-x)-1px)] flex min-w-0 flex-col gap-1 pr-(--density-section-gap) pb-(--density-section-gap) pl-(--density-control-padding-x)'
      data-composer-actions
      data-compact={compact}
      ref={actionsRef}
    >
      <div className='flex min-w-0 items-center justify-between gap-2'>
        {/* Every control and readout in one run from the left; Send stands alone in the corner.
            On a phone the 40px targets already space the glyphs, so the gap goes to the model name. */}
        <div className='phone:gap-0 flex min-w-0 flex-1 items-center gap-1'>
          <ModelPicker busy={busy} disabled={disabled} narrow={narrow} />
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
            <ContextUsageRing
              compact={compact}
              // Usage exists only for a draft key that is a session, so this names a real one.
              sessionRef={{
                environmentId: draftTarget.environmentId,
                sessionId: draftTarget.draftKey as SessionId,
              }}
              usage={contextUsage}
            />
          ) : null}
          {modelSelection?.providerInstanceId && !tiny ? (
            <UsageLimitsMeter
              accounts={accountUsage.accounts}
              receivedAtMs={accountUsage.receivedAtMs}
              compact={compact}
            />
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
          {voice ? <ChatInputDictation voice={voice} disabled={disabled} /> : null}
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
