import { CaretDownIcon } from '@phosphor-icons/react'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@workspace/ui/components/collapsible'
import { cn } from '@workspace/ui/lib/utils'
import type { KeyboardEvent, MouseEvent } from 'react'

import { useContextMenu } from '@/keymap/menus/hooks/use-context-menu'

import { useEditorWorkspaceState } from '@/features/editor/state/workspace-state'
import { useNavigation } from '@/hooks/use-navigation'
import type { ChangeRow, PanelSection } from '@/features/git/utils/types'
import { ChangeFileRow } from '@/features/git/components/change-file-row'
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
  const panels = useEditorWorkspaceState((state) => state.workbenchPanels)
  const open = panels.gitChangesOpen[section]
  const navigation = useNavigation()
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
      onOpenChange={(nextOpen) => {
        void navigation.setWorkbenchPanels({
          ...panels,
          gitChangesOpen: { ...panels.gitChangesOpen, [section]: nextOpen },
        })
      }}
    >
      <div
        className='group/group hover:bg-row-hover active:bg-row-active text-muted-foreground text-2xs flex h-(--density-control-height-sm) w-full items-center px-(--density-row-padding-x) font-medium tracking-wider uppercase transition-colors'
        onContextMenu={handleContextMenu}
        onKeyDown={handleHeaderKeyDown}
      >
        <CollapsibleTrigger className='focus-ring flex min-w-0 flex-1 items-center gap-1.5 text-left outline-none'>
          <CaretDownIcon
            className={cn('size-3 shrink-0 transition-transform', !open && '-rotate-90')}
          />
          <span className='min-w-0 flex-1 truncate'>{label}</span>
        </CollapsibleTrigger>
        <GroupActions rows={rows} section={section} />
        <span className='ml-1 tabular-nums'>{rows.length}</span>
      </div>
      <CollapsibleContent className='pl-(--density-row-padding-x)'>
        {rows.map((row) => (
          <ChangeFileRow
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
