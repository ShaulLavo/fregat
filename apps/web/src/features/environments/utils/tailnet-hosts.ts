import type { fetchTailnetHosts } from '@/lib/environments/machine-client'

type Unavailable = Extract<Awaited<ReturnType<typeof fetchTailnetHosts>>, { status: 'unavailable' }>

export function tailnetUnavailableMessage(reason: Unavailable['reason']): string {
  switch (reason) {
    case 'not-installed':
      return 'Tailscale is not installed on the machine running Platform.'
    case 'not-running':
      return 'Connect the machine running Platform to Tailscale to see its peers.'
    case 'failed':
      return 'Tailscale could not list peers. SSH config and manual addresses are still available.'
  }
}
