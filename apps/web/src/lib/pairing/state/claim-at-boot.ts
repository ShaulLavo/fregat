import { clientErrorDescription, toClientError } from '@/lib/client-error-taxonomy'
import { primaryQueryClient } from '@/lib/environments/state/query-clients'
import { runMutation } from '@/lib/mutations/run'
import { usePairingLinkStore } from '@/lib/pairing/state/link-outcome'
import { claimPairingMutationOptions } from '@/lib/pairing/utils/api'
import { deviceLabel } from '@/lib/pairing/utils/device-label'

/** Trades a pairing link's code for this device's cookie; a failure is for the pairing screen. */
export async function claimAtBoot(code: string) {
  await runMutation(primaryQueryClient(), claimPairingMutationOptions(), {
    code,
    label: deviceLabel(navigator.userAgent),
  }).catch((cause: unknown) =>
    usePairingLinkStore.setState({ failure: clientErrorDescription(toClientError(cause)) }),
  )
}
