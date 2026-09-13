import { useQuery } from '@tanstack/react-query'
import { EmptyState } from '@workspace/ui/components/empty-state'
import { LoadingState } from '@workspace/ui/components/loading-state'
import { OrbitLoader } from '@workspace/ui/components/orbit-loader'

import { BreadcrumbPickerRow } from '@/features/workbench/components/breadcrumb-picker-row'
import { sortPickerEntries } from '@/features/workbench/utils/breadcrumbs'
import { filesystemPath } from '@/lib/documents/utils/identity'
import type { FilesystemPath } from '@/lib/documents/utils/types'
import { clientForQueryClient } from '@/lib/environments/state/query-clients'
import { fileIconStyle } from '@/lib/file-icon-style'
import { iconForEntry } from '@/lib/file-icons'
import { fetchTree } from '@/lib/file-server'
import { isDirectoryEntry } from '@/lib/file-system-types'
import { toTreePath } from '@/lib/path-formatters'
import { fileSystemKeys } from '@/lib/query-keys'

export function BreadcrumbFolderRows({
  depth,
  directoryPath,
  expanded,
  rootPath,
  selectedPath,
  onOpenFile,
  onToggle,
}: {
  readonly depth: number
  readonly directoryPath: string
  readonly expanded: ReadonlySet<string>
  readonly rootPath: FilesystemPath
  readonly selectedPath: string
  readonly onOpenFile: (path: string) => void
  readonly onToggle: (path: string) => void
}) {
  const listing = useQuery({
    queryFn: ({ client, signal }) =>
      fetchTree(filesystemPath(directoryPath), signal, clientForQueryClient(client)),
    queryKey: fileSystemKeys.treeDirectory(
      rootPath,
      toTreePath(directoryPath, rootPath),
      directoryPath,
    ),
  })

  if (listing.isPending) return pendingRows(depth)
  if (listing.isError) {
    return <EmptyState align='start' className='px-3 py-2' title='Could not read folder' />
  }
  const entries = sortPickerEntries(listing.data.entries)
  if (entries.length === 0 && depth === 0) {
    return <EmptyState align='start' className='px-3 py-2' title='Empty folder' />
  }

  return (
    <>
      {entries.map((entry) => {
        const directory = isDirectoryEntry(entry)
        const isExpanded = directory && expanded.has(entry.path)
        const icon = iconForEntry(
          { name: entry.name, type: directory ? 'directory' : 'file' },
          { open: isExpanded },
        )
        return (
          <div key={entry.path}>
            <BreadcrumbPickerRow
              depth={depth}
              expandable={directory}
              expanded={isExpanded}
              icon={
                <span aria-hidden='true' className='size-4 shrink-0' style={fileIconStyle(icon)} />
              }
              label={entry.name}
              path={entry.path}
              selected={entry.path === selectedPath}
              onActivate={() => (directory ? onToggle(entry.path) : onOpenFile(entry.path))}
              onToggle={() => onToggle(entry.path)}
            />
            {isExpanded ? (
              <BreadcrumbFolderRows
                depth={depth + 1}
                directoryPath={entry.path}
                expanded={expanded}
                rootPath={rootPath}
                selectedPath={selectedPath}
                onOpenFile={onOpenFile}
                onToggle={onToggle}
              />
            ) : null}
          </div>
        )
      })}
    </>
  )
}

function pendingRows(depth: number) {
  if (depth > 0) {
    return (
      <div
        className='text-muted-foreground flex h-(--density-row-height) items-center gap-1.5 text-xs'
        style={{ paddingLeft: `calc(var(--density-row-padding-x) + ${depth} * 1rem + 1.25rem)` }}
      >
        <OrbitLoader className='size-3' label='Loading folder' />
        Loading…
      </div>
    )
  }

  return (
    <LoadingState label='Loading folder'>
      <div aria-hidden='true'>
        {[24, 32, 20, 28].map((width, index) => (
          <div
            className='flex h-(--density-row-height) items-center gap-1.5 px-(--density-row-padding-x) pl-6'
            key={index}
          >
            <div className='skeleton-sweep size-4 rounded-md' />
            <div className='skeleton-sweep h-3 rounded-md' style={{ width: `${width * 4}px` }} />
          </div>
        ))}
      </div>
    </LoadingState>
  )
}
