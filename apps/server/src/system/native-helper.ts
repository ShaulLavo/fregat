import { existsSync } from 'node:fs'
import path from 'node:path'

const HELPER = 'platform-webview'

/** A release carries the helper beside its server bundle; a checkout has the desktop build's. */
export function defaultNativePickerHelper(): string | null {
  const candidates = [
    path.join(import.meta.dirname, 'native', HELPER),
    path.join(import.meta.dirname, '..', '..', '..', 'desktop', 'native', 'build', HELPER),
  ]
  return candidates.find((candidate) => existsSync(candidate)) ?? null
}

/** Linux needs a display the session exported to the user manager; launchd runs in the GUI domain. */
export function hasDesktopSession(env: NodeJS.ProcessEnv = process.env) {
  if (process.platform === 'darwin') return true
  return Boolean(env.WAYLAND_DISPLAY || env.DISPLAY)
}
