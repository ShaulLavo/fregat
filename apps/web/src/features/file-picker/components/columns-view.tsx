import { useDeferredValue, useEffect, useRef, useState } from 'react'

import type { FsEntry } from '@/lib/file-system-types'
import { PickerColumn } from '@/features/file-picker/components/picker-column'
import {
  columnFolders,
  selectInColumn,
  type ColumnTrail,
} from '@/features/file-picker/utils/columns'
import type { FilePickerIconMode, FilePickerMode } from '@/features/file-picker/utils/model'

/**
 * Finder's columns: the current folder, then one column per selected folder. Columns past the
 * first mount from a deferred trail, so holding an arrow key does not build a column per step.
 */
export function ColumnsView({
  accept,
  currentPath,
  iconMode,
  isBusy,
  mode,
  showHidden,
  trail,
  onCommit,
  onDirectoryIntent,
  onGoParent,
  onOpen,
  onTrailChange,
}: {
  accept?: readonly string[]
  currentPath: string
  iconMode: FilePickerIconMode
  isBusy: boolean
  mode: FilePickerMode
  showHidden: boolean
  trail: ColumnTrail
  onCommit: (entry: FsEntry) => void
  onDirectoryIntent: (path: string) => void
  onGoParent: () => void
  onOpen: (entry: FsEntry) => void
  onTrailChange: (trail: ColumnTrail) => void
}) {
  const stripRef = useRef<HTMLDivElement>(null)
  const deferredTrail = useDeferredValue(trail)
  const folders = columnFolders(currentPath, deferredTrail)
  const [activeColumn, setActiveColumn] = useState(0)
  const [entering, setEntering] = useState<string | null>(null)
  const [focusRequest, setFocusRequest] = useState<string | null>(null)

  // Focus follows ← and →, once the target column has mounted.
  useEffect(() => {
    if (focusRequest === null) return
    const column = folders.indexOf(focusRequest)
    if (column === -1) return
    stripRef.current?.querySelector<HTMLElement>(`[data-picker-column="${column}"]`)?.focus()
    setFocusRequest(null)
  }, [focusRequest, folders])

  // Navigating replaces every keyed column; if focus went with the old one, take it back.
  const shownPath = useRef(currentPath)
  useEffect(() => {
    if (shownPath.current === currentPath) return
    shownPath.current = currentPath
    if (document.activeElement !== document.body) return
    stripRef.current?.querySelector<HTMLElement>('[data-picker-column="0"]')?.focus()
  }, [currentPath])

  // The deepest column stays in view as the path grows.
  useEffect(() => {
    const strip = stripRef.current
    strip?.scrollTo({ left: strip.scrollWidth })
  }, [folders.length])

  function select(column: number, entry: FsEntry) {
    setEntering(null)
    setFocusRequest(null)
    onTrailChange(selectInColumn(trail, column, entry))
  }

  function enter(column: number) {
    const target = trail[column]
    if (!target) return
    setEntering(target.path)
    setActiveColumn(column + 1)
    setFocusRequest(target.path)
  }

  function leave(column: number) {
    setEntering(null)
    setFocusRequest(folders[column - 1] ?? null)
    if (column === 0) return onGoParent()
    setActiveColumn(column - 1)
  }

  return (
    <div
      aria-label='Folder columns'
      className='flex h-full min-h-0 overflow-x-auto overflow-y-hidden'
      ref={stripRef}
      role='group'
    >
      {folders.map((path, column) => (
        <PickerColumn
          accept={accept}
          active={column === Math.min(activeColumn, folders.length - 1)}
          column={column}
          iconMode={iconMode}
          isBusy={isBusy}
          key={path}
          mode={mode}
          path={path}
          selectFirst={entering === path}
          selectedPath={trail[column]?.path ?? null}
          showHidden={showHidden}
          onActivate={setActiveColumn}
          onCommit={onCommit}
          onDirectoryIntent={onDirectoryIntent}
          onEnter={enter}
          onLeave={leave}
          onOpen={onOpen}
          onSelect={select}
        />
      ))}
    </div>
  )
}
