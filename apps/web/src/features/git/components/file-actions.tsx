import { ActionCluster } from '@/features/git/components/action-cluster'
import { ArrowBendUpLeftIcon, MinusIcon, PlusIcon } from '@phosphor-icons/react'

import { useDiscardPathMutation } from '@/features/git/hooks/use-discard-path-mutation'
import { useStagePathMutation } from '@/features/git/hooks/use-stage-path-mutation'
import { useUnstagePathMutation } from '@/features/git/hooks/use-unstage-path-mutation'
import type { PanelSection } from '@/features/git/utils/types'
import { RowActionButton } from './row-action-button'

export function FileActions({ path, section }: { path: string; section: PanelSection }) {
  if (section === 'staged') {
    return (
      <ActionCluster hoverGroup='row'>
        <UnstageFileButton path={path} />
      </ActionCluster>
    )
  }

  return (
    <ActionCluster hoverGroup='row'>
      <DiscardFileButton path={path} />
      <StageFileButton path={path} />
    </ActionCluster>
  )
}

function StageFileButton({ path }: { path: string }) {
  const stage = useStagePathMutation(path)

  return (
    <RowActionButton disabled={stage.isPending} label='Stage file' onClick={() => stage.mutate()}>
      <PlusIcon />
    </RowActionButton>
  )
}

function UnstageFileButton({ path }: { path: string }) {
  const unstage = useUnstagePathMutation(path)

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

function DiscardFileButton({ path }: { path: string }) {
  const discard = useDiscardPathMutation(path)

  return (
    <RowActionButton
      disabled={discard.isPending}
      label='Discard file'
      onClick={() => discard.mutate()}
    >
      <ArrowBendUpLeftIcon />
    </RowActionButton>
  )
}
