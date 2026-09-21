import { useStatus } from '@/features/git/hooks/use-status'
import { ActionCluster } from '@/features/git/components/action-cluster'
import { ArrowBendUpLeftIcon, MinusIcon, PlusIcon } from '@phosphor-icons/react'

import { useDiscardPathMutation } from '@/features/git/hooks/use-discard-path-mutation'
import { useStagePathMutation } from '@/features/git/hooks/use-stage-path-mutation'
import { useUnstagePathMutation } from '@/features/git/hooks/use-unstage-path-mutation'
import type { PanelSection } from '@/features/git/utils/types'
import { RowActionButton } from './row-action-button'

export function FileActions({
  path,
  rootPath,
  section,
}: {
  path: string
  rootPath: string
  section: PanelSection
}) {
  if (section === 'staged') {
    return (
      <ActionCluster hoverGroup='row'>
        <UnstageFileButton path={path} rootPath={rootPath} />
      </ActionCluster>
    )
  }

  return (
    <ActionCluster hoverGroup='row'>
      <DiscardFileButton path={path} rootPath={rootPath} />
      <StageFileButton path={path} rootPath={rootPath} />
    </ActionCluster>
  )
}

function StageFileButton({ path, rootPath }: { path: string; rootPath: string }) {
  const confirmed = Boolean(useStatus(rootPath).data)
  const stage = useStagePathMutation(path, rootPath)

  return (
    <RowActionButton
      disabled={!confirmed || stage.isPending}
      label='Stage file'
      onClick={() => stage.mutate()}
    >
      <PlusIcon />
    </RowActionButton>
  )
}

function UnstageFileButton({ path, rootPath }: { path: string; rootPath: string }) {
  const confirmed = Boolean(useStatus(rootPath).data)
  const unstage = useUnstagePathMutation(path, rootPath)

  return (
    <RowActionButton
      disabled={!confirmed || unstage.isPending}
      label='Unstage file'
      onClick={() => unstage.mutate()}
    >
      <MinusIcon />
    </RowActionButton>
  )
}

function DiscardFileButton({ path, rootPath }: { path: string; rootPath: string }) {
  const confirmed = Boolean(useStatus(rootPath).data)
  const discard = useDiscardPathMutation(path, rootPath)

  return (
    <RowActionButton
      disabled={!confirmed || discard.isPending}
      label='Discard file'
      onClick={() => discard.mutate()}
    >
      <ArrowBendUpLeftIcon />
    </RowActionButton>
  )
}
