import { useIsMutating, useQuery } from '@tanstack/react-query'
import type { ProviderInstanceId } from '@workspace/contracts'
import { Button } from '@workspace/ui/components/button'
import { Spinner } from '@workspace/ui/components/spinner'

import { CopyButton } from '@/components/copy-button'
import { useProviderUpdate } from '@/features/settings/hooks/use-provider-update'
import { useSettingsOwner } from '@/features/settings/hooks/use-settings-owner'
import { settingsMutationKeys } from '@/features/settings/utils/mutation-keys'
import { providerUpdateQueryOptions } from '@/features/settings/utils/provider-update-query'
import { updateLine } from '@/features/settings/utils/provider-update-line'

/** The installed CLI against the published one, with the way to close the gap. */
export function ProviderUpdate({
  label,
  providerInstanceId,
}: {
  readonly label: string
  readonly providerInstanceId: ProviderInstanceId
}) {
  const owner = useSettingsOwner()
  const { data, isError, isPending } = useQuery(
    providerUpdateQueryOptions(providerInstanceId),
    owner,
  )
  const update = useProviderUpdate(providerInstanceId, label)
  const updating =
    useIsMutating({ mutationKey: settingsMutationKeys.providerUpdate(providerInstanceId) }, owner) >
    0

  if (isPending) return <Spinner label='Checking for updates' size='xs' />
  if (isError)
    return <span className='text-muted-foreground text-xs'>Could not check for updates</span>

  const line = updateLine(data)
  return (
    <div
      className='flex min-w-0 items-center gap-(--density-control-gap) text-xs'
      title={line.title}
    >
      {line.versions ? (
        <span className='text-muted-foreground shrink-0 font-mono tabular-nums'>
          {line.versions}
        </span>
      ) : null}
      {line.note ? <span className='text-muted-foreground truncate'>{line.note}</span> : null}
      {line.command ? (
        <span className='text-muted-foreground truncate font-mono'>{line.command}</span>
      ) : null}
      {line.action === 'update' ? (
        <Button disabled={updating} onClick={() => update.mutate()} size='xs' variant='outline'>
          {updating ? <Spinner label={`Updating ${label}`} /> : null}
          Update
        </Button>
      ) : null}
      {line.action === 'copy' && line.command ? (
        <CopyButton label='update command' text={line.command} />
      ) : null}
    </div>
  )
}
