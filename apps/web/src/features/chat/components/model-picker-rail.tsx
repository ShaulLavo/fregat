import type { ProviderInstanceId } from '@workspace/contracts'

import { ModelPickerRailItem } from '@/features/chat/components/model-picker-rail-item'
import type { ProviderModelOptionGroup } from '@workspace/client-core/chat/providers/models'

/**
 * Provider switcher down the left edge of the picker panel. Only worth showing
 * once a second provider instance exists — the panel decides that and renders
 * nothing here otherwise. Its scrollbar is hidden because a gutter would consume
 * too much of the rail's width.
 */
export function ModelPickerRail({
  activeProviderInstanceId,
  groups,
  onSelect,
}: {
  readonly activeProviderInstanceId: ProviderInstanceId
  readonly groups: readonly ProviderModelOptionGroup[]
  readonly onSelect: (providerInstanceId: ProviderInstanceId) => void
}) {
  return (
    <div className='bg-muted w-(--rail-width) shrink-0 overflow-hidden'>
      <div className='h-full overflow-y-auto overscroll-contain [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden'>
        <div className='relative flex min-h-full flex-col gap-1 p-1'>
          {groups.map((group) => (
            <ModelPickerRailItem
              active={group.providerInstanceId === activeProviderInstanceId}
              group={group}
              key={group.providerInstanceId}
              onSelect={onSelect}
            />
          ))}
        </div>
      </div>
    </div>
  )
}
