import path from 'node:path'

export function developmentNativeHost(desktopDir: string, platform = process.platform) {
  const build = path.join(desktopDir, 'native', 'build')
  if (platform === 'darwin')
    return path.join(build, 'Fregat Dev.app', 'Contents', 'MacOS', 'platform-webview')
  return path.join(build, 'platform-webview')
}
