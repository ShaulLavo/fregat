import path from 'node:path'
import { readlinkSync, readFileSync, realpathSync } from 'node:fs'
import { hostname } from 'node:os'
import { createHash } from 'node:crypto'
import { defaultDevStateHome } from '../../../../scripts/state-home'
import type { BrowserCandidate } from './browser'
import { runMacCommand } from './mac-browser'
import { browserExecutableMatches } from './singleton'

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
      ? [
          candidate.args[0]!,
          `--filesystem=${profile}`,
          ...(app ? [] : ['--forward-fd=3', '--forward-fd=4']),
          ...candidate.args.slice(1),
        ]
      : candidate.args
  return [
    ...prefix,
    ...(app
      ? [`--app-id=${app.appId}`, `--app-launch-url-for-shortcuts-menu-item=${app.url}`]
      : ['about:blank']),
    `--user-data-dir=${profile}`,
    '--profile-directory=Platform',
    ...(app ? [] : ['--remote-debugging-pipe']),
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-sync',
    '--disable-background-networking',
    '--disable-component-update',
    '--disable-default-apps',
    '--disable-extensions',
    '--window-size=1440,960',
  ]
}

// A Dock-started owner has no debugging pipe. Its dedicated profile must still stay exclusive.
export function browserProfileBusy(profile: string) {
  try {
    const lock = readlinkSync(path.join(profile, 'SingletonLock'))
    const prefix = hostname() + '-'
    if (!lock.startsWith(prefix)) return true
    const pid = Number(lock.slice(prefix.length))
    if (!Number.isSafeInteger(pid) || pid <= 0) return true
    try {
      process.kill(pid, 0)
    } catch (error) {
      return (error as NodeJS.ErrnoException).code !== 'ESRCH'
    }
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== 'ENOENT'
  }
}

export function browserProfileOwner(profile: string, executable: string, expectedPid?: number) {
  try {
    const lock = readlinkSync(path.join(profile, 'SingletonLock'))
    const prefix = hostname() + '-'
    if (!lock.startsWith(prefix)) return false
    const pid = lock.slice(prefix.length)
    if (!/^[1-9]\d*$/.test(pid) || (expectedPid !== undefined && Number(pid) !== expectedPid))
      return false
    const selected = realpathSync(executable)
    if (process.platform === 'darwin') {
      const command = runMacCommand(['/bin/ps', '-p', pid, '-o', 'command='])?.trim()
      const signature = ` --user-data-dir=${profile} --profile-directory=Platform`
      return Boolean(
        command?.startsWith(selected + ' ') &&
        (command.includes(signature + ' ') || command.endsWith(signature)),
      )
    }
    if (process.platform !== 'linux') return false
    const command = readFileSync(`/proc/${pid}/cmdline`, 'utf8').split('\0').filter(Boolean)
    if (!browserExecutableMatches(selected, readlinkSync(`/proc/${pid}/exe`))) return false
    if (command.length === 1) {
      const signature = ` --user-data-dir=${profile} --profile-directory=Platform`
      return command[0]!.includes(signature + ' ') || command[0]!.endsWith(signature)
    }
    return (
      command.includes(`--user-data-dir=${profile}`) &&
      command.includes('--profile-directory=Platform')
    )
  } catch {
    return false
  }
}
