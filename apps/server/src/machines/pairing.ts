import { pairingLinkSchema } from '@workspace/contracts'
import * as v from 'valibot'
import { machineRelayPairingError } from './structured-errors'

/** The authenticated SSH forward gives this server local authority to pair its own relay. */
export async function pairMachineRelay(
  origin: string,
  webOrigin: string,
  label: string,
  sourceId: string,
  fetcher: typeof fetch,
): Promise<string> {
  const links = await fetcher(`${origin}/pairing/links`, {
    method: 'POST',
    headers: { origin: webOrigin },
  })
  const link = v.safeParse(pairingLinkSchema, await links.json().catch(() => null))
  if (!links.ok || !link.success) throw machineRelayPairingError('links', links.status)
  const claimed = await fetcher(`${origin}/pairing/claim`, {
    method: 'POST',
    headers: { origin: webOrigin, 'content-type': 'application/json' },
    body: JSON.stringify({ code: link.output.code, label, relaySourceId: sourceId }),
  })
  const cookie = claimed.headers.get('set-cookie')?.split(';')[0]
  if (!claimed.ok || !cookie) throw machineRelayPairingError('claim', claimed.status)
  return cookie
}
