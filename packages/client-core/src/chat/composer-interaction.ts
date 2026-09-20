import type { InteractionMode, ProviderSnapshot } from '@workspace/contracts'

export function resolveComposerInteractionMode({
  planModeEnabled,
  provider,
  interactionMode,
}: {
  planModeEnabled: boolean
  provider: Pick<ProviderSnapshot, 'showInteractionModeToggle'> | null | undefined
  interactionMode: InteractionMode
}): { enabled: boolean; interactionMode: InteractionMode } {
  const enabled =
    planModeEnabled && provider != null && provider.showInteractionModeToggle !== false
  return { enabled, interactionMode: enabled ? interactionMode : 'default' }
}
