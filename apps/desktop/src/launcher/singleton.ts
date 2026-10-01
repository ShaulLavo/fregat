import { readFileSync, readlinkSync, realpathSync } from 'node:fs'
import { hostname } from 'node:os'
import path from 'node:path'

type SingletonFileSystem = {
  readLink(file: string): string | undefined
  readFile(file: string): string | undefined
  realPath(file: string): string | undefined
}

const wrapperExecutables: Record<string, readonly string[]> = {
  '/usr/bin/chromium': ['/usr/lib/chromium/chromium'],
  '/usr/bin/chromium-browser': ['/usr/lib/chromium-browser/chromium-browser'],
  '/opt/google/chrome/google-chrome': ['/opt/google/chrome/chrome'],
  '/opt/brave.com/brave/brave-browser': ['/opt/brave.com/brave/brave'],
  '/usr/bin/brave': ['/opt/brave-bin/brave'],
  '/usr/bin/brave-browser': ['/opt/brave-bin/brave', '/opt/brave.com/brave/brave'],
  '/opt/microsoft/msedge/microsoft-edge': ['/opt/microsoft/msedge/msedge'],
  '/opt/vivaldi/vivaldi': ['/opt/vivaldi/vivaldi-bin'],
  '/opt/helium/helium-browser': ['/opt/helium/helium'],
  '/opt/thorium/thorium-browser': ['/opt/thorium/thorium'],
}

export function hasSingletonOwner(
  profile: string,
  host: string,
  executable: string,
  fs: SingletonFileSystem,
): boolean {
  const lock = fs.readLink(path.join(profile, 'SingletonLock'))
  const pid = lock?.startsWith(host + '-') ? lock.slice(host.length + 1) : undefined
  if (!pid || !/^[1-9]\d*$/.test(pid)) return false
  const selected = fs.realPath(executable)
  const owner = fs.readLink(`/proc/${pid}/exe`)
  if (!selected || !owner) return false
  if (owner !== selected && !wrapperExecutables[selected]?.includes(owner)) return false
  const command = fs.readFile(`/proc/${pid}/cmdline`)?.split('\0').filter(Boolean)
  if (!command?.length) return false
  if (command.length > 1)
    return (
      command.includes(`--user-data-dir=${profile}`) && command.includes('--remote-debugging-pipe')
    )
  // Chromium rewrites argv into one process-title string on Linux.
  const signature = ` --user-data-dir=${profile} --profile-directory=Platform --remote-debugging-pipe`
  return command[0]!.includes(signature + ' ') || command[0]!.endsWith(signature)
}

// Chromium arbitrates the singleton; this read-only proof never grants cleanup ownership.
export function liveSingletonOwner(profile: string, executable: string): boolean {
  return hasSingletonOwner(profile, hostname(), executable, {
    readLink: (file) => {
      try {
        return readlinkSync(file)
      } catch {
        return undefined
      }
    },
    readFile: (file) => {
      try {
        return readFileSync(file, 'utf8')
      } catch {
        return undefined
      }
    },
    realPath: (file) => {
      try {
        return realpathSync(file)
      } catch {
        return undefined
      }
    },
  })
}
