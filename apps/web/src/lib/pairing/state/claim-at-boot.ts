import { clientErrorDescription, toClientError } from '@/lib/client-error-taxonomy'
import { primaryQueryClient } from '@/lib/environments/state/query-clients'
import { runMutation } from '@/lib/mutations/run'
import { usePairingLinkStore } from '@/lib/pairing/state/link-outcome'
import { claimPairingMutationOptions } from '@/lib/pairing/utils/api'
import { deviceLabel } from '@/lib/pairing/utils/device-label'
import { readHtmlBootstrap } from '@/lib/html-bootstrap'

/** Trades a pairing link's code for this device's cookie; a failure is for the pairing screen. */
export async function claimAtBoot(code: string) {
  return runMutation(primaryQueryClient(), claimPairingMutationOptions(), {
    code,
    label: deviceLabel(navigator.userAgent),
  })
    .then(() => {
      if (readHtmlBootstrap()?.kind !== 'pairing') return false
      window.location.reload()
      return true
    })
    .catch((cause: unknown) => {
      usePairingLinkStore.setState({ failure: clientErrorDescription(toClientError(cause)) })
      return false
    })
}
