import { FileTypeIcon } from '@/components/file-type-icon'
import { Spinner } from '@workspace/ui/components/spinner'
import type { useListbox } from '@workspace/ui/patterns/use-listbox'

import { BreadcrumbPickerRowList } from '@/features/workbench/components/breadcrumb-picker-row-list'
import type { FolderPickerRow } from '@/features/workbench/utils/breadcrumb-picker-rows'
import { iconForEntry } from '@/lib/file-icons'

export function BreadcrumbFolderRows({
  rows,
  rowProps,
  onActivate,
  onToggle,
}: {
  rows: readonly FolderPickerRow[]
  rowProps: ReturnType<typeof useListbox>['rowProps']
  onActivate: (id: string) => void
  onToggle: (id: string) => void
}) {
  return (
    <BreadcrumbPickerRowList
      rows={rows}
      rowProps={rowProps}
      renderIcon={(row) => (
        <FileTypeIcon
          className='size-(--icon-size-sm) shrink-0'
          icon={iconForEntry(
            { name: row.entry.name, type: row.hasChildren ? 'directory' : 'file' },
            { open: row.expanded },
          )}
        />
      )}
      renderTrailing={(row) => (
        <>
          {row.pending ? <Spinner label='Loading folder' /> : null}
          {row.failed ? (
            <span className='text-destructive text-2xs'>Could not read folder</span>
          ) : null}
        </>
      )}
      onActivate={onActivate}
      onToggle={onToggle}
    />
  )
}
