import { DeviceMobileIcon } from '@phosphor-icons/react'
import { useMutation } from '@tanstack/react-query'
import { Button } from '@workspace/ui/components/button'
import { InputGroup, InputGroupInput } from '@workspace/ui/components/input-group'
import { useState, type FormEvent } from 'react'

import { InlineError } from '@/components/inline-error'
import { clientErrorDescription, toClientError } from '@/lib/client-error-taxonomy'
import { primaryQueryClient } from '@/lib/environments/state/query-clients'
import { usePairingLinkStore } from '@/lib/pairing/state/link-outcome'
import { claimPairingMutationOptions } from '@/lib/pairing/utils/api'
import { deviceLabel } from '@/lib/pairing/utils/device-label'
import { normalizePairingCode } from '@/lib/pairing/utils/link'

/**
 * What a device the machine does not know yet sees: how to pair it, and a field for the code when
 * the link cannot be opened here. Pairing grants full access, and the screen says so.
 */
export function PairDevice({ onPaired }: { readonly onPaired: () => void }) {
  const [input, setInput] = useState('')
  const linkFailure = usePairingLinkStore((state) => state.failure)
  const claim = useMutation(claimPairingMutationOptions(), primaryQueryClient())
  const code = normalizePairingCode(input)
  const failure = claim.error ? clientErrorDescription(toClientError(claim.error)) : linkFailure

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
      <form className='flex w-80 max-w-full flex-col gap-(--density-section-gap)' onSubmit={submit}>
        <span className='bg-info/10 text-info flex size-(--density-control-height) items-center justify-center rounded-md'>
          <DeviceMobileIcon className='size-(--icon-size)' weight='duotone' />
        </span>
        <h1 className='text-sm font-semibold' id='pair-device-title'>
          Pair this device
        </h1>
        <p className='text-muted-foreground text-xs'>
          On the machine, open Settings › Machines and choose Pair a device. Scan its code with this
          device, or type the code below.
        </p>
        <p className='text-muted-foreground text-xs'>
          A paired device can use that machine’s files, terminals and agents, as you can at its
          keyboard.
        </p>
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
        {failure ? <InlineError message={failure} title='Pair this device' /> : null}
      </form>
    </main>
  )
}
