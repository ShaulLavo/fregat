import { useEffect, useState } from 'react'
import { useQueries } from '@tanstack/react-query'
import { EmptyState } from '@workspace/ui/components/empty-state'
import { LoadingState } from '@workspace/ui/components/loading-state'
import { useListbox } from '@workspace/ui/patterns/use-listbox'

import { BreadcrumbFolderRows } from '@/features/workbench/components/breadcrumb-folder-rows'
import {
  folderPickerRows,
  togglePickerBranch,
  type FolderListing,
} from '@/features/workbench/utils/breadcrumb-picker-rows'
import { filesystemPath } from '@/lib/documents/utils/identity'
import type { FilesystemPath } from '@/lib/documents/utils/types'
import { clientForQueryClient } from '@/lib/environments/state/query-clients'
import { fetchTree } from '@/lib/file-server'
import { toTreePath } from '@/lib/path-formatters'
import { fileSystemKeys } from '@/lib/query-keys'

export function BreadcrumbFolderPicker({
  directoryPath,
  rootPath,
  selectedPath,
  onOpenFile,
}: {
  readonly directoryPath: string
  readonly rootPath: FilesystemPath
  readonly selectedPath: string
  readonly onOpenFile: (path: string) => void
}) {
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set())
  const [activeId, setActiveId] = useState<string | null>(selectedPath)
  const paths = [directoryPath, ...expanded]
  const queries = useQueries({
    queries: paths.map((path) => ({
      queryKey: fileSystemKeys.treeDirectory(rootPath, toTreePath(path, rootPath), path),
      queryFn: ({ client, signal }) =>
        fetchTree(filesystemPath(path), signal, clientForQueryClient(client)),
    })),
  })
  const listings = new Map<string, FolderListing>(
    paths.map((path, index) => {
      const query = queries[index]
      return [
        path,
        {
          entries: query?.data?.entries ?? [],
          pending: query?.isPending ?? true,
          failed: query?.isError ?? false,
        },
      ]
    }),
  )
  const rows = folderPickerRows(directoryPath, listings, expanded)
  function toggle(path: string) {
    setExpanded((current) => togglePickerBranch(current, path))
  }
  function activate(path: string) {
    const row = rows.find((row) => row.id === path)
    if (row?.hasChildren) return toggle(path)
    onOpenFile(path)
  }
  const list = useListbox({
    role: 'tree',
    items: rows,
    activeId,
    onActiveChange: setActiveId,
    onCommit: activate,
    onExpand: toggle,
    onCollapse: toggle,
  })
  const pending = queries[0]?.isPending ?? true
  const ref = list.containerProps.ref
  useEffect(() => {
    if (!pending) ref.current?.focus({ preventScroll: true })
  }, [pending, ref])

  if (pending)
    return (
      <LoadingState label='Loading folder'>
        <div aria-hidden='true'>
          {[0, 1, 2, 3].map((row) => (
            <div
              key={row}
              className='flex h-(--density-row-height) items-center px-(--density-row-padding-x)'
            >
              <div className='skeleton-sweep h-3 w-32 rounded-md' />
            </div>
          ))}
        </div>
      </LoadingState>
    )
  if (queries[0]?.isError) return <EmptyState align='start' title='Could not read folder' />
  if (rows.length === 0) return <EmptyState align='start' title='Empty folder' />
  return (
    <div
      {...list.containerProps}
      aria-label='Folder contents'
      className='app-scrollbar-thin focus-ring-inset max-h-[inherit] overflow-y-auto py-(--density-gap-tight)'
    >
      <BreadcrumbFolderRows
        rows={rows}
        rowProps={list.rowProps}
        onActivate={activate}
        onToggle={toggle}
      />
    </div>
  )
}
