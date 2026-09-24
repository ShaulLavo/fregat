import type { ReactNode } from 'react'
import { Shimmer } from '@workspace/ui/components/shimmer'
import { cn } from '@workspace/ui/lib/utils'

import { FileTypeIcon } from '@/components/file-type-icon'
import { iconForEntry } from '@/lib/file-icons'
import { basename, parentPath } from '@/lib/path-formatters'

/**
 * A file's icon, then its basename, then its directory, muted. Rendered as two
 * siblings so the caller's grid or flex row places the icon in its own column.
 * The basename comes first so a right cut eats the directory, never the name.
 */
export function FileLabel({
  className,
  directory,
  iconClassName,
  loading = false,
  name,
  path,
}: {
  readonly className?: string
  /** Replaces the directory text, e.g. with a highlighted copy of it. */
  readonly directory?: ReactNode
  readonly iconClassName?: string
  readonly loading?: boolean
  /** Replaces the basename text, e.g. with a highlighted copy of it. */
  readonly name?: ReactNode
  /** Relative path; the basename and directory are derived from it. */
  readonly path: string
}) {
  const fileName = basename(path)
  const directoryText = parentPath(path)
  const label = (
    <>
      <span className={cn('font-medium', !loading && 'text-foreground')}>{name ?? fileName}</span>
      {directoryText ? (
        <span className={cn('ml-2 font-normal', !loading && 'text-muted-foreground')}>
          {directory ?? directoryText}
        </span>
      ) : null}
    </>
  )

  return (
    <>
      <FileTypeIcon
        className={cn('size-(--icon-size-sm) shrink-0', iconClassName)}
        icon={iconForEntry({ name: fileName, type: 'file' })}
      />
      <span className={cn('min-w-0 truncate text-left', className)}>
        {loading ? <Shimmer>{label}</Shimmer> : label}
      </span>
    </>
  )
}
