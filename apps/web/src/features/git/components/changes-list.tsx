import { useMemo, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { isContextMenuKey } from '@workspace/utils/keyboard'
import { useNavigation } from '@/hooks/use-navigation'
import { useListbox } from '@workspace/ui/patterns/use-listbox'
import { EmptyState } from '@workspace/ui/components/empty-state'

import { ChangeGroup } from '@/features/git/components/change-group'
import { useOpenDiffDocument } from '@/features/git/hooks/use-open-diff-document'
import { ChangesContext } from '@/features/git/providers/changes-context'
import { useGitState } from '@/features/git/state/store'
import { useEditorWorkspaceState } from '@/features/editor/state/workspace-state'
import type { ChangeRow } from '@/features/git/utils/types'
import { changeRowId } from '@/features/git/utils/change-row-id'

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
  const panels = useEditorWorkspaceState((state) => state.workbenchPanels)
  const open = panels.gitChangesOpen
  const navigation = useNavigation()
  const activeId = useGitState((state) => state.activeChangeId)
  const select = useGitState((state) => state.selectChange)
  const { openDiff } = useOpenDiffDocument()
  const rows = [...(open.staged ? staged : []), ...(open.worktree ? worktree : [])]
  function setGroupExpanded(id: string, expanded: boolean) {
    if (id !== 'staged' && id !== 'worktree') return
    void navigation.setWorkbenchPanels({ ...panels, gitChangesOpen: { ...open, [id]: expanded } })
  }

  function openActiveMenu(event: ReactKeyboardEvent<HTMLDivElement>, id: string): void {
    if (!isContextMenuKey(event)) return
    const row = document.getElementById(listbox.rowProps(id).id)
    if (!row) return
    event.preventDefault()
    row.dispatchEvent(
      new window.KeyboardEvent('keydown', {
        key: event.key,
        shiftKey: event.shiftKey,
        bubbles: true,
        cancelable: true,
      }),
    )
  }

  const items = [
    ...(staged.length
      ? [{ id: 'staged', label: 'Staged', expanded: open.staged, hasChildren: true }]
      : []),
    ...(open.staged
      ? staged.map((row) => ({ id: changeRowId(row), label: row.file.path, parentId: 'staged' }))
      : []),
    ...(worktree.length
      ? [{ id: 'worktree', label: 'Changes', expanded: open.worktree, hasChildren: true }]
      : []),
    ...(open.worktree
      ? worktree.map((row) => ({
          id: changeRowId(row),
          label: row.file.path,
          parentId: 'worktree',
        }))
      : []),
  ]
  const listbox = useListbox({
    role: 'tree',
    items,
    activeId,
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

  // Keep hundreds of rows independent of the list cursor's changing render state.
  const bindings = useMemo(
    () => ({ rowBindings: listbox.rowBindings, focus: listbox.focus }),
    [listbox.rowBindings, listbox.focus],
  )

  return (
    <ChangesContext value={bindings}>
      <div
        {...listbox.containerProps}
        aria-label='Git changes'
        className='app-scrollbar-thin focus-ring-inset min-h-0 flex-1 overflow-auto py-(--density-gap-tight)'
      >
        <ChangeGroup
          label='Staged'
          loadingPath={loadingSection === 'staged' ? loadingPath : null}
          rootPath={rootPath}
          rows={staged}
          section='staged'
        />
        <ChangeGroup
          label='Changes'
          loadingPath={loadingSection === 'worktree' ? loadingPath : null}
          rootPath={rootPath}
          rows={worktree}
          section='worktree'
        />
        {staged.length + worktree.length === 0 ? (
          <EmptyState
            align='start'
            className='px-(--density-row-padding-x) py-4'
            title='Working tree clean'
          />
        ) : null}
      </div>
    </ChangesContext>
  )
}
