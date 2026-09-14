import { ArrowsClockwiseIcon, DownloadSimpleIcon, UploadSimpleIcon } from '@phosphor-icons/react'

import {
  useFetchRemoteMutation,
  usePullRemoteMutation,
  usePushRemoteMutation,
  useStatus,
} from '@/features/git/hooks'
import { ToolbarButton } from '@/components/toolbar-button'

export function RemoteActions({ rootPath }: { readonly rootPath: string }) {
  const status = useStatus(rootPath)
  const fetchRemote = useFetchRemoteMutation(rootPath)
  const pullRemote = usePullRemoteMutation(rootPath)
  const pushRemote = usePushRemoteMutation(rootPath)
  if (!status.data?.repository) return null

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
