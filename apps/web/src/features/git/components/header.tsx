import type { GitRepositoryInfo } from '@workspace/contracts'
import {
  ArrowsClockwiseIcon,
  CaretDownIcon,
  CheckIcon,
  DownloadSimpleIcon,
  UploadSimpleIcon,
} from '@phosphor-icons/react'

import { Button } from '@workspace/ui/components/button'
import { PaneBar } from '@workspace/ui/components/pane-bar'

import {
  useCommitAction,
  useFetchRemoteMutation,
  usePullRemoteMutation,
  usePushRemoteMutation,
} from '../hooks'
import { useGitState } from '@/features/git/state/store'

import { aheadBehindLabel } from '../utils/repository'
import { ToolbarButton } from './toolbar-button'

export function Header({
  repository,
  rootPath,
}: {
  repository: GitRepositoryInfo
  rootPath: string
}) {
  const open = useGitState((state) => state.panelOpen)
  const setPanelOpen = useGitState((state) => state.setPanelOpen)

  return (
    <PaneBar as='header' border='bottom'>
      <Button
        aria-expanded={open}
        className='min-w-0 flex-1 justify-start px-1'
        size='sm'
        type='button'
        variant='ghost'
        onClick={() => setPanelOpen(!open)}
      >
        <CaretDownIcon
          className={[
            'size-3.5 shrink-0 text-muted-foreground transition-transform',
            open ? '' : '-rotate-90',
          ].join(' ')}
        />
        <span className='shrink-0'>Changes</span>
        <span className='text-muted-foreground text-2xs min-w-0 truncate font-normal tabular-nums'>
          {aheadBehindLabel(repository)}
        </span>
      </Button>
      <HeaderCommitButton rootPath={rootPath} />
      <FetchToolbarButton rootPath={rootPath} />
      <PullToolbarButton rootPath={rootPath} />
      <PushToolbarButton rootPath={rootPath} />
    </PaneBar>
  )
}

function HeaderCommitButton({ rootPath }: { rootPath: string }) {
  const commit = useCommitAction(rootPath)

  return (
    <ToolbarButton label='Commit' onClick={commit.submit}>
      <CheckIcon />
    </ToolbarButton>
  )
}

function FetchToolbarButton({ rootPath }: { rootPath: string }) {
  const fetchRemote = useFetchRemoteMutation(rootPath)

  return (
    <ToolbarButton
      disabled={fetchRemote.isPending}
      label='Fetch'
      onClick={() => fetchRemote.mutate()}
    >
      <ArrowsClockwiseIcon />
    </ToolbarButton>
  )
}

function PullToolbarButton({ rootPath }: { rootPath: string }) {
  const pullRemote = usePullRemoteMutation(rootPath)

  return (
    <ToolbarButton disabled={pullRemote.isPending} label='Pull' onClick={() => pullRemote.mutate()}>
      <DownloadSimpleIcon />
    </ToolbarButton>
  )
}

function PushToolbarButton({ rootPath }: { rootPath: string }) {
  const pushRemote = usePushRemoteMutation(rootPath)

  return (
    <ToolbarButton disabled={pushRemote.isPending} label='Push' onClick={() => pushRemote.mutate()}>
      <UploadSimpleIcon />
    </ToolbarButton>
  )
}
