import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, expect, test } from 'vitest'
import { checkApp } from '../../../scripts/check-app'

const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleIdentifier</key><string>dev.shaulavo.fregat</string>
<key>CFBundleExecutable</key><string>fregat</string>
<key>CFBundleName</key><string>Fregat</string>
<key>LSUIElement</key><true/>
</dict></plist>`

const files = [
  'Contents/MacOS/fregat',
  'Contents/MacOS/platform-webview',
  'Contents/Resources/Fregat.icns',
  'Contents/Resources/release/build-config.json',
  'Contents/Resources/release/bin/promote.js',
  'Contents/Resources/release/web/index.html',
  'Contents/Resources/release/web/assets/editor.wasm',
  'Contents/Resources/release/server/index.js',
  'Contents/Resources/release/server/claude-discovery-worker.ts',
  'Contents/Resources/release/server/remote-support.js',
  'Contents/Resources/release/server/pair.js',
  'Contents/Resources/release/server/pty-host.js',
  'Contents/Resources/release/server/watch-worker.ts',
  'Contents/Resources/release/server/image-worker.ts',
  'Contents/Resources/release/server/THIRD_PARTY_NOTICES.txt',
  'Contents/Resources/release/server/runtime/package.json',
  'Contents/Resources/release/server/runtime/bun.lock',
]
let scratch: string
let app: string
let release: string

beforeEach(() => {
  scratch = mkdtempSync(path.join(tmpdir(), 'fregat-check-app-'))
  app = path.join(scratch, 'App with spaces', 'Fregat.app')
  release = path.join(app, 'Contents/Resources/release')
  for (const file of files) {
    const target = path.join(app, file)
    mkdirSync(path.dirname(target), { recursive: true })
    writeFileSync(target, '', { mode: 0o755 })
  }
  writeFileSync(path.join(app, 'Contents/Info.plist'), plist)
  mkdirSync(path.join(release, 'server/runtime/node_modules/pkg'), { recursive: true })
  writeFileSync(path.join(release, 'server/runtime/node_modules/pkg/index.js'), '')
  symlinkSync('runtime/node_modules', path.join(release, 'server/node_modules'), 'dir')
  symlinkSync('server/runtime/node_modules', path.join(release, 'node_modules'), 'dir')
})

afterEach(() => {
  rmSync(scratch, { recursive: true, force: true })
})

test('accepts the assembled app and its relative runtime links after relocation', () => {
  expect(() => checkApp(app)).not.toThrow()
  const moved = path.join(scratch, 'Moved Fregat.app')
  renameSync(app, moved)
  expect(() => checkApp(moved)).not.toThrow()
})

test.each(['node:fs', 'fs', 'path', 'child_process', 'bun', 'bun:sqlite'])(
  'accepts promotion import %s',
  (name) => {
    writeFileSync(path.join(release, 'bin/promote.js'), `import ${JSON.stringify(name)};`)
    expect(() => checkApp(app)).not.toThrow()
  },
)

test.each(['../../../../external.ts', 'external-package', path.join(tmpdir(), 'external.js')])(
  'rejects external promotion import %s',
  (name) => {
    writeFileSync(path.join(release, 'bin/promote.js'), `import ${JSON.stringify(name)};`)
    expect(() => checkApp(app)).toThrow('bin/promote.js must be self-contained')
  },
)

test.each([
  ['require', 'require("external-package");'],
  ['dynamic import', 'import("../../../../external.ts");'],
])('rejects external promotion %s', (_kind, source) => {
  writeFileSync(path.join(release, 'bin/promote.js'), source)
  expect(() => checkApp(app)).toThrow('bin/promote.js must be self-contained')
})

test.each(files)('rejects missing %s', (file) => {
  rmSync(path.join(app, file))
  expect(() => checkApp(app)).toThrow()
})

test('reports a missing prerequisite as a structured script error', () => {
  rmSync(path.join(app, 'Contents/MacOS/fregat'))
  try {
    checkApp(app)
    expect.fail('Expected app verification to fail')
  } catch (error) {
    expect(error).toMatchObject({ code: 'scripts.INVALID_INPUT', status: 400 })
  }
})

test.each(['Contents/MacOS/fregat', 'Contents/MacOS/platform-webview'])(
  'rejects non-executable %s',
  (file) => {
    chmodSync(path.join(app, file), 0o644)
    expect(() => checkApp(app)).toThrow('must be executable')
  },
)

test('rejects a directory in place of a required file', () => {
  const icon = path.join(app, 'Contents/Resources/Fregat.icns')
  rmSync(icon)
  mkdirSync(icon)
  expect(() => checkApp(app)).toThrow('must be a file')
})

test('rejects a file in place of runtime dependencies', () => {
  const dependencies = path.join(release, 'server/runtime/node_modules')
  rmSync(dependencies, { recursive: true })
  writeFileSync(dependencies, '')
  expect(() => checkApp(app)).toThrow('must be a directory')
})

test.each([
  ['identifier', plist.replace('dev.shaulavo.fregat', 'dev.example.other')],
  ['executable', plist.replace('<string>fregat</string>', '<string>other</string>')],
  ['agent policy', plist.replace('<true/>', '<false/>')],
  ['string agent policy', plist.replace('<true/>', '<string>true</string>')],
  ['duplicate agent policy', plist.replace('</dict>', '<key>LSUIElement</key><false/></dict>')],
  [
    'commented identity',
    plist.replace(
      '<key>CFBundleIdentifier</key><string>dev.shaulavo.fregat</string>',
      '<!-- <key>CFBundleIdentifier</key><string>dev.shaulavo.fregat</string> -->',
    ),
  ],
  ['malformed XML', plist.replace('</dict>', '')],
])('rejects invalid plist %s', (_name, xml) => {
  writeFileSync(path.join(app, 'Contents/Info.plist'), xml)
  expect(() => checkApp(app)).toThrow('Info.plist')
})

test('rejects a relative link to an existing file outside the app', () => {
  writeFileSync(path.join(scratch, 'outside'), '')
  symlinkSync(path.relative(app, path.join(scratch, 'outside')), path.join(app, 'escape'))
  expect(() => checkApp(app)).toThrow('escapes the app')
})

test('rejects absolute links even when the target is inside the app', () => {
  symlinkSync(path.join(release, 'server/index.js'), path.join(app, 'absolute'))
  expect(() => checkApp(app)).toThrow('Absolute symlink')
})

test('rejects dangling links in nested dependency directories', () => {
  symlinkSync('missing', path.join(release, 'server/runtime/node_modules/pkg/dangling'))
  expect(() => checkApp(app)).toThrow()
})

test('rejects a dangling relative link outside the app', () => {
  symlinkSync(path.relative(app, path.join(scratch, 'missing')), path.join(app, 'escape'))
  expect(() => checkApp(app)).toThrow('escapes the app')
})

test('rejects cyclic relative links', () => {
  symlinkSync('second', path.join(app, 'first'))
  symlinkSync('first', path.join(app, 'second'))
  expect(() => checkApp(app)).toThrow('cyclic or too deep')
})

test('accepts chained directory links contained in the app', () => {
  symlinkSync('Contents/Resources/release/node_modules', path.join(app, 'packages'), 'dir')
  symlinkSync('packages/pkg/index.js', path.join(app, 'entry'))
  expect(() => checkApp(app)).not.toThrow()
})

test('rejects traversal through a symlinked directory followed by parent components', () => {
  symlinkSync(
    'Contents/Resources/release/server/runtime/node_modules',
    path.join(app, 'packages'),
    'dir',
  )
  symlinkSync('packages/../../../../../../../../outside', path.join(app, 'escape'))
  writeFileSync(path.join(scratch, 'outside'), '')
  expect(() => checkApp(app)).toThrow('escapes the app')
})

test('rejects an absolute intermediate directory link', () => {
  symlinkSync(path.join(release, 'node_modules'), path.join(app, 'packages'), 'dir')
  symlinkSync('packages/pkg/index.js', path.join(app, 'entry'))
  expect(() => checkApp(app)).toThrow('Absolute symlink')
})

test.skipIf(typeof Bun === 'undefined')('CLI checks the supplied path and reports failures', () => {
  const script = path.resolve(import.meta.dirname, '../../../scripts/check-app.ts')
  const valid = Bun.spawnSync([process.execPath, script, app])
  expect(valid.exitCode).toBe(0)
  expect(valid.stdout.toString()).toContain('App bundle verified.')
  const missing = Bun.spawnSync([process.execPath, script])
  expect(missing.exitCode).toBe(1)
  expect(missing.stderr.toString()).toContain('Pass the path to Fregat.app.')
  rmSync(path.join(app, 'Contents/Info.plist'))
  const invalid = Bun.spawnSync([process.execPath, script, app])
  expect(invalid.exitCode).toBe(1)
  expect(invalid.stderr.toString()).toContain('Fix:')
})
