import type { GitRepositoryInfo } from '@workspace/contracts'
import {
  ArrowsClockwiseIcon,
  CaretDownIcon,
  CheckIcon,
  DownloadSimpleIcon,
  UploadSimpleIcon,
} from '@phosphor-icons/react'

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
    <header className='compact:h-8 flex h-9 shrink-0 items-center gap-1 border-b px-2'>
      <button
        type='button'
        aria-expanded={open}
        className='focus-visible:ring-ring/50 flex min-w-0 flex-1 items-center gap-1 text-left outline-none focus-visible:ring-1'
        onClick={() => setPanelOpen(!open)}
      >
        <CaretDownIcon
          className={[
            'size-3.5 shrink-0 text-muted-foreground transition-transform',
            open ? '' : '-rotate-90',
          ].join(' ')}
        />
        <span className='shrink-0 text-sm font-semibold'>Changes</span>
        <span className='text-muted-foreground min-w-0 truncate text-xs font-normal tabular-nums'>
          {aheadBehindLabel(repository)}
        </span>
      </button>
      <HeaderCommitButton rootPath={rootPath} />
      <FetchToolbarButton rootPath={rootPath} />
      <PullToolbarButton rootPath={rootPath} />
      <PushToolbarButton rootPath={rootPath} />
    </header>
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
