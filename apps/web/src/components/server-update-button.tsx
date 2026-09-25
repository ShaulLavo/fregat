import { useIsMutating } from '@tanstack/react-query'
import type { ConnectionError } from '@workspace/contracts'
import { Button } from '@workspace/ui/components/button'
import { Spinner } from '@workspace/ui/components/spinner'
import { Tooltip, TooltipContent, TooltipTrigger } from '@workspace/ui/components/tooltip'
import { useEnvironmentConnections } from '@/hooks/use-environment-connections'
import { primaryQueryClient } from '@/lib/environments/state/query-clients'
import { serverUpdateLabel } from '@/lib/environments/utils/connection-notice'
import { environmentMutationKeys } from '@/lib/environments/utils/mutation-keys'

/** Installs the primary's server release on an SSH machine whose error says it needs one. */
export function ServerUpdateButton({
  name,
  label,
  error,
  size,
  onUpdated,
}: {
  readonly name: string
  /** The machine's display name. */
  readonly label: string
  readonly error: ConnectionError | null
  readonly size: 'xs' | 'sm'
  /** Runs once the machine is live on the new server. */
  readonly onUpdated?: () => void
}) {
  const connections = useEnvironmentConnections()
  const updating =
    useIsMutating(
      { mutationKey: environmentMutationKeys.machine('update', name) },
      primaryQueryClient(),
    ) > 0
  const action = serverUpdateLabel(error)
  if (!action) return null

  async function update() {
    if (await connections.updateServer(name)) onUpdated?.()
  }

  const buttonProps = {
    size,
    variant: 'secondary',
    disabled: updating,
    'aria-label': `${action} on ${label}`,
    onClick: () => void update(),
  } as const
  const content = (
    <>
      {updating ? <Spinner /> : null}
      {action}
    </>
  )
  // A development primary builds its working tree before it installs anything.
  if (!import.meta.env.DEV) return <Button {...buttonProps}>{content}</Button>

  return (
    <Tooltip>
      <TooltipTrigger render={<Button {...buttonProps} />}>{content}</TooltipTrigger>
      <TooltipContent>Builds this working tree and installs it on {label}</TooltipContent>
    </Tooltip>
  )
}
