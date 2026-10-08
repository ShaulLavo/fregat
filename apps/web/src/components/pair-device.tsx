import { DesktopIcon, DeviceMobileIcon, DeviceTabletIcon } from '@phosphor-icons/react'
import { useMutation } from '@tanstack/react-query'
import { Button } from '@workspace/ui/components/button'
import { InputGroup, InputGroupInput } from '@workspace/ui/components/input-group'
import { useState, type FormEvent } from 'react'

import { InlineError } from '@/components/inline-error'
import { PairingSteps } from '@/components/pairing-steps'
import { clientErrorDescription, toClientError } from '@/lib/client-error-taxonomy'
import { primaryQueryClient } from '@/lib/environments/state/query-clients'
import { usePairingLinkStore } from '@/lib/pairing/state/link-outcome'
import { claimPairingMutationOptions } from '@/lib/pairing/utils/api'
import { deviceKind, deviceLabel } from '@/lib/pairing/utils/device-label'
import { normalizePairingCode } from '@/components/utils/pairing-code'

/** Run on the machine, from its release folder: prints a code with no browser at hand. */
const PAIR_COMMAND = 'bun current/server/pair.js'

const KIND_ICONS = { phone: DeviceMobileIcon, tablet: DeviceTabletIcon, browser: DesktopIcon }

/**
 * What a device the machine does not know yet sees: which machine this is, why it asks, where a
 * code comes from, and a field for it. Pairing grants full access, and the screen says so.
 */
export function PairDevice({
  machine,
  onPaired,
}: {
  /** The machine's name from `/pairing/status`; null when the status could not be read. */
  readonly machine: string | null
  readonly onPaired: () => void
}) {
  const [input, setInput] = useState('')
  const linkFailure = usePairingLinkStore((state) => state.failure)
  const claim = useMutation(claimPairingMutationOptions(), primaryQueryClient())
  const code = normalizePairingCode(input)
  const failure = claim.error ? clientErrorDescription(toClientError(claim.error)) : linkFailure
  const kind = deviceKind(navigator.userAgent, navigator.maxTouchPoints)
  const Icon = KIND_ICONS[kind]
  const name = machine ?? 'this machine'
  const title = `Pair this ${kind} with ${name}`

  function submit(event: FormEvent) {
    event.preventDefault()
    if (!code) return
    claim.mutate({ code, label: deviceLabel(navigator.userAgent) }, { onSuccess: onPaired })
  }

  return (
    <main
      aria-labelledby='pair-device-title'
      className='bg-background text-foreground grid min-h-svh place-content-center p-(--density-section-padding) pt-[max(var(--density-section-padding),env(safe-area-inset-top))]'
    >
      <form
        className='grid w-80 max-w-full gap-(--density-section-gap) md:w-[40rem] md:grid-cols-2 md:gap-x-8'
        onSubmit={submit}
      >
        <div className='flex min-w-0 flex-col gap-(--density-section-gap)'>
          <span className='bg-info/10 text-info flex size-(--density-control-height) items-center justify-center rounded-md'>
            <Icon className='size-(--icon-size)' weight='duotone' />
          </span>
          <h1 className='text-sm font-semibold break-words' id='pair-device-title'>
            {title}
          </h1>
          <p className='text-muted-foreground text-xs'>
            {machine ?? 'This machine'} opens for its own screen and for devices paired with it.
            This {kind} is not paired yet.
          </p>
          <PairingSteps kind={kind} machine={name} />
        </div>
        <div className='flex min-w-0 flex-col gap-(--density-section-gap) md:justify-end'>
          <InputGroup>
            <InputGroupInput
              aria-label='Pairing code'
              autoCapitalize='characters'
              autoComplete='one-time-code'
              autoCorrect='off'
              className='font-mono uppercase'
              placeholder='ABCD EFGH JKLM'
              spellCheck={false}
              value={input}
              onChange={(event) => setInput(event.target.value)}
            />
          </InputGroup>
          <Button disabled={!code || claim.isPending} type='submit'>
            Pair
          </Button>
          <p className='text-muted-foreground text-xs'>
            Pairing gives this {kind} {name}’s files, terminals and agents.
          </p>
          {failure ? <InlineError message={failure} title={title} /> : null}
          <p className='bg-muted text-muted-foreground rounded-lg p-(--density-section-gap) text-xs'>
            Away from {name} with nothing paired? Over SSH on {name}, run{' '}
            <code className='text-foreground font-mono whitespace-nowrap'>{PAIR_COMMAND}</code> in
            Fregat’s release folder. It prints a code.
          </p>
          {kind === 'browser' ? (
            <p className='text-muted-foreground text-xs'>
              Sitting at {name}? Open Fregat there; it opens without a code.
            </p>
          ) : null}
        </div>
      </form>
    </main>
  )
}
