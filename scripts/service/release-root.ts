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
  // The XDG spec says a relative value is invalid and must be ignored.
  const xdg = host.env.XDG_DATA_HOME
  const data = xdg && path.isAbsolute(xdg) ? xdg : path.join(host.home, '.local', 'share')
  return path.join(data, 'fregat', 'releases')
}
