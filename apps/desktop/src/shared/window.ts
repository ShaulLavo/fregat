import type { SettingsValues } from '@workspace/contracts'

/**
 * Who paints what is behind the app, and how the two halves of the shell agree
 * on it.
 *
 * - `app` — nothing is behind the window, so the web layer draws its own
 *   wallpaper and its own opaque floor. A browser tab, and the macOS shell
 *   while its window is opaque.
 * - `compositor` — the window is opaque, but the window manager composites it
 *   over the real desktop and fades or blurs it there. Linux out of the box:
 *   drawing a wallpaper of our own would only cover up the user's.
 * - `transparent` — the window itself is see-through, so the desktop sits
 *   directly behind every translucent pane. The macOS NSVisualEffectView needs
 *   this, and so does per-pixel glass on Linux.
 *
 * `transparent` is not free anywhere: Electrobun's CEF implements window
 * transparency by switching to offscreen rendering, which blits the whole
 * surface through a CPU memcpy on every paint instead of letting the GPU
 * composite it. Measured on macOS: opaque produces zero OnPaint events,
 * transparent produces a 5.5MB copy per paint. The Linux build takes the same
 * path (`SetAsWindowless` + `EnableOSR`), which is why `compositor` is the
 * default there — the window manager already blends the window for free.
 */
export type ShellBackdrop = 'app' | 'compositor' | 'transparent'

/** Straight off the registry, so a rename there cannot leave the shell reading a key nobody writes. */
export type WindowTransparency = SettingsValues['window.transparency']

/** The OS the shell window lives on, so the page can reserve macOS traffic lights and nothing else. */
export type ShellPlatform = 'darwin' | 'linux' | 'win32'

/**
 * The desktop's light/dark preference, as the shell read it. `null` means the
 * webview's own `prefers-color-scheme` is trustworthy and should be used.
 * Linux needs this: Electrobun forces GTK onto X11, where no XSettings manager
 * runs, so WebKitGTK answers "light" whatever the desktop is set to.
 */
export type ShellColorScheme = 'dark' | 'light' | null

/** What the shell hands the web layer before its first module runs. */
export type ShellHandoff = {
  readonly backdrop: ShellBackdrop
  readonly platform: ShellPlatform
  readonly colorScheme: ShellColorScheme
}

const HANDOFF_GLOBAL = '__platformShell'

export function shellBackdrop(platform: string, transparency: WindowTransparency): ShellBackdrop {
  if (transparency === 'window') return 'transparent'
  if (platform === 'linux') return 'compositor'

  return 'app'
}

export function windowTransparent(backdrop: ShellBackdrop): boolean {
  return backdrop === 'transparent'
}

/**
 * Prepended to the preload bundle, so the page learns what kind of window it is
 * in from the process that created it rather than by reading the setting a
 * second time. The two can only disagree between a change and the restart the
 * setting requires — and disagreeing means painting a transparent floor into an
 * opaque window, which is a white app until the restart.
 */
export function handoffPrelude(handoff: ShellHandoff): string {
  return `globalThis.${HANDOFF_GLOBAL} = ${JSON.stringify(handoff)};\n`
}

/** Reads the prelude above. Every field falls back to the value that is safe everywhere. */
export function readShellHandoff(): ShellHandoff {
  const handoff = (globalThis as Record<string, unknown>)[HANDOFF_GLOBAL] as
    | Partial<ShellHandoff>
    | undefined

  return {
    backdrop: isBackdrop(handoff?.backdrop) ? handoff.backdrop : 'app',
    platform: isPlatform(handoff?.platform) ? handoff.platform : 'linux',
    colorScheme: isColorScheme(handoff?.colorScheme) ? handoff.colorScheme : null,
  }
}

export function shellPlatform(platform: string): ShellPlatform {
  return isPlatform(platform) ? platform : 'linux'
}

function isBackdrop(value: unknown): value is ShellBackdrop {
  return value === 'app' || value === 'compositor' || value === 'transparent'
}

function isPlatform(value: unknown): value is ShellPlatform {
  return value === 'darwin' || value === 'linux' || value === 'win32'
}

function isColorScheme(value: unknown): value is Exclude<ShellColorScheme, null> {
  return value === 'dark' || value === 'light'
}
