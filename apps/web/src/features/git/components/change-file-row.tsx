import { use } from 'react'
import { useGitState } from '@/features/git/state/store'
import { ChangesContext } from '@/features/git/providers/changes-context'
import { changeRowId } from '@/features/git/utils/change-row-id'
import { useContextMenu } from '@/keymap/menus/hooks/use-context-menu'
import { useOpenDiffDocument } from '@/features/git/hooks/use-open-diff-document'
import { gitStatusSymbol } from '@/lib/git-status-symbols'
import type { ChangeRow } from '@/features/git/utils/types'
import { GitFileRow } from '@/components/git-file-row'
import { FileActions } from '@/features/git/components/file-actions'
import { FileMenu } from '@/features/git/components/file-menu'

export function ChangeFileRow({
  loading = false,
  rootPath,
  row,
}: {
  loading?: boolean
  rootPath: string
  row: ChangeRow
}) {
  const { opening, openDiff } = useOpenDiffDocument()
  const contextMenu = useContextMenu()
  const listbox = use(ChangesContext)
  const id = changeRowId(row)
  const selected = useGitState((state) => state.activeChangeId === id)
  const rowProps = listbox
    ? {
        ...listbox.rowBindings(id),
        'aria-selected': selected,
        'data-active': selected || undefined,
      }
    : undefined

  return (
    <>
      <GitFileRow
        rowProps={rowProps}
        path={row.file.path}
        oldPath={row.file.oldPath}
        rootPath={rootPath}
        status={gitStatusSymbol(row.status, row.section)}
        stat={row.file.lines?.[row.section]}
        loading={loading || opening}
        actions={<FileActions path={row.file.path} rootPath={rootPath} section={row.section} />}
        onOpen={() => {
          void openDiff(row)
        }}
        onContextMenu={(event) => contextMenu.openAtEvent(event, event.currentTarget)}
        onMenuKey={contextMenu.openOnMenuKey}
      />
      {contextMenu.anchor ? (
        <FileMenu
          anchor={contextMenu.anchor}
          onOpenChange={contextMenu.onOpenChange}
          rootPath={rootPath}
          row={row}
        />
      ) : null}
    </>
  )
}
