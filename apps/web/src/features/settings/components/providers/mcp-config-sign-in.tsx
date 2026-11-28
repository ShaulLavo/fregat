import { useIsMutating } from '@tanstack/react-query'
import type { ProviderSnapshot } from '@workspace/contracts'
import { Button } from '@workspace/ui/components/button'
import { Spinner } from '@workspace/ui/components/spinner'

import { McpSignInFinish } from '@/components/mcp-sign-in-finish'
import { useSignInMcpConfigServer } from '@/features/settings/hooks/use-sign-in-mcp-config-server'
import { settleMcpQueries } from '@/features/settings/utils/mcp-query'
import { settingsMutationKeys } from '@/features/settings/utils/mutation-keys'
import { clientForQueryClient } from '@/lib/environments/state/query-clients'
import { useSettingsOwner } from '@/lib/settings-owner/hooks/use-settings-owner'

/** Sign in, from this device or any other: the finish field takes the address the page ended on. */
export function McpConfigSignIn({
  folder,
  instance,
  name,
}: {
  readonly folder: string | null
  readonly instance: ProviderSnapshot
  readonly name: string
}) {
  const owner = useSettingsOwner()
  const signIn = useSignInMcpConfigServer(instance.providerInstanceId, name, folder)
  const starting =
    useIsMutating(
      { mutationKey: settingsMutationKeys.mcp.signIn(instance.providerInstanceId, name) },
      owner,
    ) > 0
  const started = signIn.data?.attemptId
    ? { ...signIn.data, attemptId: signIn.data.attemptId }
    : null

  if (started)
    return (
      <McpSignInFinish
        attemptId={started.attemptId}
        authorizationUrl={started.authorizationUrl}
        client={clientForQueryClient(owner)}
        name={name}
        onSignedIn={() => void settleMcpQueries(owner)}
      />
    )

  return (
    <Button
      className='self-start'
      disabled={starting}
      onClick={() => signIn.mutate()}
      size='sm'
      variant='outline'
    >
      {starting ? <Spinner label={`Starting sign-in to ${name}`} /> : null}
      Sign in
    </Button>
  )
}
