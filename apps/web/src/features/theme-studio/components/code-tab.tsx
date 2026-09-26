import { Spinner } from '@workspace/ui/components/spinner'
import { ToolPane } from '@workspace/ui/patterns/tool-pane'
import { useCodeThemePreview } from '@/lib/code-theme/hooks/use-preview'
import type { ColorMode, ThemeVariantPatch } from '@workspace/contracts'
import { ListRow } from '@workspace/ui/patterns/list-row'
import { VirtualList } from '@workspace/ui/patterns/virtual-list'

import { CodeThemePreview } from '@/lib/code-theme/components/preview'
import { editorThemeColorMode, editorThemeOptions } from '@/lib/code-theme/utils/catalog'
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
  const preview = useCodeThemePreview(codeTheme)
  const theme = editorThemeOptions(editorThemeColorMode(preview.themeId) ?? mode).find(
    (option) => option.id === preview.themeId,
  )
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
      <ToolPane
        title={theme?.label ?? preview.themeId}
        actions={
          preview.isFetching ? <Spinner label='Loading code theme preview' size='xs' /> : null
        }
        className='min-w-0'
      >
        <CodeThemePreview preview={preview} className='rounded-md' />
      </ToolPane>
    </div>
  )
}
