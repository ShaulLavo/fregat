import path from 'node:path'

export function appBundle(
  execPath = process.execPath,
): { nativeHost: string; release: string } | null {
  if (!path.isAbsolute(execPath)) return null
  const macos = path.dirname(execPath)
  const contents = path.dirname(macos)
  const app = path.dirname(contents)
  if (path.basename(macos) !== 'MacOS' || path.basename(contents) !== 'Contents') return null
  if (!path.basename(app).endsWith('.app')) return null
  return {
    nativeHost: path.join(macos, 'platform-webview'),
    release: path.join(contents, 'Resources', 'release'),
  }
}
