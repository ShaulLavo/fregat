import { ListRow } from '@workspace/ui/patterns/list-row'
import type { useListbox } from '@workspace/ui/patterns/use-listbox'
import { FileTypeIcon } from '@/components/file-type-icon'
import type { KeyboardEvent, MouseEventHandler, ReactNode } from 'react'
import { Shimmer } from '@workspace/ui/components/shimmer'
import { cn } from '@workspace/ui/lib/utils'
import { iconForEntry } from '@/lib/file-icons'
import { basename, parentPath, toTreePath } from '@/lib/path-formatters'
import type { GitLineStat } from '@workspace/contracts'
import { DiffStatLabel } from '@/components/diff-stat-label'
import type { StatusPresentation } from '@/lib/git-status-symbols'

export function GitFileRow({
  path,
  oldPath,
  rootPath,
  status,
  stat,
  role = 'treeitem',
  loading = false,
  disabledReason,
  historical = false,
  actions,
  onOpen,
  rowProps,
  onContextMenu,
  onMenuKey,
}: {
  path: string
  oldPath?: string
  rootPath: string
  status: StatusPresentation
  stat?: GitLineStat
  role?: 'treeitem' | 'option'
  loading?: boolean
  disabledReason?: string
  historical?: boolean
  actions?: ReactNode
  rowProps?: ReturnType<ReturnType<typeof useListbox<string>>['rowProps']>
  onOpen: () => void
  onContextMenu?: MouseEventHandler<HTMLDivElement>
  onMenuKey?: (event: KeyboardEvent<HTMLDivElement>) => boolean
}) {
  const relativePath = toTreePath(path, rootPath)
  const name = basename(relativePath)
  const directory = parentPath(relativePath)
  const icon = iconForEntry({ name, type: 'file' })
  const changed = stat && stat.additions + stat.deletions > 0 ? stat : undefined
  const title = [
    `${oldPath ? `${toTreePath(oldPath, rootPath)} → ` : ''}${relativePath}`,
    status.title,
    changed ? `+${changed.additions} -${changed.deletions}` : undefined,
    disabledReason,
  ]
    .filter(Boolean)
    .join(' · ')
  const label = (
    <>
      <span className={cn('font-medium', !loading && 'text-foreground')}>{name}</span>
      {directory ? (
        <span className={cn('ml-2 font-normal', !loading && 'text-muted-foreground')}>
          {directory}
        </span>
      ) : null}
    </>
  )

  function handleOpen() {
    if (disabledReason) return
    onOpen()
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (onMenuKey?.(event)) return
    if (event.key !== 'Enter' && event.key !== ' ') return
    event.preventDefault()
    handleOpen()
  }

  return (
    <ListRow
      {...rowProps}
      role={role}
      aria-level={treeLevel(role, historical)}
      aria-busy={loading || undefined}
      aria-disabled={Boolean(disabledReason) || undefined}
      className='grid cursor-pointer grid-cols-[22px_minmax(0,1fr)_auto_auto_28px] gap-0 leading-4'
      data-git-file={path}
      data-git-file-loading={loading || undefined}
      data-history-file={historical ? path : undefined}
      data-tooltip={title}
      onClick={(event) => {
        rowProps?.onClick(event)
        handleOpen()
      }}
      onContextMenu={onContextMenu}
      onKeyDown={handleKeyDown}
    >
      <FileTypeIcon className='size-(--icon-size-sm) shrink-0 justify-self-center' icon={icon} />
      <div className='min-w-0 truncate text-left'>
        {loading ? <Shimmer>{label}</Shimmer> : label}
      </div>
      <div>{actions}</div>
      <span className='text-2xs pl-1.5 tabular-nums'>
        {changed ? (
          <DiffStatLabel additions={changed.additions} deletions={changed.deletions} />
        ) : null}
      </span>
      <span
        className={cn(
          'flex h-(--density-row-height) items-center justify-self-end pb-px text-xs font-semibold leading-none',
          status.className,
        )}
      >
        {status.label}
      </span>
    </ListRow>
  )
}

function treeLevel(role: 'treeitem' | 'option', historical: boolean) {
  if (role === 'option') return undefined

  return historical ? 1 : 2
}
