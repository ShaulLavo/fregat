import { useEffect, useRef, useState, type KeyboardEvent } from 'react'

import { BreadcrumbFolderRows } from '@/features/workbench/components/breadcrumb-folder-rows'
import { handlePickerKey } from '@/features/workbench/utils/breadcrumb-picker-keys'
import type { FilesystemPath } from '@/lib/documents/utils/types'

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
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set())
  const revealedRef = useRef(false)

  function toggle(path: string) {
    setExpanded((current) => {
      const next = new Set(current)
      if (next.has(path)) next.delete(path)
      else next.add(path)

      return next
    })
  }

  useEffect(() => {
    if (revealedRef.current) return
    const container = containerRef.current
    if (!container) return

    const row = container.querySelector<HTMLElement>(
      `[data-breadcrumb-row][data-breadcrumb-path="${CSS.escape(selectedPath)}"]`,
    )
    if (!row) return

    row.focus({ preventScroll: true })
    row.scrollIntoView({ block: 'center' })
    revealedRef.current = true
  })

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (handlePickerKey(event.key, event.currentTarget, toggle)) event.preventDefault()
  }

  return (
    <div
      aria-label='Folder contents'
      className='app-scrollbar-thin max-h-[inherit] overflow-y-auto py-(--density-gap-tight)'
      ref={containerRef}
      role='tree'
      onKeyDown={handleKeyDown}
    >
      <BreadcrumbFolderRows
        depth={0}
        directoryPath={directoryPath}
        expanded={expanded}
        rootPath={rootPath}
        selectedPath={selectedPath}
        onOpenFile={onOpenFile}
        onToggle={toggle}
      />
    </div>
  )
}
