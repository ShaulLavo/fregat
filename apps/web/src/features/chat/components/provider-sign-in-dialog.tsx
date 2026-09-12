import {
  CheckCircleIcon,
  CheckIcon,
  CopyIcon,
  SignOutIcon,
  WarningCircleIcon,
} from '@phosphor-icons/react'
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
import { Spinner } from '@workspace/ui/components/spinner'
import { cn } from '@workspace/ui/lib/utils'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'

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

const COPIED_RESET_MS = 1_200
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
  const [copied, setCopied] = useState(false)
  const busy = isProviderSignInBusy(signIn.phase)
  const phaseCopy = providerSignInPhaseCopy({ method: signIn.method, phase: signIn.phase })
  const command = providerSignInCommand(signIn.method)
  const accountLabel = providerAccountLabel(signIn.account)

  useEffect(() => {
    if (signIn.phase !== 'succeeded') return

    const timer = window.setTimeout(() => onOpenChange(false), SUCCESS_CLOSE_DELAY_MS)
    return () => window.clearTimeout(timer)
  }, [onOpenChange, signIn.phase])

  useEffect(() => {
    if (!copied) return

    const timer = window.setTimeout(() => setCopied(false), COPIED_RESET_MS)
    return () => window.clearTimeout(timer)
  }, [copied])

  // Closing mid-flight kills the attempt: the CLI child process would otherwise
  // outlive the dialog with nothing left to report to.
  const handleOpenChange = (next: boolean) => {
    if (!next && busy) signIn.cancelSignIn()
    if (!next) signIn.reset()

    onOpenChange(next)
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className='flex w-[min(460px,calc(100vw-2rem))] max-w-none flex-col border sm:max-w-none'>
        <DialogHeader>
          <DialogTitle>{phaseCopy.title}</DialogTitle>
          <DialogDescription>{phaseCopy.description}</DialogDescription>
        </DialogHeader>

        {signIn.isAuthenticated ? (
          <div className='border-success/30 bg-success/10 text-success flex items-center gap-(--density-control-gap) border px-(--density-control-padding-x) py-(--density-section-gap) text-xs'>
            <CheckCircleIcon className='size-3.5 shrink-0' />
            <span className='min-w-0 flex-1 truncate'>
              {accountLabel ?? `${providerLabel} is signed in.`}
            </span>
          </div>
        ) : null}

        {busy ? (
          <div className='border-border bg-muted flex items-start gap-(--density-control-gap) border px-(--density-control-padding-x) py-(--density-section-gap) text-xs'>
            <Spinner className='text-muted-foreground mt-0.5' />
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
          <div
            className='border-warning/30 bg-warning/10 text-warning flex items-start gap-(--density-control-gap) border px-(--density-control-padding-x) py-(--density-section-gap) text-xs'
            role='status'
          >
            <WarningCircleIcon className='mt-0.5 size-3.5 shrink-0' />
            <span className='min-w-0 flex-1 break-words'>{signIn.statusError}</span>
          </div>
        ) : null}

        {signIn.attemptError ? (
          <div
            className='border-destructive/30 bg-destructive/10 text-destructive flex items-start gap-(--density-control-gap) border px-(--density-control-padding-x) py-(--density-section-gap) text-xs'
            role='alert'
          >
            <WarningCircleIcon className='mt-0.5 size-3.5 shrink-0' />
            <span className='min-w-0 flex-1 break-words'>{signIn.attemptError}</span>
          </div>
        ) : null}

        <div className='border-border flex flex-col gap-(--density-control-gap) border px-(--density-control-padding-x) py-(--density-section-gap)'>
          <p className='text-muted-foreground text-2xs'>
            No browser tab? Run this in a terminal instead:
          </p>
          <div className='flex items-center gap-(--density-control-gap)'>
            <code className='text-foreground min-w-0 flex-1 truncate font-mono text-xs'>
              {command}
            </code>
            <Button
              aria-label={copied ? 'Sign-in command copied' : 'Copy sign-in command'}
              onClick={() => void copyCommand(command, () => setCopied(true))}
              size='icon-xs'
              type='button'
              variant='outline'
            >
              {copied ? <CheckIcon /> : <CopyIcon />}
            </Button>
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

async function copyCommand(command: string, onCopied: () => void) {
  if (!navigator.clipboard?.writeText) {
    toast.error('Clipboard is unavailable')
    return
  }

  try {
    await navigator.clipboard.writeText(command)
    onCopied()
  } catch {
    toast.error('Could not copy the sign-in command')
  }
}
