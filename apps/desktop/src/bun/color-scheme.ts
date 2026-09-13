import type { ShellColorScheme, ShellPlatform } from '../shared/window'
import { recordDesktopError } from './observability'

// org.freedesktop.appearance color-scheme: 0 no preference, 1 dark, 2 light.
const PORTAL_READ = [
  'gdbus',
  'call',
  '--session',
  '--dest',
  'org.freedesktop.portal.Desktop',
  '--object-path',
  '/org/freedesktop/portal/desktop',
  '--method',
  'org.freedesktop.portal.Settings.ReadOne',
  'org.freedesktop.appearance',
  'color-scheme',
]

/**
 * Only Linux needs the shell to answer this. WKWebView and WebView2 follow the
 * OS on their own, and the GTK settings WebKitGTK would consult never arrive
 * on the X11 backend Electrobun forces, so the desktop portal is asked instead.
 */
export async function readSystemColorScheme(platform: ShellPlatform): Promise<ShellColorScheme> {
  if (platform !== 'linux') return null

  try {
    const result = Bun.spawn({ cmd: PORTAL_READ, stderr: 'pipe', stdout: 'pipe' })
    const output = await new Response(result.stdout).text()
    if ((await result.exited) !== 0) return null

    return parsePortalColorScheme(output)
  } catch (error) {
    recordDesktopError('desktop.color_scheme.unreadable', { error: String(error) })
    return null
  }
}

export function parsePortalColorScheme(output: string): ShellColorScheme {
  const match = /uint32 (\d+)/u.exec(output)
  if (match?.[1] === '1') return 'dark'
  if (match?.[1] === '2') return 'light'

  return null
}
