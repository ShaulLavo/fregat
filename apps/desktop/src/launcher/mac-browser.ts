import path from 'node:path'
import type { BrowserCandidate, BrowserEnvironment, BrowserFileSystem } from './browser'

export type MacCommand = (args: readonly string[]) => string | undefined
const bundles = [
  ['chrome', 'com.google.Chrome', 'Google Chrome.app'],
  ['chromium', 'org.chromium.Chromium', 'Chromium.app'],
  ['brave', 'com.brave.Browser', 'Brave Browser.app'],
  ['edge', 'com.microsoft.edgemac', 'Microsoft Edge.app'],
  ['vivaldi', 'com.vivaldi.Vivaldi', 'Vivaldi.app'],
  ['helium', 'net.imput.helium', 'Helium.app'],
] as const

function plist(file: string, run: MacCommand): Record<string, unknown> | undefined {
  try {
    const text = run(['/usr/bin/plutil', '-convert', 'json', '-o', '-', file])
    const value: unknown = text && JSON.parse(text)
    if (typeof value === 'object' && value !== null && !Array.isArray(value))
      return value as Record<string, unknown>
  } catch {}
  return undefined
}

export function macBrowserCandidates(
  env: BrowserEnvironment,
  fs: BrowserFileSystem,
  run: MacCommand,
): BrowserCandidate[] {
  const preferences = plist(
    path.join(
      env.home,
      'Library/Preferences/com.apple.LaunchServices/com.apple.launchservices.secure.plist',
    ),
    run,
  )
  const handlers = Array.isArray(preferences?.LSHandlers) ? preferences.LSHandlers : []
  const handler = handlers.find(
    (entry: unknown) =>
      typeof entry === 'object' &&
      entry !== null &&
      'LSHandlerURLScheme' in entry &&
      entry.LSHandlerURLScheme === 'https',
  )
  const preferred = handler?.LSHandlerRoleAll
  const priority = (id: string) => Number(id === 'com.google.Chrome') * 2 + Number(id === preferred)
  const ordered = bundles.toSorted((a, b) => priority(b[1]) - priority(a[1]))
  const result: BrowserCandidate[] = []
  for (const [family, id, name] of ordered) {
    const indexed =
      run(['/usr/bin/mdfind', `kMDItemCFBundleIdentifier == '${id}'`])?.split('\n') ?? []
    const roots = ['/Applications', path.join(env.home, 'Applications')].map((root) =>
      path.join(root, name),
    )
    const executable = bundleExecutable(roots.concat(indexed), id, fs, run)
    if (!executable) continue
    result.push({
      kind: 'chromium',
      executable,
      args: [],
      confinement: 'none',
      source: id === preferred ? 'default' : 'scan',
      family,
    })
  }
  return result
}

function bundleExecutable(
  roots: readonly string[],
  id: string,
  fs: BrowserFileSystem,
  run: MacCommand,
) {
  for (const root of roots) {
    if (!path.isAbsolute(root) || /[\0\r\n]/.test(root)) continue
    const info = plist(path.join(root, 'Contents/Info.plist'), run)
    const binary = info?.CFBundleExecutable
    if (info?.CFBundleIdentifier !== id || typeof binary !== 'string') continue
    if (!binary || path.basename(binary) !== binary || /[\0\r\n]/.test(binary)) continue
    const executable = path.join(root, 'Contents/MacOS', binary)
    if (fs.exists(executable)) return executable
  }
  return undefined
}

export function runMacCommand(args: readonly string[]): string | undefined {
  const result = Bun.spawnSync(Array.from(args), { stderr: 'ignore' })
  return result.exitCode === 0 ? new TextDecoder().decode(result.stdout) : undefined
}
