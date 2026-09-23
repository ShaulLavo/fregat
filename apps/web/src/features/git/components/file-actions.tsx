import { ActionCluster } from '@/features/git/components/action-cluster'
import { ArrowBendUpLeftIcon, MinusIcon, PlusIcon } from '@phosphor-icons/react'

import { useStagePathMutation } from '@/features/git/hooks/use-stage-path-mutation'
import { useUnstagePathMutation } from '@/features/git/hooks/use-unstage-path-mutation'
import { useGitStoreApi } from '@/features/git/state/store'
import { discardRequest } from '@/features/git/utils/discard-prompt'
import type { ChangeRow } from '@/features/git/utils/types'
import { RowActionButton } from './row-action-button'

export function FileActions({ rootPath, row }: { rootPath: string; row: ChangeRow }) {
  const path = row.file.path
  if (row.section === 'staged') {
    return (
      <ActionCluster hoverGroup='row'>
        <UnstageFileButton path={path} rootPath={rootPath} />
      </ActionCluster>
    )
  }

  return (
    <ActionCluster hoverGroup='row'>
      <DiscardFileButton row={row} />
      <StageFileButton path={path} rootPath={rootPath} />
    </ActionCluster>
  )
}

function StageFileButton({ path, rootPath }: { path: string; rootPath: string }) {
  const stage = useStagePathMutation(path, rootPath)

  return (
    <RowActionButton disabled={stage.isPending} label='Stage file' onClick={() => stage.mutate()}>
      <PlusIcon />
    </RowActionButton>
  )
}

function UnstageFileButton({ path, rootPath }: { path: string; rootPath: string }) {
  const unstage = useUnstagePathMutation(path, rootPath)

  return (
    <RowActionButton
      disabled={unstage.isPending}
      label='Unstage file'
      onClick={() => unstage.mutate()}
    >
      <MinusIcon />
    </RowActionButton>
  )
}

function DiscardFileButton({ row }: { row: ChangeRow }) {
  // The store API, not a selector: rows must not subscribe to the dialog's state.
  const store = useGitStoreApi()

  return (
    <RowActionButton
      disabled={false}
      label='Discard file'
      onClick={() => store.getState().requestDiscard(discardRequest(row.section, [row]))}
    >
      <ArrowBendUpLeftIcon />
    </RowActionButton>
  )
}
