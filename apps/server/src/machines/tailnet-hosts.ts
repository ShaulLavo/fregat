import { execFile } from 'node:child_process'
import { isIP } from 'node:net'
import { promisify } from 'node:util'
import * as v from 'valibot'
import { operatorErrorSummary, recordRequestContext } from '../observability'

const hostSchema = v.object({ target: v.string(), label: v.string(), online: v.boolean() })

export const tailnetDiscoverySchema = v.variant('status', [
  v.object({ status: v.literal('available'), hosts: v.array(hostSchema) }),
  v.object({
    status: v.literal('unavailable'),
    hosts: v.tuple([]),
    reason: v.picklist(['not-installed', 'not-running', 'failed']),
  }),
])

export type TailnetDiscovery = v.InferOutput<typeof tailnetDiscoverySchema>
export type TailnetStatusCommand = () => Promise<string>

const identitySchema = v.object({
  ID: v.optional(v.string(), ''),
  TailscaleIPs: v.optional(v.array(v.string()), []),
})

const statusSchema = v.object({
  BackendState: v.string(),
  Self: v.optional(v.nullable(identitySchema)),
  CurrentTailnet: v.optional(
    v.nullable(v.object({ MagicDNSEnabled: v.optional(v.boolean(), false) })),
  ),
  Peer: v.optional(
    v.nullable(
      v.pipe(
        v.unknown(),
        v.check((value) => !Array.isArray(value)),
        v.record(v.string(), v.unknown()),
      ),
    ),
    {},
  ),
})

const peerSchema = v.object({
  ...identitySchema.entries,
  HostName: v.optional(v.string(), ''),
  DNSName: v.optional(v.string(), ''),
  Online: v.boolean(),
})

type Status = v.InferOutput<typeof statusSchema>
type Peer = v.InferOutput<typeof peerSchema>
type Host = v.InferOutput<typeof hostSchema>
type UnavailableReason = Extract<TailnetDiscovery, { status: 'unavailable' }>['reason']

const execFileAsync = promisify(execFile)

export async function discoverTailnetHosts(
  command: TailnetStatusCommand = runTailnetStatus,
): Promise<TailnetDiscovery> {
  const startedAt = performance.now()
  try {
    const contents = await command()
    const status = v.safeParse(statusSchema, JSON.parse(contents))
    if (!status.success) return unavailable('failed', startedAt, { failure: 'invalid-status' })
    if (status.output.BackendState !== 'Running')
      return unavailable('not-running', startedAt, { backendState: status.output.BackendState })
    const hosts = discoverPeers(status.output)
    recordRequestContext({
      tailnetDiscovery: {
        status: 'available',
        hosts: hosts.length,
        peers: Object.keys(status.output.Peer ?? {}).length,
        durationMs: Math.round(performance.now() - startedAt),
      },
    })
    return { status: 'available', hosts }
  } catch (error) {
    const code = errorCode(error)
    const reason = code === 'ENOENT' ? 'not-installed' : 'failed'
    return unavailable(reason, startedAt, { errorCode: code, error: operatorErrorSummary(error) })
  }
}

async function runTailnetStatus() {
  const { stdout } = await execFileAsync('tailscale', ['status', '--json'], {
    encoding: 'utf8',
    timeout: 3000,
    killSignal: 'SIGKILL',
    maxBuffer: 2 * 1024 * 1024,
    windowsHide: true,
  })
  return stdout
}

function discoverPeers(status: Status) {
  const hosts = new Map<string, Host>()
  for (const candidate of Object.values(status.Peer ?? {})) {
    const peer = v.safeParse(peerSchema, candidate)
    if (!peer.success || isSelf(peer.output, status.Self)) continue
    const host = peerHost(peer.output, status.CurrentTailnet?.MagicDNSEnabled ?? false)
    if (host) hosts.set(host.target, host)
  }
  return [...hosts.values()].sort(
    (left, right) =>
      left.label.localeCompare(right.label) || left.target.localeCompare(right.target),
  )
}

function isSelf(peer: Peer, self: Status['Self']) {
  if (!self) return false
  if (self.ID && peer.ID === self.ID) return true
  return peer.TailscaleIPs.some((address) => self.TailscaleIPs.includes(address))
}

function peerHost(peer: Peer, magicDns: boolean): Host | null {
  const addresses = peer.TailscaleIPs.filter((address) => isIP(address) !== 0)
  const address = addresses.find((value) => isIP(value) === 4) ?? addresses[0]
  if (!address) return null
  const dnsName = validDnsName(peer.DNSName)
  const target = magicDns && dnsName ? dnsName : address
  const label = dnsName?.split('.')[0] || validDnsName(peer.HostName) || address
  return { target, label, online: peer.Online }
}

function validDnsName(value: string) {
  const name = value.replace(/\.$/, '')
  if (name.length === 0 || name.length > 253) return null
  const valid = name
    .split('.')
    .every((label) => /^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?$/.test(label))
  return valid ? name : null
}

function unavailable(
  reason: UnavailableReason,
  startedAt: number,
  details: Record<string, unknown>,
): TailnetDiscovery {
  recordRequestContext({
    tailnetDiscovery: {
      ...details,
      status: 'unavailable',
      reason,
      hosts: 0,
      durationMs: Math.round(performance.now() - startedAt),
    },
  })
  return { status: 'unavailable', hosts: [], reason }
}

function errorCode(error: unknown) {
  if (error instanceof SyntaxError) return 'invalid-json'
  if (error instanceof Error && 'code' in error) return String(error.code)
  return 'unknown'
}
