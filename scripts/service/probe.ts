import { randomBytes } from 'node:crypto'
import net from 'node:net'
import {
  serverIdentitySchema,
  type ServerIdentity,
} from '../../packages/contracts/src/server-identity'
import * as v from 'valibot'
import {
  IDENTITY_PROOF_HEADER,
  proofMatches,
  readIdentityKey,
} from '../../apps/server/src/system/identity-key'

/** What answers at the fixed address. */
export type ProbeOutcome =
  | { kind: 'free' }
  | { kind: 'fregat'; identity: ServerIdentity; proven: boolean }
  | { kind: 'other'; status: number | null }
  | { kind: 'unverified'; reason: 'timeout' | 'refused-auth' | 'connection' }

export type Probe = { address: string; stateHome: string; timeoutMs: number; signal?: AbortSignal }

/**
 * Connects first, so a closed port reads as free without an HTTP attempt. A listener then gets
 * one identity request carrying a fresh nonce; only a server holding this state home's key can
 * return its proof. The request comes from this machine with the install origin and no proxy.
 */
export async function probeAddress(
  probe: Probe,
  fetcher: typeof fetch = fetch,
): Promise<ProbeOutcome> {
  const url = new URL(probe.address)
  const signal = AbortSignal.any([
    AbortSignal.timeout(probe.timeoutMs),
    ...(probe.signal ? [probe.signal] : []),
  ])
  if (!(await listening(url.hostname, Number(url.port), signal))) {
    probe.signal?.throwIfAborted()
    return signal.aborted ? { kind: 'unverified', reason: 'timeout' } : { kind: 'free' }
  }
  const nonce = randomBytes(24).toString('base64url')
  let response: Response
  try {
    response = await fetcher(`${probe.address}/system/identity?challenge=${nonce}`, {
      headers: { origin: probe.address },
      redirect: 'manual',
      signal,
    })
  } catch (error) {
    probe.signal?.throwIfAborted()
    return { kind: 'unverified', reason: signal.aborted ? 'timeout' : 'connection' }
  }
  return classify(response, nonce, probe.stateHome)
}

async function classify(
  response: Response,
  nonce: string,
  stateHome: string,
): Promise<ProbeOutcome> {
  const body: unknown = await response.json().catch(() => null)
  const identity = v.safeParse(serverIdentitySchema, body)
  if (response.ok && identity.success) {
    const key = readIdentityKey(stateHome)
    const proof = response.headers.get(IDENTITY_PROOF_HEADER)
    return {
      kind: 'fregat',
      identity: identity.output,
      proven: key !== null && proofMatches(key, nonce, proof),
    }
  }
  // A Fregat server that refuses identity to this request says so in its own error envelope.
  if (fregatRefusal(body)) return { kind: 'unverified', reason: 'refused-auth' }
  return { kind: 'other', status: response.status }
}

function fregatRefusal(body: unknown) {
  if (typeof body !== 'object' || body === null || !('error' in body)) return false
  const error = body.error
  if (typeof error !== 'object' || error === null || !('code' in error)) return false
  return (
    error.code === 'system.NOT_LOCAL' ||
    error.code === 'DEVICE_NOT_PAIRED' ||
    error.code === 'FORBIDDEN_ORIGIN'
  )
}

function listening(host: string, port: number, signal: AbortSignal) {
  return new Promise<boolean>((resolve) => {
    const socket = net.connect({ host, port, signal })
    socket.once('connect', () => {
      socket.destroy()
      resolve(true)
    })
    socket.once('error', () => resolve(false))
  })
}
