import path from 'node:path'
import { createHash } from 'node:crypto'
import { defaultDevStateHome } from '../../../../scripts/state-home'
import type { BrowserCandidate } from './browser'

export function desktopStateHome(
  env: { PLATFORM_HOME?: string },
  home: string,
  mode: 'dev' | 'production',
) {
  return path.resolve(
    env.PLATFORM_HOME ||
      (mode === 'dev' ? defaultDevStateHome(home) : path.join(home, '.platform')),
  )
}

export function browserProfile(candidate: BrowserCandidate, stateHome: string, home: string) {
  if (candidate.confinement !== 'snap') return path.join(stateHome, 'desktop/chromium')
  // Snap permits its common directory, but denies ordinary hidden homes.
  const namespace = createHash('sha256').update(stateHome).digest('hex')
  return path.join(
    home,
    'snap',
    path.basename(candidate.executable),
    'common/platform',
    namespace,
    'chromium',
  )
}

export function chromiumArguments(
  candidate: BrowserCandidate,
  profile: string,
  app?: { appId: string; url: string },
): string[] {
  const prefix =
    candidate.confinement === 'flatpak'
      ? [candidate.args[0]!, `--filesystem=${profile}`].concat(
          app ? [] : ['--forward-fd=3', '--forward-fd=4'],
          candidate.args.slice(1),
        )
      : candidate.args
  return prefix.concat(
    app
      ? [`--app-id=${app.appId}`, `--app-launch-url-for-shortcuts-menu-item=${app.url}`]
      : ['about:blank', '--headless=new'],
    [`--user-data-dir=${profile}`, '--profile-directory=Platform'],
    app ? [] : ['--remote-debugging-pipe'],
    [
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-sync',
      '--disable-background-networking',
      '--disable-component-update',
      '--disable-default-apps',
      '--disable-extensions',
      '--window-size=1440,960',
    ],
  )
}
