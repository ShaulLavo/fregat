import { StagedUpdate } from '@/features/server-update/components/staged-update'
import { useLiveCheckToast } from '@/features/server-update/hooks/use-live-check-toast'
import { useServerUpdate } from '@/features/server-update/hooks/use-server-update'

/** The titlebar's update item: nothing until a release is staged, then "Update available". */
export function ServerUpdateStatus() {
  const update = useServerUpdate()
  useLiveCheckToast(update?.liveCheck)
  if (!update?.pending) return null

  return (
    <StagedUpdate key={update.pending.release} release={update.pending.release} update={update} />
  )
}
