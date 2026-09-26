import type { ColorMode, ThemeVariantPatch } from '@workspace/contracts'
import { ListRow } from '@workspace/ui/patterns/list-row'
import { VirtualList } from '@workspace/ui/patterns/virtual-list'

import { CodeThemePreview } from '@/lib/code-theme/components/preview'
import { editorThemeOptions } from '@/lib/code-theme/utils/catalog'
import { useStudioList } from '@/features/theme-studio/hooks/use-studio-list'

/**
 * The code colors for the half on screen. The editor behind the dock and chat code blocks follow
 * them; the sample beside the list covers a root with nothing open.
 */
export function CodeTab({
  codeTheme,
  mode,
  onEdit,
}: {
  codeTheme: string
  mode: ColorMode
  onEdit: (patch: ThemeVariantPatch) => void
}) {
  const options = editorThemeOptions(mode)
  const { containerRef, virtualRef, list } = useStudioList({
    items: options.map((option) => ({ id: option.id, label: option.label })),
    activeId: codeTheme,
    onActiveChange: (id) => onEdit({ codeTheme: id }),
  })

  return (
    <div className='flex h-full min-h-0 gap-(--density-section-padding) px-(--bar-padding-x) py-(--density-section-gap)'>
      <VirtualList
        {...list.containerProps}
        activeIndex={list.activeIndex}
        aria-label='Code colors'
        className='focus-ring-inset w-72 outline-none'
        getKey={(option) => option.id}
        handleRef={virtualRef}
        items={options}
        renderRow={(option) => (
          <ListRow
            {...list.rowProps(option.id)}
            role='option'
            selected={option.id === codeTheme}
            title={`${option.label} · ${option.subtitle}`}
          >
            <span className='min-w-0 flex-1 truncate'>{option.label}</span>
            <span className='text-muted-foreground text-2xs'>{option.subtitle}</span>
          </ListRow>
        )}
        scrollRef={containerRef}
      />
      <CodeThemePreview
        className='min-h-0 flex-1 overflow-y-auto overscroll-contain rounded-md'
        themeId={codeTheme}
      />
    </div>
  )
}
