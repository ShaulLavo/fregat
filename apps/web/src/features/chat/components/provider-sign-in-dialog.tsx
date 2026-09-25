import { Alert, AlertDescription } from '@workspace/ui/components/alert'
import { CheckCircleIcon, SignOutIcon, WarningCircleIcon } from '@phosphor-icons/react'
import type { ProviderInstanceId } from '@workspace/contracts'
import { Button } from '@workspace/ui/components/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@workspace/ui/components/dialog'
import { OrbitLoader } from '@workspace/ui/components/orbit-loader'
import { cn } from '@workspace/ui/lib/utils'
import { useEffect } from 'react'

import { CopyButton } from '@/components/copy-button'
import { useProviderSignIn } from '@/features/chat/hooks/use-provider-sign-in'
import {
  DEFAULT_PROVIDER_AUTH_METHOD,
  isProviderSignInBusy,
  providerAccountLabel,
  providerAuthMethodCopy,
  providerAuthMethodLabel,
  providerSignInCommand,
  providerSignInPhaseCopy,
  PROVIDER_AUTH_METHODS,
} from '@workspace/client-core/chat/providers/auth'
import { FixWithAgentButton } from '@/components/fix-with-agent-button'

const SUCCESS_CLOSE_DELAY_MS = 1_400

/**
 * Sign-in for one provider. The CLI does the work out-of-band in a browser tab,
 * so the dialog's job is to say which method is running, that a tab was opened,
 * and what to run in a terminal when no tab appears.
 */
export function ProviderSignInDialog({
  onOpenChange,
  open,
  providerInstanceId,
  providerLabel,
}: {
  readonly onOpenChange: (open: boolean) => void
  readonly open: boolean
  readonly providerInstanceId: ProviderInstanceId
  readonly providerLabel: string
}) {
  const signIn = useProviderSignIn({ enabled: open, providerInstanceId })
  const busy = isProviderSignInBusy(signIn.phase)
  const phaseCopy = providerSignInPhaseCopy({ method: signIn.method, phase: signIn.phase })
  const command = providerSignInCommand(signIn.method)
  const accountLabel = providerAccountLabel(signIn.account)

  useEffect(() => {
    if (signIn.phase !== 'succeeded') return

    const timer = window.setTimeout(() => onOpenChange(false), SUCCESS_CLOSE_DELAY_MS)
    return () => window.clearTimeout(timer)
  }, [onOpenChange, signIn.phase])

  // Closing mid-flight kills the attempt: the CLI child process would otherwise
  // outlive the dialog with nothing left to report to.
  const handleOpenChange = (next: boolean) => {
    if (!next && busy) signIn.cancelSignIn()
    if (!next) signIn.reset()

    onOpenChange(next)
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className='flex w-[min(460px,calc(100vw-2rem))] max-w-none flex-col sm:max-w-none'>
        <DialogHeader>
          <DialogTitle>{phaseCopy.title}</DialogTitle>
          <DialogDescription>{phaseCopy.description}</DialogDescription>
        </DialogHeader>

        {signIn.isAuthenticated ? (
          <Alert role='status' title={accountLabel ?? undefined} variant='success'>
            <CheckCircleIcon />
            <AlertDescription className='truncate'>
              {accountLabel ?? `${providerLabel} is signed in.`}
            </AlertDescription>
          </Alert>
        ) : null}

        {busy ? (
          <div className='bg-muted flex items-start gap-(--density-control-gap) px-(--density-control-padding-x) py-(--density-section-gap) text-xs'>
            <OrbitLoader className='text-muted-foreground mt-0.5' />
            <div className='min-w-0 flex-1'>
              <p className='text-foreground font-medium'>
                {providerAuthMethodLabel(signIn.method)}
              </p>
              <p className='text-muted-foreground mt-0.5'>
                Finish sign-in in the browser tab the CLI opened, then come back here.
              </p>
            </div>
          </div>
        ) : (
          <div className='flex flex-col gap-(--density-control-gap)'>
            {PROVIDER_AUTH_METHODS.map((option) => (
              <Button
                key={option}
                className='h-auto w-full flex-col items-start gap-0.5 py-(--density-section-gap) text-left whitespace-normal'
                onClick={() => signIn.signIn(option)}
                type='button'
                variant={option === DEFAULT_PROVIDER_AUTH_METHOD ? 'default' : 'outline'}
              >
                <span className='font-medium'>{providerAuthMethodCopy(option).label}</span>
                <span
                  className={cn(
                    'text-2xs font-normal',
                    option === DEFAULT_PROVIDER_AUTH_METHOD
                      ? 'text-primary-foreground/80'
                      : 'text-muted-foreground',
                  )}
                >
                  {providerAuthMethodCopy(option).description}
                </span>
              </Button>
            ))}
            <p className='text-muted-foreground text-2xs'>
              Sign-in is machine-wide: it signs the {providerLabel} CLI in for every workspace.
            </p>
          </div>
        )}

        {signIn.statusError ? (
          <Alert role='status' variant='warning'>
            <WarningCircleIcon />
            <AlertDescription className='break-words'>{signIn.statusError}</AlertDescription>
          </Alert>
        ) : null}

        {signIn.attemptError ? (
          <Alert variant='destructive'>
            <WarningCircleIcon />
            <AlertDescription className='break-words'>
              <p>{signIn.attemptError}</p>
              <FixWithAgentButton
                error={{ message: signIn.attemptError, title: 'Provider sign-in' }}
              />
            </AlertDescription>
          </Alert>
        ) : null}

        <div className='bg-muted flex flex-col gap-(--density-control-gap) px-(--density-control-padding-x) py-(--density-section-gap)'>
          <p className='text-muted-foreground text-2xs'>
            No browser tab? Run this in a terminal instead:
          </p>
          <div className='flex items-center gap-(--density-control-gap)' title={command}>
            <code className='text-foreground min-w-0 flex-1 truncate font-mono text-xs'>
              {command}
            </code>
            <CopyButton label='sign-in command' text={command} variant='outline' />
          </div>
        </div>

        <DialogFooter>
          {signIn.isAuthenticated ? (
            <Button
              className='sm:mr-auto'
              disabled={signIn.signOutPending}
              onClick={signIn.signOut}
              type='button'
              variant='destructive'
            >
              <SignOutIcon data-icon='inline-start' />
              Sign out
            </Button>
          ) : null}
          {busy ? (
            <Button onClick={signIn.cancelSignIn} type='button' variant='outline'>
              Cancel
            </Button>
          ) : (
            <Button onClick={() => handleOpenChange(false)} type='button' variant='outline'>
              Close
            </Button>
          )}
          {signIn.phase === 'failed' ? (
            <Button onClick={() => signIn.signIn(signIn.method)} type='button'>
              Try again
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
