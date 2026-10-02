import { getPlatformBridge } from '@/lib/platform/bridge'

export type DisplayMode =
  | 'browser'
  | 'standalone'
  | 'window-controls-overlay'
  | 'minimal-ui'
  | 'fullscreen'

type ClientPlatform = {
  readonly userAgentData?: { readonly platform?: string }
  readonly userAgent: string
}

export function browserPlatform(
  client: ClientPlatform = navigator,
): 'darwin' | 'linux' | 'win32' | 'other' {
  const hint = client.userAgentData?.platform
  if (hint === 'macOS') return 'darwin'
  if (hint === 'Windows') return 'win32'
  if (hint === 'Linux') return 'linux'
  if (/android|iphone|ipad/i.test(client.userAgent)) return 'other'
  if (/macintosh|mac os x/i.test(client.userAgent)) return 'darwin'
  if (/windows/i.test(client.userAgent)) return 'win32'
  if (/linux|bsd/i.test(client.userAgent)) return 'linux'
  return 'other'
}

export function displayMode(): DisplayMode {
  if (typeof window === 'undefined') return 'browser'
  const modes: readonly DisplayMode[] = [
    'window-controls-overlay',
    'standalone',
    'minimal-ui',
    'fullscreen',
  ]
  for (const mode of modes) {
    if (window.matchMedia(`(display-mode: ${mode})`).matches) return mode
  }
  return 'browser'
}

export function runtimeCapabilities() {
  const mode = displayMode()
  const host = getPlatformBridge()
  return {
    displayMode: mode,
    installed: mode === 'standalone' || mode === 'window-controls-overlay' || mode === 'minimal-ui',
    nativeHost: host !== null,
    nativeTransparency: host?.backdrop === 'transparent' || host?.backdrop === 'compositor',
    windowControlsOverlay:
      typeof navigator !== 'undefined' && navigator.windowControlsOverlay?.visible === true,
    displayCapture:
      typeof navigator !== 'undefined' && displayCaptureSupported(navigator.mediaDevices),
  }
}

export function displayCaptureSupported(mediaDevices: MediaDevices | undefined): boolean {
  return (
    getPlatformBridge()?.capabilities?.displayCapture !== false &&
    typeof mediaDevices?.getDisplayMedia === 'function'
  )
}
