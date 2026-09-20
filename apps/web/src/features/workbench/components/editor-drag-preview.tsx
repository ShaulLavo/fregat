import { CopyIcon, FileIcon } from '@phosphor-icons/react'

export function EditorDragPreview({
  title,
  copy,
}: {
  readonly title: string
  readonly copy: boolean
}) {
  return (
    <div
      className='bg-popover-solid text-popover-foreground border-border flex h-(--bar-height) max-w-64 items-center gap-2 border px-(--bar-padding-x) text-xs shadow-md'
      title={title}
    >
      {copy ? (
        <CopyIcon className='size-3.5 shrink-0' />
      ) : (
        <FileIcon className='size-3.5 shrink-0' />
      )}
      <span className='truncate'>{title}</span>
      {copy ? <span className='text-muted-foreground'>Copy</span> : null}
    </div>
  )
}
