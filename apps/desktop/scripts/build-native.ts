import { copyFileSync, cpSync, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { defineErrorCatalog } from 'evlog'
import { developmentNativeHost } from '../src/shared/native-path'

const buildErrors = defineErrorCatalog('desktop.native', {
  BUILD_FAILED: {
    message: 'The native desktop helper could not be built.',
    status: 500,
    why: 'The native helper needs its platform compiler and development libraries.',
    fix: 'Install Zig 0.17, pkg-config and webkit2gtk-4.1 on Linux, or Swift 6 and the Xcode command-line tools on macOS, then run build:native again.',
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
    linux ? 'linux/platform-webview.zig' : 'macos/PlatformWebview.swift',
  )
  const output = developmentNativeHost(desktopDir)
  if (!existsSync(source))
    throw buildErrors.BUILD_FAILED({ internal: { stage: 'source', platform: process.platform } })
  const compiler = linux ? 'zig' : 'swiftc'
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
    flags = new TextDecoder().decode(pkg.stdout).trim().split(/\s+/).map(zigFlag)
  }
  const args = linux
    ? []
    : [
        '-framework',
        'WebKit',
        '-framework',
        'UniformTypeIdentifiers',
        '-swift-version',
        '6',
        '-parse-as-library',
        '-target',
        `${(arch ?? process.arch) === 'x64' ? 'x86_64' : 'arm64'}-apple-macosx11.0`,
        '-framework',
        'Cocoa',
        '-Xlinker',
        '-rpath',
        '-Xlinker',
        '@executable_path/../Frameworks',
      ]
  mkdirSync(path.dirname(output), { recursive: true })
  const command = linux
    ? linuxCommand({ desktopDir, source, output, flags })
    : [compiler, ...args, '-O', '-warnings-as-errors', '-o', output, source]
  const result = Bun.spawnSync(command)
  if (result.exitCode !== 0) {
    process.stderr.write(result.stderr)
    throw buildErrors.BUILD_FAILED({ internal: { stage: 'compile', exitCode: result.exitCode } })
  }
  if (!linux) {
    const frameworks = path.join(path.dirname(path.dirname(output)), 'Frameworks')
    mkdirSync(frameworks, { recursive: true })
    const runtime = Bun.spawnSync([
      'xcrun',
      'swift-stdlib-tool',
      '--copy',
      '--platform',
      'macosx',
      '--scan-executable',
      output,
      '--destination',
      frameworks,
    ])
    if (runtime.exitCode !== 0) {
      process.stderr.write(runtime.stderr)
      throw buildErrors.BUILD_FAILED({
        internal: { stage: 'swift-runtime', exitCode: runtime.exitCode },
      })
    }
    writeDevelopmentBundle(desktopDir, output)
  }
  return output
}

export function copyNativeHost(binary: string, destination: string) {
  copyFileSync(binary, destination)
  if (process.platform !== 'darwin') return
  const source = path.join(path.dirname(path.dirname(binary)), 'Frameworks')
  const target = path.join(path.dirname(path.dirname(destination)), 'Frameworks')
  cpSync(source, target, { recursive: true })
}

/** pkg-config speaks the C compiler driver's dialect; Zig spells these two its own way. */
export function zigFlag(flag: string) {
  if (flag === '-pthread') return '-D_REENTRANT'
  if (flag === '-Wl,--export-dynamic') return '-rdynamic'
  return flag
}

function linuxCommand({
  desktopDir,
  source,
  output,
  flags,
}: {
  desktopDir: string
  source: string
  output: string
  flags: readonly string[]
}) {
  const version = Bun.spawnSync(['zig', 'version'])
  if (version.exitCode !== 0 || !version.stdout.toString().trim().startsWith('0.17.'))
    throw buildErrors.BUILD_FAILED({
      internal: { stage: 'zig-version', exitCode: version.exitCode },
    })
  const cache = ['--cache-dir', path.join(path.dirname(output), '.zig-cache')]
  const bindings = path.join(path.dirname(output), 'native.zig')
  const translated = Bun.spawnSync([
    'zig',
    'translate-c',
    path.join(desktopDir, 'native/linux/native.h'),
    '-lc',
    ...flags,
    ...cache,
  ])
  if (translated.exitCode !== 0) {
    process.stderr.write(translated.stderr)
    throw buildErrors.BUILD_FAILED({
      internal: { stage: 'translate-c', exitCode: translated.exitCode },
    })
  }
  writeFileSync(bindings, translated.stdout)
  return [
    'zig',
    'build-exe',
    '-O',
    'ReleaseSafe',
    '-lc',
    ...flags,
    '--dep',
    'native',
    `-Mroot=${source}`,
    `-Mnative=${bindings}`,
    ...cache,
    `-femit-bin=${output}`,
  ]
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
