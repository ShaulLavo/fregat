import { useContextMenu } from '@/keymap/menus/hooks/use-context-menu'
import { useOpenDiffDocument } from '@/features/git/hooks/use-open-diff-document'
import { gitStatusSymbol } from '@/features/git/utils/status-symbols'
import type { ChangeRow } from '@/features/git/utils/types'
import { FileRow } from '@/features/git/components/file-row'
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

  return (
    <>
      <FileRow
        path={row.file.path}
        oldPath={row.file.oldPath}
        rootPath={rootPath}
        status={gitStatusSymbol(row.status, row.section)}
        loading={loading || opening}
        actions={<FileActions path={row.file.path} section={row.section} />}
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
