import { ToolPane } from '@workspace/ui/patterns/tool-pane'
import type { FileSnapshot } from '@/lib/file-snapshot'
import { basename, formatSize } from '@/lib/path-formatters'

export function FileFacts({ file }: { readonly file: Pick<FileSnapshot, 'path' | 'size'> }) {
  const extension = basename(file.path).split('.').slice(1).at(-1)
  return (
    <ToolPane
      title='File facts'
      role='region'
      aria-label='File facts'
      className='bg-background'
      bodyClassName='flex flex-col items-center justify-center gap-(--density-gap) p-(--density-padding)'
      data-file-facts
    >
      <h2 className='max-w-full truncate text-sm font-semibold' title={file.path}>
        {basename(file.path)}
      </h2>
      <p className='text-muted-foreground text-xs'>Binary file</p>
      <dl className='grid grid-cols-2 gap-(--density-gap) text-xs'>
        <dt className='text-muted-foreground'>Size</dt>
        <dd className='font-mono tabular-nums'>{formatSize(file.size)}</dd>
        <dt className='text-muted-foreground'>Type</dt>
        <dd>{extension ? `${extension.toUpperCase()} file` : 'Binary file'}</dd>
      </dl>
    </ToolPane>
  )
}
