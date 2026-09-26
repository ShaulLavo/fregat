import {
  ArrowsClockwiseIcon,
  CloudArrowUpIcon,
  DownloadSimpleIcon,
  UploadSimpleIcon,
} from '@phosphor-icons/react'
import { useState } from 'react'

import { useFetchRemoteMutation } from '@/features/git/hooks/use-fetch-remote-mutation'
import { usePullRemoteMutation } from '@/features/git/hooks/use-pull-remote-mutation'
import { usePushRemoteMutation } from '@/features/git/hooks/use-push-remote-mutation'
import { useStatus } from '@/features/git/hooks/use-status'
import { useBranchRemoteState } from '@/features/git/hooks/use-branch-remote-state'
import { PublishRepositoryDialog } from '@/features/git/components/publish-repository-dialog'
import { ToolbarButton } from '@/components/toolbar-button'

export function RemoteActions({ rootPath }: { readonly rootPath: string }) {
  const status = useStatus(rootPath)
  const fetchRemote = useFetchRemoteMutation(rootPath)
  const pullRemote = usePullRemoteMutation(rootPath)
  const pushRemote = usePushRemoteMutation(rootPath)
  const remoteState = useBranchRemoteState(rootPath)
  const [publishing, setPublishing] = useState(false)
  if (!status.data?.repository) return null
  // Nowhere to fetch from or push to: the one remote action is creating one.
  if (remoteState.data?.hasRemote === false)
    return (
      <>
        <ToolbarButton label='Publish repository' onClick={() => setPublishing(true)}>
          <CloudArrowUpIcon />
        </ToolbarButton>
        <PublishRepositoryDialog
          open={publishing}
          onOpenChange={setPublishing}
          rootPath={rootPath}
        />
      </>
    )

  return (
    <>
      <ToolbarButton
        disabled={fetchRemote.isPending}
        label='Fetch'
        onClick={() => fetchRemote.mutate()}
      >
        <ArrowsClockwiseIcon />
      </ToolbarButton>
      <ToolbarButton
        disabled={pullRemote.isPending}
        label='Pull'
        onClick={() => pullRemote.mutate()}
      >
        <DownloadSimpleIcon />
      </ToolbarButton>
      <ToolbarButton
        disabled={pushRemote.isPending}
        label='Push'
        onClick={() => pushRemote.mutate()}
      >
        <UploadSimpleIcon />
      </ToolbarButton>
    </>
  )
}
