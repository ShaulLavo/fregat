/** Options for the native folder chooser. */
export type PlatformPickOptions = {
  startingPath?: string
}

export type WindowAppearance = {
  readonly opacity: number
  readonly material: 'none' | 'frosted' | 'glass'
}

export type PlatformBridge = {
  // What is behind this window, so the web layer knows whether to draw a
  // wallpaper and a floor of its own. The shell reports what it actually
  // created, never what the setting currently says.
  capabilities?: { displayCapture?: boolean; windowGlass?: boolean }
  backdrop: 'app' | 'compositor' | 'transparent'
  platform: 'darwin' | 'linux' | 'win32'
  // The desktop's preference when the webview cannot be trusted to know it.
  colorScheme: 'dark' | 'light' | null
  titlebar: 'native' | 'overlay'
  pickEntry?(options: PlatformPickOptions): Promise<string[]>
  setWindowAppearance?(appearance: WindowAppearance): void
}

declare global {
  interface Window {
    platformBridge?: PlatformBridge
  }
}
