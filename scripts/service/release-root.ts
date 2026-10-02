import path from 'node:path'

/**
 * The `server.releaseRoot` setting, or the platform's application data folder when it is empty.
 * It holds `releases/`, the `current` and `pending` links, `bin/promote.ts` and `logs/`.
 */
export function machineReleaseRoot(
  configured: string,
  host: {
    platform: NodeJS.Platform
    home: string
    env: Readonly<Record<string, string | undefined>>
  },
): string {
  if (configured) return configured
  if (host.platform === 'darwin')
    return path.join(host.home, 'Library', 'Application Support', 'Fregat', 'releases')
  const data = host.env.XDG_DATA_HOME || path.join(host.home, '.local', 'share')
  return path.join(data, 'fregat', 'releases')
}
