import { ArrowSquareOutIcon } from '@phosphor-icons/react'
import { useIsMutating, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useEffectEvent, useId, useState } from 'react'
import { Button, buttonVariants } from '@workspace/ui/components/button'
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from '@workspace/ui/components/input-group'
import { Spinner } from '@workspace/ui/components/spinner'
import { cn } from '@workspace/ui/lib/utils'

import { InlineError } from '@/components/inline-error'
import type { Client } from '@/lib/client'
import { clientErrorDescription, toClientError } from '@/lib/client-error-taxonomy'
import { finishMcpSignIn, mcpSignInAttemptQueryOptions, mcpSignInKeys } from '@/lib/mcp-sign-in'

/**
 * The sign-in page link, then a field for the address the page ended on. The redirect goes to
 * the server machine's loopback, so from any other device the page ends on an address that does
 * not load; pasting it here finishes the sign-in there.
 */
export function McpSignInFinish({
  attemptId,
  authorizationUrl,
  client,
  name,
  onSignedIn,
}: {
  readonly attemptId: string
  readonly authorizationUrl: string
  readonly client: Client
  readonly name: string
  readonly onSignedIn: () => void
}) {
  const id = useId()
  const queryClient = useQueryClient()
  const [callbackUrl, setCallbackUrl] = useState('')
  const attempt = useQuery(mcpSignInAttemptQueryOptions(client, attemptId))
  const finish = useMutation({
    mutationKey: mcpSignInKeys.finish(attemptId),
    mutationFn: (pasted: string) => finishMcpSignIn(client, attemptId, pasted),
    onSuccess: (result) => queryClient.setQueryData(mcpSignInKeys.attempt(attemptId), result),
  })
  const finishing = useIsMutating({ mutationKey: mcpSignInKeys.finish(attemptId) }) > 0
  const state = attempt.data?.state ?? 'pending'
  const settledOnSignIn = state === 'succeeded'

  const signedIn = useEffectEvent(onSignedIn)
  // The parent's server list is what changed; it re-reads once, when the sign-in lands.
  useEffect(() => {
    if (settledOnSignIn) signedIn()
  }, [settledOnSignIn])

  if (state === 'succeeded')
    return (
      <p className='text-success text-2xs' role='status'>
        Signed in to {name}
      </p>
    )

  return (
    <div className='flex min-w-0 flex-col gap-1.5 py-1'>
      <a
        className={cn(buttonVariants({ size: 'sm', variant: 'outline' }), 'self-start')}
        href={authorizationUrl}
        rel='noopener noreferrer'
        target='_blank'
      >
        <ArrowSquareOutIcon data-icon='inline-start' />
        Open sign-in page for {name}
      </a>
      <label className='text-muted-foreground text-2xs' htmlFor={`${id}-callback`}>
        On another device, the page ends on an address that does not load. Paste that address here.
      </label>
      <form
        onSubmit={(event) => {
          event.preventDefault()
          if (callbackUrl.trim()) finish.mutate(callbackUrl.trim())
        }}
      >
        <InputGroup>
          <InputGroupInput
            autoComplete='off'
            className='font-mono'
            id={`${id}-callback`}
            onChange={(event) => setCallbackUrl(event.currentTarget.value)}
            placeholder='http://localhost:…/callback?code=…'
            spellCheck={false}
            value={callbackUrl}
          />
          <InputGroupAddon align='inline-end'>
            <InputGroupButton disabled={finishing || !callbackUrl.trim()} type='submit'>
              {finishing ? <Spinner /> : null}
              Finish
            </InputGroupButton>
          </InputGroupAddon>
        </InputGroup>
      </form>
      {finish.isError && !finishing ? (
        <InlineError
          message={clientErrorDescription(toClientError(finish.error))}
          title={`Finish sign-in to ${name}`}
        />
      ) : null}
      {state === 'failed' ? (
        <InlineError
          message={attempt.data?.message ?? 'The sign-in did not finish.'}
          title={`Sign in to ${name}`}
        />
      ) : null}
      {attempt.isError ? (
        <Button onClick={() => void attempt.refetch()} size='sm' variant='ghost'>
          Check again
        </Button>
      ) : null}
    </div>
  )
}
