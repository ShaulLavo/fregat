import { Spinner } from '@workspace/ui/components/spinner'
import { ToolPane } from '@workspace/ui/patterns/tool-pane'
import { useCodeThemePreview } from '@/lib/code-theme/hooks/use-preview'
import type { ColorMode } from '@workspace/contracts'
import { cn } from '@workspace/ui/lib/utils'
import { ListRow } from '@workspace/ui/patterns/list-row'
import { VirtualList } from '@workspace/ui/patterns/virtual-list'

import { CodeThemePreview } from '@/lib/code-theme/components/preview'
import { editorThemeColorMode, editorThemeOptions } from '@/lib/code-theme/utils/catalog'
import { useChoiceList } from '@/lib/appearance/hooks/use-choice-list'

/**
 * The code themes for one mode, with a sample beside the list: the editor and chat code blocks
 * follow the choice, and the sample covers a root with nothing open.
 */
export function CodeThemePicker({
  className,
  labelledBy,
  live = false,
  mode,
  value,
  onChange,
}: {
  className?: string
  labelledBy?: string
  /** Choose as the cursor moves; otherwise Enter, Space or a click chooses. */
  live?: boolean
  mode: ColorMode
  value: string
  onChange: (id: string) => void
}) {
  const options = editorThemeOptions(mode)
  const preview = useCodeThemePreview(value)
  const theme = editorThemeOptions(editorThemeColorMode(preview.themeId) ?? mode).find(
    (option) => option.id === preview.themeId,
  )
  const { containerRef, virtualRef, list } = useChoiceList({
    items: options.map((option) => ({ id: option.id, label: option.label })),
    live,
    value,
    onChoose: onChange,
  })

  return (
    <div className={cn('flex h-full min-h-0 gap-(--density-section-padding)', className)}>
      <VirtualList
        {...list.containerProps}
        activeIndex={list.activeIndex}
        aria-label={labelledBy ? undefined : 'Code colors'}
        aria-labelledby={labelledBy}
        className='focus-ring-inset w-72 outline-none'
        getKey={(option) => option.id}
        handleRef={virtualRef}
        items={options}
        renderRow={(option) => (
          <ListRow
            {...list.rowProps(option.id)}
            role='option'
            selected={option.id === value}
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
