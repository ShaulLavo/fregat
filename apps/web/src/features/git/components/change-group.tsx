import { CaretDownIcon } from '@phosphor-icons/react'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@workspace/ui/components/collapsible'
import { cn } from '@workspace/ui/lib/utils'
import type { KeyboardEvent, MouseEvent } from 'react'

import { useContextMenu } from '@/keymap/menus/hooks/use-context-menu'

import { useGitState } from '@/features/git/state/store'
import type { ChangeRow, PanelSection } from '@/features/git/utils/types'
import { FileRow } from './file-row'
import { GroupActions } from './group-actions'
import { GroupMenu } from './group-menu'

export function ChangeGroup({
  label,
  loadingPath,
  rootPath,
  rows,
  section,
}: {
  label: string
  loadingPath?: string | null
  rootPath: string
  rows: readonly ChangeRow[]
  section: PanelSection
}) {
  const open = useGitState((state) => state.sectionOpen[section])
  const setSectionOpen = useGitState((state) => state.setSectionOpen)
  const contextMenu = useContextMenu()

  function handleContextMenu(event: MouseEvent<HTMLDivElement>) {
    contextMenu.openAtEvent(event, event.currentTarget)
  }

  function handleHeaderKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    contextMenu.openOnMenuKey(event)
  }

  if (rows.length === 0) return null

  return (
    <Collapsible
      className='pb-(--density-gap-tight)'
      open={open}
      onOpenChange={(nextOpen) => setSectionOpen(section, nextOpen)}
    >
      <div
        className='group/group hover:bg-row-hover active:bg-row-active flex h-(--density-control-height-sm) w-full items-center px-(--density-row-padding-x) text-xs font-medium transition-colors'
        onContextMenu={handleContextMenu}
        onKeyDown={handleHeaderKeyDown}
      >
        <CollapsibleTrigger className='focus-ring flex min-w-0 flex-1 items-center gap-2 text-left outline-none'>
          <CaretDownIcon
            className={cn(
              'size-3.5 shrink-0 text-muted-foreground transition-transform',
              !open && '-rotate-90',
            )}
          />
          <span className='min-w-0 flex-1 truncate'>{label}</span>
        </CollapsibleTrigger>
        <GroupActions rows={rows} section={section} />
        <span className='bg-background text-muted-foreground text-2xs ml-1 flex h-(--density-chip-height) min-w-(--density-chip-height) items-center justify-center rounded-full border px-1.5 font-normal tabular-nums'>
          {rows.length}
        </span>
      </div>
      <CollapsibleContent className='ml-5 border-l'>
        {rows.map((row) => (
          <FileRow
            key={`${row.section}:${row.file.path}:${row.status}`}
            loading={row.file.path === loadingPath}
            rootPath={rootPath}
            row={row}
          />
        ))}
      </CollapsibleContent>
      {contextMenu.anchor && (
        <GroupMenu
          anchor={contextMenu.anchor}
          onOpenChange={contextMenu.onOpenChange}
          rows={rows}
          section={section}
        />
      )}
    </Collapsible>
  )
}
