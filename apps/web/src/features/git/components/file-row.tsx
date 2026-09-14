import { useContextMenu } from '@/keymap/menus/hooks/use-context-menu'
import { colorForFileIcon, iconForEntry, type ResolvedFileIcon } from '@/lib/file-icons'
import { basename, parentPath, toTreePath } from '@/lib/path-formatters'
import { cn } from '@workspace/ui/lib/utils'
import { Shimmer } from '@workspace/ui/components/shimmer'
import type { CSSProperties, KeyboardEvent, MouseEvent } from 'react'

import { useOpenDiffDocument } from '../hooks'
import { gitStatusSymbol } from '@/features/git/utils/status-symbols'
import type { ChangeRow } from '@/features/git/utils/types'
import { FileActions } from './file-actions'
import { FileMenu } from './file-menu'

export function FileRow({
  loading = false,
  rootPath,
  row,
}: {
  loading?: boolean
  rootPath: string
  row: ChangeRow
}) {
  const { opening, openDiff } = useOpenDiffDocument()
  const contextMenu = useContextMenu()
  const relativePath = toTreePath(row.file.path, rootPath)
  const name = basename(relativePath)
  const directory = parentPath(relativePath)
  const icon = iconForEntry({ name, type: 'file' })
  const status = gitStatusSymbol(row.status, row.section)
  const inputPending = loading || opening

  function handleOpen() {
    void openDiff(row)
  }

  function handleRowKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (contextMenu.openOnMenuKey(event)) return
    if (event.key !== 'Enter' && event.key !== ' ') return

    event.preventDefault()
    handleOpen()
  }

  function handleContextMenu(event: MouseEvent<HTMLDivElement>) {
    contextMenu.openAtEvent(event, event.currentTarget)
  }

  return (
    <>
      <div
        aria-busy={inputPending || undefined}
        className='group/row focus-ring hover:bg-row-hover active:bg-row-active grid h-(--density-row-height) cursor-pointer grid-cols-[22px_minmax(0,1fr)_auto_28px] items-center px-(--density-row-padding-x) text-xs leading-4 outline-none'
        data-git-file-loading={inputPending || undefined}
        role='button'
        tabIndex={0}
        onClick={handleOpen}
        onContextMenu={handleContextMenu}
        onKeyDown={handleRowKeyDown}
      >
        <span
          aria-hidden='true'
          className='size-4 shrink-0 justify-self-center'
          style={fileIconStyle(icon)}
        />
        <div className='min-w-0 truncate text-left' title={relativePath}>
          {fileRowLabel(name, directory, inputPending)}
        </div>
        <FileActions path={row.file.path} section={row.section} />
        <span
          className={cn(
            'flex h-(--density-row-height) items-center justify-self-end pb-px text-xs font-semibold leading-none',
            status.className,
          )}
          title={status.title}
        >
          {status.label}
        </span>
      </div>
      {contextMenu.anchor && (
        <FileMenu
          anchor={contextMenu.anchor}
          onOpenChange={contextMenu.onOpenChange}
          rootPath={rootPath}
          row={row}
        />
      )}
    </>
  )
}

function fileRowLabel(name: string, directory: string, loading: boolean) {
  if (loading) {
    return (
      <Shimmer className='font-medium'>
        {name}
        {directory ? <span className='ml-2 font-normal'>{directory}</span> : null}
      </Shimmer>
    )
  }

  return (
    <>
      <span className='text-foreground font-medium'>{name}</span>
      {directory ? (
        <span className='text-muted-foreground ml-2 font-normal'>{directory}</span>
      ) : null}
    </>
  )
}

function fileIconStyle(icon: ResolvedFileIcon): CSSProperties {
  const mask = `url(${icon.src}) center / contain no-repeat`

  return {
    backgroundColor: colorForFileIcon(icon),
    mask,
    WebkitMask: mask,
  }
}
