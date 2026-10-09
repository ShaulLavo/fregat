import {
  chmodSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import path from 'node:path'
import { buildNative, copyNativeHost } from './build-native'
import desktopPackage from '../package.json'
import { checkApp } from './check-app'
import {
  buildServer,
  buildWeb,
  readCheckout,
  writeBuildConfig,
  type Release,
} from '../../../scripts/deploy/release'
import { createScriptError } from '../../../scripts/structured-errors'
import { buildPromoterSource } from '../../../scripts/deploy/promoter-source'

const root = path.resolve(import.meta.dirname, '../../..')
const desktop = path.join(root, 'apps/desktop')

async function command(args: string[], cwd = root) {
  const child = Bun.spawn(args, { cwd, stdout: 'inherit', stderr: 'inherit' })
  const exitCode = await child.exited
  if (exitCode !== 0) throw createScriptError(`${args[0]} failed with exit ${exitCode}.`)
}

export async function buildApp(arch: 'arm64' | 'x64' = process.arch === 'arm64' ? 'arm64' : 'x64') {
  if (process.platform !== 'darwin')
    throw createScriptError('Fregat.app requires a macOS build host.')
  const output = path.join(desktop, 'build')
  mkdirSync(output, { recursive: true })
  const staging = mkdtempSync(path.join(output, '.app-'))
  const app = path.join(staging, 'Fregat.app')
  const contents = path.join(app, 'Contents')
  const macos = path.join(contents, 'MacOS')
  const resources = path.join(contents, 'Resources')
  const directory = path.join(resources, 'release')
  mkdirSync(macos, { recursive: true })
  mkdirSync(directory, { recursive: true })
  try {
    mkdirSync(path.join(directory, 'bin'), { recursive: true })
    writeFileSync(path.join(directory, 'bin/promote.js'), await buildPromoterSource())
    await command([
      'bun',
      'build',
      path.join(desktop, 'src/launcher/index.ts'),
      '--compile',
      '--target',
      `bun-darwin-${arch}`,
      '--outfile',
      path.join(macos, 'fregat'),
    ])
    const native = buildNative(desktop, arch)
    if (!native) throw createScriptError('The macOS native host was not built.')
    copyNativeHost(native, path.join(macos, 'platform-webview'))
    const checkout = await readCheckout(root)
    const release: Release = {
      name: `app-${checkout.commit.slice(0, 8)}`,
      directory,
      web: path.join(directory, 'web'),
      server: path.join(directory, 'server'),
      previous: null,
    }
    await buildWeb(release, '/')
    await buildServer(release, 'installed', arch)
    mkdirSync(path.join(release.server, 'native'), { recursive: true })
    copyNativeHost(
      path.join(macos, 'platform-webview'),
      path.join(release.server, 'native/platform-webview'),
    )
    writeBuildConfig(release, {
      ...checkout,
      release: release.name,
      source: '',
      webBase: '/',
      meshUrl: '',
      previousRelease: null,
      server: 'built',
      reason: null,
      builtAt: new Date().toISOString(),
      liveCheck: false,
    })
    await command(['bun', 'run', 'app-icon:generate'])
    copyFileSync(
      path.join(root, 'apps/web/public/icons/fregat.icns'),
      path.join(resources, 'Fregat.icns'),
    )
    writeFileSync(
      path.join(contents, 'Info.plist'),
      `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleIdentifier</key><string>dev.shaulavo.fregat</string>
<key>CFBundleExecutable</key><string>fregat</string>
<key>CFBundleName</key><string>Fregat</string>
<key>CFBundleDisplayName</key><string>Fregat</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>CFBundleVersion</key><string>${desktopPackage.version}</string>
<key>CFBundleShortVersionString</key><string>${desktopPackage.version}</string>
<key>CFBundleIconFile</key><string>Fregat.icns</string>
<key>LSUIElement</key><true/>
<key>NSHighResolutionCapable</key><true/>
<key>LSMinimumSystemVersion</key><string>11.0</string>
</dict></plist>
`,
    )
    chmodSync(path.join(macos, 'fregat'), 0o755)
    chmodSync(path.join(macos, 'platform-webview'), 0o755)
    checkApp(app)
    await command(['codesign', '--force', '--deep', '--sign', '-', app])
    await command(['codesign', '--verify', '--deep', '--strict', app])
    const destination = path.join(output, 'Fregat.app')
    rmSync(destination, { recursive: true, force: true })
    renameSync(app, destination)
    console.log(destination)
    return destination
  } finally {
    rmSync(staging, { recursive: true, force: true })
  }
}

if (import.meta.main) {
  const flag = process.argv.find((arg) => arg.startsWith('--arch='))?.slice('--arch='.length)
  if (flag !== undefined && flag !== 'arm64' && flag !== 'x64')
    throw createScriptError('Use --arch=arm64 or --arch=x64.')
  await buildApp(flag)
}
