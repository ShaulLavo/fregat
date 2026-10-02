import type { ShellBackdrop, ShellColorScheme, ShellPlatform } from './window'

export type PlatformPickOptions = {
  mode: 'folder' | 'file'
  accept?: readonly string[]
  startingPath?: string
  multiple?: boolean
}

export type PlatformBridge = {
  // What is behind this window, so the web layer knows whether to draw a
  // wallpaper and a floor of its own. The shell reports what it actually
  // created, never what the setting currently says.
  capabilities?: { displayCapture?: boolean }
  backdrop: ShellBackdrop
  platform: ShellPlatform
  // The desktop's preference when the webview cannot be trusted to know it.
  colorScheme: ShellColorScheme
  titlebar: 'native' | 'overlay'
  pickEntry?(options: PlatformPickOptions): Promise<string[]>
  setSurfaceOpacity?(opacity: number): void
}
