import type { KeyboardEvent, MouseEventHandler, ReactNode } from 'react'
import { Shimmer } from '@workspace/ui/components/shimmer'
import { cn } from '@workspace/ui/lib/utils'
import { colorForFileIcon, iconForEntry } from '@/lib/file-icons'
import { basename, parentPath, toTreePath } from '@/lib/path-formatters'
import type { StatusPresentation } from '@/features/git/utils/types'

export function FileRow({
  path,
  oldPath,
  rootPath,
  status,
  loading = false,
  disabledReason,
  historical = false,
  actions,
  onOpen,
  onContextMenu,
  onMenuKey,
}: {
  path: string
  oldPath?: string
  rootPath: string
  status: StatusPresentation
  loading?: boolean
  disabledReason?: string
  historical?: boolean
  actions?: ReactNode
  onOpen: () => void
  onContextMenu?: MouseEventHandler<HTMLDivElement>
  onMenuKey?: (event: KeyboardEvent<HTMLDivElement>) => boolean
}) {
  const relativePath = toTreePath(path, rootPath)
  const name = basename(relativePath)
  const directory = parentPath(relativePath)
  const icon = iconForEntry({ name, type: 'file' })
  const mask = `url(${icon.src}) center / contain no-repeat`
  const title = `${oldPath ? `${toTreePath(oldPath, rootPath)} → ` : ''}${relativePath}${disabledReason ? ` · ${disabledReason}` : ''}`
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
    <div
      aria-busy={loading || undefined}
      aria-disabled={Boolean(disabledReason) || undefined}
      className='group/row focus-ring hover:bg-row-hover active:bg-row-active grid h-(--density-row-height) cursor-pointer grid-cols-[22px_minmax(0,1fr)_auto_28px] items-center px-(--density-row-padding-x) text-xs leading-4 outline-none'
      data-git-file={path}
      data-git-file-loading={loading || undefined}
      data-history-file={historical ? path : undefined}
      title={title}
      role='button'
      tabIndex={0}
      onClick={handleOpen}
      onContextMenu={onContextMenu}
      onKeyDown={handleKeyDown}
    >
      <span
        aria-hidden='true'
        className='size-4 shrink-0 justify-self-center'
        style={{ backgroundColor: colorForFileIcon(icon), mask, WebkitMask: mask }}
      />
      <div className='min-w-0 truncate text-left' title={title}>
        {loading ? <Shimmer>{label}</Shimmer> : label}
      </div>
      <div>{actions}</div>
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
  )
}
