import type { FsEntry } from '@/lib/file-system-types'
import { isDirectoryEntry, isFileEntry } from '@/lib/file-system-types'
import { Badge } from '@workspace/ui/components/badge'

export function KindBadge({ entry }: { entry: FsEntry }) {
  if (isDirectoryEntry(entry)) {
    return (
      <Badge className='border-warning/20 bg-warning/10 text-warning justify-center'>Folder</Badge>
    )
  }

  if (isFileEntry(entry)) {
    return <Badge className='border-info/20 bg-info/10 text-info justify-center'>File</Badge>
  }

  return (
    <Badge className='justify-center' variant='outline'>
      Other
    </Badge>
  )
}
