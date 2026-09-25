import type { ColorMode, ThemeVariantPatch } from '@workspace/contracts'
import { ListRow } from '@workspace/ui/patterns/list-row'
import { useListbox } from '@workspace/ui/patterns/use-listbox'
import { VirtualList, type VirtualListHandle } from '@workspace/ui/patterns/virtual-list'
import { useRef, type ReactNode } from 'react'

import { editorThemeOptions } from '@/lib/code-theme/utils/catalog'

/**
 * The code colors for the half on screen. The editor behind the dock is the preview, and chat
 * code blocks follow it.
 */
export function CodeTab({
  codeTheme,
  mode,
  sample,
  onEdit,
}: {
  codeTheme: string
  mode: ColorMode
  /** The action that opens a sample file when nothing else is open. */
  sample?: ReactNode
  onEdit: (patch: ThemeVariantPatch) => void
}) {
  const options = editorThemeOptions(mode)
  const containerRef = useRef<HTMLDivElement>(null)
  const virtualRef = useRef<VirtualListHandle>(null)
  const list = useListbox({
    role: 'listbox',
    containerRef,
    items: options.map((option) => ({ id: option.id, label: option.label })),
    activeId: codeTheme,
    onActiveChange: (id) => onEdit({ codeTheme: id }),
    onCommit: () => {},
    onSelect() {},
    typeahead: true,
    scrollToIndex: (index) => virtualRef.current?.scrollToIndex(index, { align: 'auto' }),
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
      <div className='text-muted-foreground flex min-w-0 flex-1 flex-col gap-2 text-xs'>
        <p>The editor and chat code blocks show the code colors as you move.</p>
        {sample}
      </div>
    </div>
  )
}
