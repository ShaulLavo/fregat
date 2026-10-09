import { copyFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { defineErrorCatalog } from 'evlog'
import { developmentNativeHost } from '../src/shared/native-path'

const buildErrors = defineErrorCatalog('desktop.native', {
  BUILD_FAILED: {
    message: 'The native desktop helper could not be built.',
    status: 500,
    why: 'The native helper needs a C compiler and the platform development libraries.',
    fix: 'Install cc, pkg-config and webkit2gtk-4.1 on Linux, or the Xcode command-line tools on macOS, then run build:native again.',
  },
})

export function buildNative(
  desktopDir = path.join(import.meta.dirname, '..'),
  arch?: 'arm64' | 'x64',
) {
  if (process.platform !== 'linux' && process.platform !== 'darwin') return null
  const linux = process.platform === 'linux'
  const source = path.join(
    desktopDir,
    'native',
    linux ? 'linux/platform-webview.c' : 'macos/platform-webview.m',
  )
  const output = developmentNativeHost(desktopDir)
  if (!existsSync(source))
    throw buildErrors.BUILD_FAILED({ internal: { stage: 'source', platform: process.platform } })
  const compiler = linux ? 'cc' : 'clang'
  if (!Bun.which(compiler))
    throw buildErrors.BUILD_FAILED({ internal: { stage: 'compiler', compiler } })
  let flags: string[] = []
  if (linux) {
    if (!Bun.which('pkg-config'))
      throw buildErrors.BUILD_FAILED({ internal: { stage: 'pkg-config' } })
    const pkg = Bun.spawnSync(['pkg-config', '--cflags', '--libs', 'webkit2gtk-4.1'])
    if (pkg.exitCode !== 0)
      throw buildErrors.BUILD_FAILED({
        internal: { stage: 'webkit2gtk-4.1', exitCode: pkg.exitCode },
      })
    flags = new TextDecoder().decode(pkg.stdout).trim().split(/\s+/)
  }
  const args = linux
    ? []
    : [
        '-framework',
        'WebKit',
        ...(arch ? ['-arch', arch === 'x64' ? 'x86_64' : arch] : []),
        '-fobjc-arc',
        '-mmacosx-version-min=11.0',
        '-framework',
        'Cocoa',
      ]
  mkdirSync(path.dirname(output), { recursive: true })
  const result = Bun.spawnSync([compiler, ...args, '-O2', '-o', output, source, ...flags])
  if (result.exitCode !== 0) {
    process.stderr.write(result.stderr)
    throw buildErrors.BUILD_FAILED({ internal: { stage: 'compile', exitCode: result.exitCode } })
  }
  if (!linux) writeDevelopmentBundle(desktopDir, output)
  return output
}

function writeDevelopmentBundle(desktopDir: string, binary: string) {
  const contents = path.dirname(path.dirname(binary))
  const resources = path.join(contents, 'Resources')
  mkdirSync(resources, { recursive: true })
  copyFileSync(
    path.join(desktopDir, '../web/public/icons/fregat.icns'),
    path.join(resources, 'Fregat.icns'),
  )
  writeFileSync(
    path.join(contents, 'Info.plist'),
    `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleIdentifier</key><string>dev.shaulavo.fregat.dev</string>
<key>CFBundleExecutable</key><string>platform-webview</string>
<key>CFBundleName</key><string>Fregat Dev</string>
<key>CFBundleDisplayName</key><string>Fregat Dev</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>CFBundleIconFile</key><string>Fregat.icns</string>
<key>CFBundleVersion</key><string>1</string>
<key>NSHighResolutionCapable</key><true/>
<key>LSMinimumSystemVersion</key><string>11.0</string>
</dict></plist>
`,
  )
}

if (import.meta.main) {
  const output = buildNative()
  if (output) console.log(`[native] built ${output}`)
}
