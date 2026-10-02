import path from 'node:path'
import { macBrowserCandidates, runMacCommand, type MacCommand } from './mac-browser'
import { launcherErrors } from './structured-errors'

export type BrowserCandidate = {
  kind: 'chromium'
  executable: string
  args: readonly string[]
  confinement: 'none' | 'snap' | 'flatpak'
  source: 'setting' | 'default' | 'scan'
  family: string
}
export type WindowCandidate = BrowserCandidate | { kind: 'webview' } | { kind: 'tab' }
export type BrowserFileSystem = {
  readFile(file: string): string | undefined
  exists(file: string): boolean
}
export type BrowserEnvironment = {
  home: string
  path: string
  configHome?: string
  configDirs?: string
  dataHome?: string
  dataDirs?: string
  platform?: NodeJS.Platform
  runMac?: MacCommand
  currentDesktop?: string
}

const families = [
  {
    name: 'chrome',
    binaries: ['google-chrome-stable', 'google-chrome'],
    flatpak: 'com.google.Chrome',
  },
  {
    name: 'chromium',
    binaries: ['chromium', 'chromium-browser'],
    flatpak: 'org.chromium.Chromium',
  },
  { name: 'brave', binaries: ['brave-browser', 'brave'], flatpak: 'com.brave.Browser' },
  {
    name: 'edge',
    binaries: ['microsoft-edge-stable', 'microsoft-edge'],
    flatpak: 'com.microsoft.Edge',
  },
  { name: 'vivaldi', binaries: ['vivaldi-stable', 'vivaldi'], flatpak: 'com.vivaldi.Vivaldi' },
  { name: 'helium', binaries: ['helium-browser'], flatpak: undefined },
  { name: 'thorium', binaries: ['thorium-browser'], flatpak: undefined },
] as const

export function resolveBrowserCandidates(
  setting: unknown,
  transparency: unknown,
  env: BrowserEnvironment,
  fs: BrowserFileSystem,
): readonly WindowCandidate[] {
  if (setting === 'webview' || (setting === 'auto' && transparency === 'window')) {
    return [{ kind: 'webview' }, { kind: 'tab' }]
  }
  if (typeof setting !== 'string' || (setting !== 'auto' && !validAbsolutePath(setting))) {
    throw launcherErrors.BROWSER_SETTING_INVALID({ internal: { type: typeof setting } })
  }
  const candidates: BrowserCandidate[] = []
  if (setting !== 'auto' && fs.exists(setting)) {
    const configured = configuredBrowser(setting, env, fs)
    if (configured) candidates.push(configured)
  }
  if (env.platform === 'darwin') {
    candidates.push(...macBrowserCandidates(env, fs, env.runMac ?? runMacCommand))
    return [...deduplicate(candidates), { kind: 'webview' }, { kind: 'tab' }]
  }
  const desktop = defaultDesktop(env, fs)
  const preferred = desktop && desktopBrowser(desktop, env, fs)
  if (preferred) candidates.push(preferred)
  for (const family of families) {
    for (const binary of family.binaries) {
      const executable = findExecutable(binary, env, fs)
      if (executable) candidates.push(candidate(executable, 'scan', family.name))
    }
    if (family.name === 'chromium' && fs.exists('/snap/bin/chromium')) {
      candidates.push(candidate('/snap/bin/chromium', 'scan', family.name))
    }
  }
  for (const family of families) {
    if (!family.flatpak) continue
    const exported = flatpakExport(family.flatpak, env, fs)
    if (exported) candidates.push(flatpakCandidate(exported, family.flatpak, 'scan', family.name))
  }
  return [...deduplicate(candidates), { kind: 'webview' }, { kind: 'tab' }]
}

function deduplicate(candidates: readonly BrowserCandidate[]) {
  return candidates.filter(
    (value, index) =>
      candidates.findIndex(
        (other) =>
          other.executable === value.executable && other.args.join('\0') === value.args.join('\0'),
      ) === index,
  )
}

function configuredBrowser(setting: string, env: BrowserEnvironment, fs: BrowserFileSystem) {
  const exportRoots = [
    '/var/lib/flatpak/exports/bin',
    path.join(env.home, '.local/share/flatpak/exports/bin'),
  ]
  if (!exportRoots.includes(path.dirname(setting))) return candidate(setting, 'setting', 'custom')
  const family = families.find((entry) => entry.flatpak === path.basename(setting))
  const executable = findExecutable('flatpak', env, fs)
  if (!family?.flatpak || !executable) return undefined
  return flatpakCandidate(executable, family.flatpak, 'setting', family.name)
}

function validAbsolutePath(value: string) {
  return path.isAbsolute(value) && !/[\0\r\n]/.test(value)
}

function candidate(
  executable: string,
  source: BrowserCandidate['source'],
  family: string,
): BrowserCandidate {
  return {
    kind: 'chromium',
    executable,
    args: [],
    confinement: executable.startsWith('/snap/') ? 'snap' : 'none',
    source,
    family,
  }
}

function flatpakCandidate(
  executable: string,
  id: string,
  source: BrowserCandidate['source'],
  family: string,
): BrowserCandidate {
  return { kind: 'chromium', executable, args: ['run', id], confinement: 'flatpak', source, family }
}

function directories(value: string | undefined, fallback: string): string[] {
  return (value || fallback).split(':').filter(validAbsolutePath)
}

function findExecutable(binary: string, env: BrowserEnvironment, fs: BrowserFileSystem) {
  if (validAbsolutePath(binary)) return fs.exists(binary) ? binary : undefined
  for (const directory of directories(env.path, '/usr/bin:/bin')) {
    const executable = path.join(directory, binary)
    if (fs.exists(executable)) return executable
  }
  return undefined
}

function defaultDesktop(env: BrowserEnvironment, fs: BrowserFileSystem) {
  const roots = [
    env.configHome || path.join(env.home, '.config'),
    ...directories(env.configDirs, '/etc/xdg'),
  ]
  const data = [
    env.dataHome || path.join(env.home, '.local/share'),
    ...directories(env.dataDirs, '/usr/local/share:/usr/share'),
  ]
  const names = (env.currentDesktop || '')
    .split(':')
    .filter((name) => /^[a-zA-Z0-9_-]+$/.test(name))
    .map((name) => `${name.toLowerCase()}-mimeapps.list`)
  const files = roots.flatMap((root) =>
    [...names, 'mimeapps.list'].map((name) => path.join(root, name)),
  )
  files.push(
    ...data.flatMap((root) =>
      [...names, 'mimeapps.list'].map((name) => path.join(root, 'applications', name)),
    ),
  )
  for (const file of files) {
    const value = iniValue(fs.readFile(file), 'Default Applications', 'x-scheme-handler/https')
      ?.split(';')[0]
      ?.trim()
    if (value && /^[a-zA-Z0-9_.-]+\.desktop$/.test(value)) return value
  }
  return undefined
}

function desktopBrowser(desktop: string, env: BrowserEnvironment, fs: BrowserFileSystem) {
  const roots = [
    env.dataHome || path.join(env.home, '.local/share'),
    ...directories(env.dataDirs, '/usr/local/share:/usr/share'),
    path.join(env.home, '.local/share/flatpak/exports/share'),
    '/var/lib/flatpak/exports/share',
  ]
  for (const root of roots) {
    const exec = iniValue(
      fs.readFile(path.join(root, 'applications', desktop)),
      'Desktop Entry',
      'Exec',
    )
    if (!exec) continue
    const tokens = execTokens(exec)
    if (!tokens) return undefined
    const first = tokens[0]!
    const family = families.find((entry) =>
      entry.binaries.some((binary) => binary === path.basename(first)),
    )
    if (family) {
      const executable = findExecutable(first, env, fs)
      return executable && candidate(executable, 'default', family.name)
    }
    if (path.basename(first) !== 'flatpak' || tokens[1] !== 'run') return undefined
    const flatpakFamily = families.find(
      (entry) =>
        entry.flatpak && tokens.slice(2).find((token) => !token.startsWith('-')) === entry.flatpak,
    )
    const executable = findExecutable(first, env, fs)
    if (flatpakFamily?.flatpak && executable)
      return flatpakCandidate(executable, flatpakFamily.flatpak, 'default', flatpakFamily.name)
    return undefined
  }
  return undefined
}

function flatpakExport(id: string, env: BrowserEnvironment, fs: BrowserFileSystem) {
  const roots = [
    '/var/lib/flatpak/exports/bin',
    path.join(env.home, '.local/share/flatpak/exports/bin'),
  ]
  if (!roots.some((root) => fs.exists(path.join(root, id)))) return undefined
  return findExecutable('flatpak', env, fs)
}

function iniValue(text: string | undefined, section: string, key: string) {
  let current = ''
  for (const line of (text || '').split(/\r?\n/)) {
    const trimmed = line.trim()
    if (trimmed.startsWith('[')) current = trimmed.slice(1, -1)
    if (current !== section || !trimmed.startsWith(`${key}=`)) continue
    return trimmed.slice(key.length + 1).trim()
  }
  return undefined
}

// Desktop Exec is tokenized only to identify a supported browser; its arguments never execute.
function execTokens(value: string): string[] | undefined {
  if (/[\0\r\n]/.test(value)) return undefined
  const tokens: string[] = []
  let token = ''
  let quoted = false
  let escaped = false
  for (const char of value) {
    if (escaped) {
      token += char
      escaped = false
      continue
    }
    if (char === '\\') {
      escaped = true
      continue
    }
    if (char === '"') {
      quoted = !quoted
      continue
    }
    if (/\s/.test(char) && !quoted) {
      if (token) tokens.push(token)
      token = ''
      continue
    }
    token += char
  }
  if (quoted || escaped) return undefined
  if (token) tokens.push(token)
  return tokens.length ? tokens : undefined
}
