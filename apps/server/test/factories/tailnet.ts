import type { TailnetStatusCommand } from '../../src/machines/tailnet-hosts'

type Peer = {
  ID: string
  HostName: string
  DNSName: string
  TailscaleIPs: readonly string[]
  Online: boolean
}

export function tailnetPeer(overrides: Partial<Peer> = {}): Peer {
  return {
    ID: 'peer-one',
    HostName: 'devbox',
    DNSName: 'devbox.example.ts.net.',
    TailscaleIPs: ['100.64.0.2', 'fd7a:115c:a1e0::2'],
    Online: true,
    ...overrides,
  }
}

export function tailnetStatusCommand(
  options: {
    backendState?: string
    magicDnsEnabled?: boolean
    peers?: readonly unknown[]
    self?: { ID?: string; TailscaleIPs?: readonly string[] }
  } = {},
): TailnetStatusCommand {
  return async () =>
    JSON.stringify({
      BackendState: options.backendState ?? 'Running',
      CurrentTailnet: { MagicDNSEnabled: options.magicDnsEnabled ?? true },
      Self: options.self ?? { ID: 'self', TailscaleIPs: ['100.64.0.1'] },
      Peer: Object.fromEntries((options.peers ?? []).map((peer, index) => [`peer-${index}`, peer])),
    })
}
