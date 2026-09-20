import { ActionCluster } from '@/features/git/components/action-cluster'
import { ArrowBendUpLeftIcon, FilePlusIcon, MinusIcon, PlusIcon } from '@phosphor-icons/react'

import { useDiscardPathsMutation } from '@/features/git/hooks/use-discard-paths-mutation'
import { useDiscardStagedPathsMutation } from '@/features/git/hooks/use-discard-staged-paths-mutation'
import { useOpenDiffDocument } from '@/features/git/hooks/use-open-diff-document'
import { useStagePathsMutation } from '@/features/git/hooks/use-stage-paths-mutation'
import { useUnstagePathsMutation } from '@/features/git/hooks/use-unstage-paths-mutation'
import type { ChangeRow, PanelSection } from '@/features/git/utils/types'
import { RowActionButton } from './row-action-button'

export function GroupActions({
  rows,
  section,
}: {
  rows: readonly ChangeRow[]
  section: PanelSection
}) {
  const paths = rows.map((row) => row.file.path)

  if (section === 'staged') {
    return <StagedGroupActions paths={paths} rows={rows} />
  }

  return <WorktreeGroupActions paths={paths} rows={rows} />
}

function WorktreeGroupActions({
  paths,
  rows,
}: {
  paths: readonly string[]
  rows: readonly ChangeRow[]
}) {
  const discard = useDiscardPathsMutation(paths)
  const stage = useStagePathsMutation(paths)

  return (
    <ActionCluster hoverGroup='group'>
      <RowActionButton
        disabled={discard.isPending}
        label='Discard all changes'
        onClick={() => discard.mutate()}
      >
        <ArrowBendUpLeftIcon />
      </RowActionButton>
      <OpenAllDiffsButton rows={rows} />
      <RowActionButton
        disabled={stage.isPending}
        label='Stage all changes'
        onClick={() => stage.mutate()}
      >
        <PlusIcon />
      </RowActionButton>
    </ActionCluster>
  )
}

function StagedGroupActions({
  paths,
  rows,
}: {
  paths: readonly string[]
  rows: readonly ChangeRow[]
}) {
  const discard = useDiscardStagedPathsMutation(paths)
  const unstage = useUnstagePathsMutation(paths)

  return (
    <ActionCluster hoverGroup='group'>
      <RowActionButton
        disabled={discard.isPending}
        label='Discard all staged changes'
        onClick={() => discard.mutate()}
      >
        <ArrowBendUpLeftIcon />
      </RowActionButton>
      <OpenAllDiffsButton rows={rows} />
      <RowActionButton
        disabled={unstage.isPending}
        label='Unstage all changes'
        onClick={() => unstage.mutate()}
      >
        <MinusIcon />
      </RowActionButton>
    </ActionCluster>
  )
}

function OpenAllDiffsButton({ rows }: { rows: readonly ChangeRow[] }) {
  const { openDiffs } = useOpenDiffDocument()

  return (
    <RowActionButton disabled={false} label='Open all diffs' onClick={() => void openDiffs(rows)}>
      <FilePlusIcon />
    </RowActionButton>
  )
}
