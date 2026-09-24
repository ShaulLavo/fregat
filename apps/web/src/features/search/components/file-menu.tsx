import { useSearchResultActions } from '@/features/search/hooks/use-result-actions'
import { searchFileMenu } from '@/features/search/utils/file-menu'
import type { SearchResultOpenTarget } from '@/features/search/utils/result-view-model'
import { MenuSurface } from '@/keymap/menus/components/surface'
import type { MenuAnchor } from '@/keymap/menus/utils/virtual-anchor'
import { copyTextToClipboard } from '@/lib/clipboard'

/** Mounted only while open, so an idle result list carries no menu. */
export function SearchFileMenu({
  anchor,
  relativePath,
  returnFocusTo,
  target,
  onOpenChange,
}: {
  readonly anchor: MenuAnchor
  readonly relativePath: string
  readonly returnFocusTo: () => HTMLElement | null
  readonly target: SearchResultOpenTarget
  readonly onOpenChange: (open: boolean) => void
}) {
  const { openTarget } = useSearchResultActions()
  const menu = searchFileMenu({
    copyPath: (value, label) => void copyTextToClipboard(value, label),
    open: openTarget,
    relativePath,
    target,
  })

  return (
    <MenuSurface
      anchor={anchor}
      className='w-56'
      menu={menu}
      onOpenChange={onOpenChange}
      open
      returnFocusTo={returnFocusTo}
      surface='search.file'
    />
  )
}
