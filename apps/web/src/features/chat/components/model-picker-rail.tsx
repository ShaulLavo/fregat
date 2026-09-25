import type { ProviderInstanceId } from '@workspace/contracts'

import { ModelPickerFavoritesRailItem } from '@/features/chat/components/model-picker-favorites-rail-item'
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
  favorites,
  groups,
  onSelect,
}: {
  /** `null` while nothing is starred; a provider is active only when favorites are not. */
  readonly activeProviderInstanceId: ProviderInstanceId | null
  readonly favorites: { readonly active: boolean; readonly onSelect: () => void } | null
  readonly groups: readonly ProviderModelOptionGroup[]
  readonly onSelect: (providerInstanceId: ProviderInstanceId) => void
}) {
  return (
    <div className='bg-muted w-(--rail-width) shrink-0 overflow-hidden'>
      <div className='h-full overflow-y-auto overscroll-contain [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden'>
        <div className='relative flex min-h-full flex-col gap-1 p-1'>
          {favorites ? (
            <ModelPickerFavoritesRailItem active={favorites.active} onSelect={favorites.onSelect} />
          ) : null}
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
