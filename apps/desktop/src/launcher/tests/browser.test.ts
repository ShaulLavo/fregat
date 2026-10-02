import { expect, test } from 'vitest'
import {
  resolveBrowserCandidates,
  type BrowserEnvironment,
  type BrowserFileSystem,
} from '../browser'

const env: BrowserEnvironment = { home: '/home/test', path: '/usr/bin:/opt/bin' }
function filesystem(files: Record<string, string>): BrowserFileSystem {
  return { readFile: (file) => files[file], exists: (file) => file in files }
}
function resolve(
  files: Record<string, string>,
  setting: unknown = 'auto',
  transparency = 'compositor',
  environment = env,
) {
  return resolveBrowserCandidates(setting, transparency, environment, filesystem(files))
}
const defaultFiles = {
  '/home/test/.config/mimeapps.list':
    '[Default Applications]\nx-scheme-handler/https=helium.desktop;\n',
  '/usr/share/applications/helium.desktop':
    '[Desktop Entry]\nExec="/opt/bin/helium-browser" --evil-flag %U\n',
  '/opt/bin/helium-browser': '',
  '/usr/bin/google-chrome': '',
  '/usr/bin/chromium': '',
}

test('absolute setting precedes Chrome and supported default; desktop arguments never execute', () => {
  const result = resolve({ ...defaultFiles, '/custom/browser': '' }, '/custom/browser')
  expect(result.slice(0, 3)).toMatchObject([
    { executable: '/custom/browser', source: 'setting', args: [] },
    { executable: '/usr/bin/google-chrome', source: 'scan' },
    { executable: '/opt/bin/helium-browser', source: 'default', args: [] },
  ])
})
test('auto prefers Chrome over the default, deduplicates scan and keeps native/tab fallbacks', () => {
  const result = resolve(defaultFiles)
  expect(result.slice(0, 3)).toMatchObject([
    { executable: '/usr/bin/google-chrome', source: 'scan' },
    { executable: '/opt/bin/helium-browser', source: 'default' },
    { executable: '/usr/bin/chromium', source: 'scan' },
  ])
  expect(result.filter((value) => value.kind === 'chromium')).toHaveLength(3)
  expect(result.slice(-2)).toEqual([{ kind: 'webview' }, { kind: 'tab' }])
})
test('explicit webview and automatic window transparency select native fallback', () => {
  expect(resolve(defaultFiles, 'webview')).toEqual([{ kind: 'webview' }, { kind: 'tab' }])
  expect(resolve(defaultFiles, 'auto', 'window')).toEqual([{ kind: 'webview' }, { kind: 'tab' }])
})
test.each(['relative/browser', '', '/bad\0path', '/bad\npath', 1, null])(
  'reject malformed setting %s',
  (setting) => {
    expect(() => resolve(defaultFiles, setting)).toThrow('window browser setting')
  },
)
test.each(['"unterminated', 'firefox %U', 'env chromium %U', 'sh -c chromium', 'chromium\\'])(
  'ignore unsupported/malformed desktop Exec %s',
  (exec) => {
    const result = resolve({
      ...defaultFiles,
      '/usr/share/applications/helium.desktop': `[Desktop Entry]\nExec=${exec}`,
    })
    expect(result[0]).toMatchObject({ executable: '/usr/bin/google-chrome', source: 'scan' })
  },
)
test('desktop-specific XDG config beats generic config and honours data roots', () => {
  const result = resolve(
    {
      ...defaultFiles,
      '/config/hyprland-mimeapps.list':
        '[Default Applications]\nx-scheme-handler/https=chrome.desktop;',
      '/data/applications/chrome.desktop': '[Desktop Entry]\nExec=google-chrome %U',
    },
    'auto',
    'compositor',
    { ...env, configHome: '/config', dataHome: '/data', currentDesktop: 'Hyprland' },
  )
  expect(result[0]).toMatchObject({ executable: '/usr/bin/google-chrome', source: 'default' })
})
test('untrusted desktop names cannot escape application directories', () => {
  const result = resolve({
    ...defaultFiles,
    '/home/test/.config/mimeapps.list':
      '[Default Applications]\nx-scheme-handler/https=../../evil.desktop;',
  })
  expect(result[0]).toMatchObject({ source: 'scan' })
})
test('flatpak export candidates separate launcher executable, id and confinement', () => {
  const result = resolve({
    '/usr/bin/flatpak': '',
    '/var/lib/flatpak/exports/bin/com.brave.Browser': '',
  })
  expect(result[0]).toEqual({
    kind: 'chromium',
    executable: '/usr/bin/flatpak',
    args: ['run', 'com.brave.Browser'],
    source: 'scan',
    family: 'brave',
    confinement: 'flatpak',
  })
})
test('Chrome precedes default flatpak, which strips desktop arguments and precedes other scan', () => {
  const result = resolve({
    ...defaultFiles,
    '/usr/bin/flatpak': '',
    '/usr/share/applications/helium.desktop':
      '[Desktop Entry]\nExec=/usr/bin/flatpak run --branch=stable com.brave.Browser --bad %U',
  })
  expect(result.slice(0, 3)).toMatchObject([
    { family: 'chrome' },
    {
      executable: '/usr/bin/flatpak',
      args: ['run', 'com.brave.Browser'],
      source: 'default',
    },
    { family: 'chromium' },
  ])
})
test('snap candidate is explicit and missing setting falls through', () => {
  expect(resolve({ '/snap/bin/chromium': '' }, '/missing/browser')[0]).toMatchObject({
    confinement: 'snap',
    executable: '/snap/bin/chromium',
    source: 'scan',
  })
})

test('configured flatpak export keeps setting precedence and explicit confinement', () => {
  const exported = '/home/test/.local/share/flatpak/exports/bin/org.chromium.Chromium'
  expect(
    resolve({ ...defaultFiles, [exported]: '', '/usr/bin/flatpak': '' }, exported)[0],
  ).toMatchObject({
    executable: '/usr/bin/flatpak',
    args: ['run', 'org.chromium.Chromium'],
    confinement: 'flatpak',
    source: 'setting',
  })
})

test('without Chrome, auto selects the supported default before scan', () => {
  const files = { ...defaultFiles }
  delete (files as Record<string, string>)['/usr/bin/google-chrome']
  expect(resolve(files).slice(0, 2)).toMatchObject([
    { family: 'helium', source: 'default' },
    { family: 'chromium', source: 'scan' },
  ])
})
test('without Chrome or a supported default, auto scans before webview', () => {
  expect(resolve({ '/usr/bin/brave': '' })).toMatchObject([
    { family: 'brave', source: 'scan' },
    { kind: 'webview' },
    { kind: 'tab' },
  ])
  expect(resolve({})).toEqual([{ kind: 'webview' }, { kind: 'tab' }])
})
test('Flatpak Chrome precedes a supported native default and native Chromium scan', () => {
  const files = { ...defaultFiles }
  delete (files as Record<string, string>)['/usr/bin/google-chrome']
  expect(
    resolve({
      ...files,
      '/usr/bin/flatpak': '',
      '/var/lib/flatpak/exports/bin/com.google.Chrome': '',
    }).slice(0, 3),
  ).toMatchObject([
    { family: 'chrome', confinement: 'flatpak', args: ['run', 'com.google.Chrome'] },
    { family: 'helium', source: 'default' },
    { family: 'chromium', source: 'scan' },
  ])
})
