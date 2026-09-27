import { diffQueryOptions } from '@/features/git/utils/diff-query'
import { use } from 'react'
import { useGitState } from '@/features/git/state/store'
import { ChangesContext } from '@/features/git/providers/changes-context'
import { changeRowId } from '@/features/git/utils/change-row-id'
import { useOpenDiffDocument } from '@/features/git/hooks/use-open-diff-document'
import { gitStatusSymbol } from '@/lib/git-status-symbols'
import type { ChangeRow } from '@/features/git/utils/types'
import { GitFileRow } from '@/components/git-file-row'
import { FileActions } from '@/features/git/components/file-actions'

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
    <GitFileRow
      rowProps={rowProps}
      prefetch={diffQueryOptions(row.file.path, row.section === 'staged')}
      path={row.file.path}
      oldPath={row.file.oldPath}
      rootPath={rootPath}
      status={gitStatusSymbol(row.status, row.section)}
      stat={row.file.lines?.[row.section]}
      loading={loading || opening}
      actions={<FileActions rootPath={rootPath} row={row} />}
      onOpen={() => {
        void openDiff(row)
      }}
      onContextMenu={(event) => listbox?.openMenu(id, event)}
    />
  )
}
