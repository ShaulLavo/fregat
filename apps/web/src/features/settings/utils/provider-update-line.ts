import type { ProviderUpdateAdvisory } from '@workspace/contracts'

type UpdateLine = {
  /** Mono: the installed version, or installed → latest. */
  readonly versions: string | null
  /** Words: where the CLI stands, when the versions do not say it. */
  readonly note: string | null
  /** Mono: the command to run by hand. */
  readonly command: string | null
  readonly action: 'update' | 'copy' | null
  readonly title: string
}

export function updateLine(advisory: ProviderUpdateAdvisory): UpdateLine {
  const { canUpdate, command, installedVersion, latestVersion, method, status } = advisory
  const title = `Installed ${installedVersion ?? 'unknown'} · latest ${latestVersion ?? 'unknown'}`
  if (status !== 'behind') {
    const note = status === 'current' ? 'Up to date' : installedVersion ? null : 'Version unknown'
    return { action: null, command: null, note, title, versions: installedVersion }
  }

  const versions = `${installedVersion} → ${latestVersion}`
  if (canUpdate) return { action: 'update', command: null, note: null, title, versions }
  if (command)
    return { action: 'copy', command, note: null, title: `${title} · ${command}`, versions }

  const note = method === 'bundled' ? 'Updates with the app' : 'Update it where it was installed'
  return { action: null, command: null, note, title, versions }
}
