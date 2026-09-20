import { FileTypeIcon } from '@/components/file-type-icon'
import { OrbitLoader } from '@workspace/ui/components/orbit-loader'
import type { useListbox } from '@workspace/ui/patterns/use-listbox'

import { BreadcrumbPickerRow } from '@/features/workbench/components/breadcrumb-picker-row'
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
    <>
      {rows.map((row) => (
        <BreadcrumbPickerRow
          key={row.id}
          depth={row.depth}
          expandable={row.hasChildren}
          expanded={row.expanded}
          icon={
            <FileTypeIcon
              className='size-(--icon-size-sm) shrink-0'
              icon={iconForEntry(
                { name: row.entry.name, type: row.hasChildren ? 'directory' : 'file' },
                { open: row.expanded },
              )}
            />
          }
          label={row.label}
          path={row.id}
          rowProps={rowProps(row.id)}
          trailing={
            <>
              {row.pending ? <OrbitLoader label='Loading folder' /> : null}
              {row.failed ? (
                <span className='text-destructive text-2xs'>Could not read folder</span>
              ) : null}
            </>
          }
          onActivate={() => onActivate(row.id)}
          onToggle={() => onToggle(row.id)}
        />
      ))}
    </>
  )
}
