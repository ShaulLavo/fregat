import { useQueryClient } from '@tanstack/react-query'
import { captureGitView, savedGitView } from '@/features/git/state/reload'
import { addLifecycleFlush } from '@/lib/lifecycle-flush'
import { useEffect, useState, useRef, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { useListContextMenu } from '@/keymap/menus/hooks/use-list-context-menu'
import { GroupMenu } from '@/features/git/components/group-menu'
import { FileMenu } from '@/features/git/components/file-menu'
import { EmptyState } from '@workspace/ui/components/empty-state'
import { useListbox } from '@workspace/ui/patterns/use-listbox'
import { VirtualList, type VirtualListHandle } from '@workspace/ui/patterns/virtual-list'

import { useNavigation } from '@/hooks/use-navigation'
import { ChangeFileRow } from '@/features/git/components/change-file-row'
import { ChangeGroupHeader } from '@/features/git/components/change-group-header'
import { useOpenDiffDocument } from '@/features/git/hooks/use-open-diff-document'
import { ChangesContext } from '@/features/git/providers/changes-context'
import { useGitState } from '@/features/git/state/store'
import { useEditorWorkspaceState } from '@/features/editor/state/workspace-state'
import {
  changeEntries,
  changeListboxItems,
  type ChangesEntry,
} from '@/features/git/utils/change-entries'
import type { ChangeRow } from '@/features/git/utils/types'
import { changeRowId } from '@/features/git/utils/change-row-id'

const CONTAINER_CLASS = 'focus-ring-inset min-h-0 flex-1 overflow-auto py-(--density-gap-tight)'

export function ChangesList({
  rootPath,
  staged,
  worktree,
  loadingPath,
  loadingSection,
}: {
  rootPath: string
  staged: readonly ChangeRow[]
  worktree: readonly ChangeRow[]
  loadingPath?: string
  loadingSection?: string
}) {
  const owner = useQueryClient()
  const [restored] = useState(() => savedGitView(owner, rootPath))
  const lastScroll = useRef(restored?.scrollTop ?? 0)
  const panels = useEditorWorkspaceState((state) => state.workbenchPanels)
  const open = panels.gitChangesOpen
  const navigation = useNavigation()
  const activeId = useGitState((state) => state.activeChangeId)
  const select = useGitState((state) => state.selectChange)
  const { openDiff } = useOpenDiffDocument()
  const scrollRef = useRef<HTMLDivElement>(null)
  const virtualList = useRef<VirtualListHandle>(null)
  const entries = changeEntries([
    { expanded: open.staged, label: 'Staged', rows: staged, section: 'staged' },
    { expanded: open.worktree, label: 'Changes', rows: worktree, section: 'worktree' },
  ])
  const rows = [...(open.staged ? staged : []), ...(open.worktree ? worktree : [])]

  function setGroupExpanded(id: string, expanded: boolean) {
    if (id !== 'staged' && id !== 'worktree') return
    void navigation.setWorkbenchPanels({ ...panels, gitChangesOpen: { ...open, [id]: expanded } })
  }

  const contextMenu = useListContextMenu<string>({
    containerRef: scrollRef,
    isTargetPresent: (target) => entries.some((entry) => entry.id === target),
  })

  function openActiveMenu(event: ReactKeyboardEvent<HTMLDivElement>, id: string): void {
    contextMenu.openOnMenuKey(event, id)
  }

  // A row the cursor reaches may be unmounted, so the virtualizer scrolls it in.
  const scrollToIndex = (index: number) => {
    virtualList.current?.scrollToIndex(index, { align: 'auto' })
  }
  const listbox = useListbox({
    role: 'tree',
    items: changeListboxItems(entries),
    activeId: activeId ?? restored?.activeId ?? null,
    containerRef: scrollRef,
    scrollToIndex,
    onActiveChange: select,
    onSelect: select,
    onExpand: (id) => setGroupExpanded(id, true),
    onCollapse: (id) => setGroupExpanded(id, false),
    onActiveKeyDown: openActiveMenu,
    onCommit: (id) => {
      if (id === 'staged' || id === 'worktree') {
        setGroupExpanded(id, !open[id])
        return
      }
      const row = rows.find((row) => changeRowId(row) === id)
      if (row) void openDiff(row)
    },
  })

  useEffect(() => {
    const flush = () =>
      captureGitView(owner, rootPath, {
        activeId: activeId ?? restored?.activeId ?? null,
        scrollTop: lastScroll.current,
      })
    const remove = addLifecycleFlush(flush)
    return () => {
      flush()
      remove()
    }
  }, [owner, rootPath, activeId, restored])

  // Keep hundreds of rows independent of the list cursor's changing render state.
  const bindings = {
    rowBindings: listbox.rowBindings,
    focus: listbox.focus,
    openMenu: contextMenu.openAtEvent,
  }

  const menuEntry = entries.find((entry) => entry.id === contextMenu.target)

  function renderEntry(entry: ChangesEntry) {
    if (entry.kind === 'group') {
      return (
        <ChangeGroupHeader
          group={entry.group}
          rootPath={rootPath}
          onToggle={() => setGroupExpanded(entry.group.section, !entry.group.expanded)}
        />
      )
    }

    return (
      <div className='pl-(--density-row-padding-x)'>
        <ChangeFileRow
          loading={entry.row.file.path === loadingPath && entry.row.section === loadingSection}
          rootPath={rootPath}
          row={entry.row}
        />
      </div>
    )
  }

  if (entries.length === 0) {
    return (
      <ChangesContext value={bindings}>
        <div {...listbox.containerProps} aria-label='Git changes' className={CONTAINER_CLASS}>
          <EmptyState
            align='start'
            className='px-(--density-row-padding-x) py-4'
            title='No changes'
          />
        </div>
      </ChangesContext>
    )
  }

  return (
    <ChangesContext value={bindings}>
      <VirtualList
        {...listbox.containerProps}
        {...contextMenu.containerProps}
        initialOffset={restored?.scrollTop}
        onScroll={(event) => {
          lastScroll.current = event.currentTarget.scrollTop
        }}
        activeIndex={listbox.activeIndex}
        aria-label='Git changes'
        className={CONTAINER_CLASS}
        getKey={(entry) => entry.id}
        handleRef={virtualList}
        items={entries}
        layout='flow'
        measureItems
        renderRow={(entry) => (
          <div className={entry.endsGroup ? 'pb-(--density-gap-tight)' : undefined}>
            {renderEntry(entry)}
          </div>
        )}
        scrollRef={scrollRef}
      />
      {contextMenu.anchor && menuEntry?.kind === 'file' ? (
        <FileMenu
          anchor={contextMenu.anchor}
          onOpenChange={contextMenu.onOpenChange}
          returnFocusTo={contextMenu.returnFocusTo}
          rootPath={rootPath}
          row={menuEntry.row}
        />
      ) : null}
      {contextMenu.anchor && menuEntry?.kind === 'group' ? (
        <GroupMenu
          anchor={contextMenu.anchor}
          onOpenChange={contextMenu.onOpenChange}
          returnFocusTo={contextMenu.returnFocusTo}
          rootPath={rootPath}
          rows={menuEntry.group.rows}
          section={menuEntry.group.section}
        />
      ) : null}
    </ChangesContext>
  )
}
