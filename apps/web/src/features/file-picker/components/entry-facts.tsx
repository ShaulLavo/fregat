import type { PreviewViewRead } from '@/lib/file-preview/utils/source'
import type { FsEntry } from '@/lib/file-system-types'
import { isDirectoryEntry } from '@/lib/file-system-types'

import { formatModified, formatSize, kindLabel } from '@/features/file-picker/utils/model'

export function EntryFacts({ entry, read }: { entry: FsEntry; read: PreviewViewRead }) {
  const diskSize = isDirectoryEntry(entry) ? [] : [['Size', formatSize(entry.size)]]
  const sourceFacts =
    read.kind === 'live'
      ? [
          ['Source', read.dirty ? 'Unsaved buffer' : 'Open buffer'],
          ['Preview', formatSize(read.utf8Bytes)],
        ]
      : diskSize
  const facts = [
    ['Kind', kindLabel(entry)],
    ...sourceFacts,
    [read.kind === 'live' ? 'Disk modified' : 'Modified', formatModified(entry.mtimeMs)],
    [read.kind === 'live' ? 'Disk created' : 'Created', formatModified(entry.birthtimeMs)],
  ]
  return (
    <dl className='text-2xs grid w-full grid-cols-[64px_minmax(0,1fr)] gap-(--density-control-gap) text-left'>
      {facts.map(([label, value]) => (
        <div className='contents' key={label}>
          <dt className='text-muted-foreground'>{label}</dt>
          <dd className='text-foreground min-w-0 text-right font-mono break-words tabular-nums'>
            {value}
          </dd>
        </div>
      ))}
    </dl>
  )
}
