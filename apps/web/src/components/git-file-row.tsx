import { ListRow } from '@workspace/ui/patterns/list-row'
import type { useListbox } from '@workspace/ui/patterns/use-listbox'
import type { KeyboardEvent, MouseEventHandler, ReactNode } from 'react'
import { FileLabel } from '@/components/file-label'
import { FileStatusCell } from '@/components/file-status-cell'
import { toTreePath } from '@/lib/path-formatters'
import type { GitLineStat } from '@workspace/contracts'
import { encodeTooltipParts } from '@workspace/ui/patterns/tooltip-parts'
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
  const changed = stat && stat.additions + stat.deletions > 0 ? stat : undefined
  const tooltip = encodeTooltipParts([
    { text: oldPath ? `${toTreePath(oldPath, rootPath)} → ` : '' },
    { text: relativePath },
    { text: ` · ${status.title}`, tone: 'muted' },
    ...(changed ? diffParts(changed) : []),
    { text: disabledReason ? ` · ${disabledReason}` : '', tone: 'muted' },
  ])
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
      data-tooltip={tooltip}
      onClick={(event) => {
        rowProps?.onClick(event)
        handleOpen()
      }}
      onContextMenu={onContextMenu}
      onKeyDown={handleKeyDown}
    >
      <FileLabel iconClassName='justify-self-center' loading={loading} path={relativePath} />
      <div>{actions}</div>
      <span className='text-2xs pl-1.5 tabular-nums'>
        {changed ? (
          <DiffStatLabel additions={changed.additions} deletions={changed.deletions} />
        ) : null}
      </span>
      <FileStatusCell status={status} />
    </ListRow>
  )
}

function treeLevel(role: 'treeitem' | 'option', historical: boolean) {
  if (role === 'option') return undefined

  return historical ? 1 : 2
}

function diffParts(stat: GitLineStat) {
  return [
    { text: ' · ' as const, tone: 'muted' as const },
    { text: `+${stat.additions}`, tone: 'added' as const },
    { text: ' ', tone: 'muted' as const },
    { text: `-${stat.deletions}`, tone: 'removed' as const },
  ]
}
