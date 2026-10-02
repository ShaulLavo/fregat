import { tmpdir } from 'node:os'
import path from 'node:path'
import { expect, test } from 'vitest'
import { appBundle } from '../bundle'
import { nativeHostBinary } from '../native-window'

test('derives the native host and release from the executable bundle', () => {
  const app = path.join(tmpdir(), 'Applications with spaces', 'Fregat.app')
  expect(appBundle(path.join(app, 'Contents/MacOS/fregat'))).toEqual({
    nativeHost: path.join(app, 'Contents/MacOS/platform-webview'),
    release: path.join(app, 'Contents/Resources/release'),
  })
})

test('bundle paths follow relocation', () => {
  const app = path.join(tmpdir(), 'Moved app', 'Renamed.app')
  expect(appBundle(path.join(app, 'Contents/MacOS/fregat'))?.release).toBe(
    path.join(app, 'Contents/Resources/release'),
  )
})

test.each([
  ['checkout', 'apps/desktop/src/launcher/index.ts'],
  ['not-app', 'Fregat/Contents/MacOS/fregat'],
  ['not-macos', 'Fregat.app/Contents/Resources/fregat'],
  ['not-contents', 'Fregat.app/Other/MacOS/fregat'],
  ['nested-executable', 'Fregat.app/Contents/MacOS/bin/fregat'],
])('returns null for %s', (_name, relative) => {
  expect(appBundle(path.join(tmpdir(), relative))).toBeNull()
})

test('returns null for a relative path', () => {
  expect(appBundle('Fregat.app/Contents/MacOS/fregat')).toBeNull()
})

test('the default path is the running executable', () => {
  expect(appBundle()).toEqual(appBundle(process.execPath))
})

test('native host selection prefers the app and falls back to the development checkout', () => {
  const original = process.execPath
  const root = path.join(tmpdir(), 'checkout')
  const app = path.join(tmpdir(), 'Fregat.app')
  try {
    process.execPath = path.join(app, 'Contents/MacOS/fregat')
    expect(nativeHostBinary(root)).toBe(path.join(app, 'Contents/MacOS/platform-webview'))
    process.execPath = path.join(tmpdir(), 'bin/bun')
    expect(nativeHostBinary(root)).toBe(
      path.join(root, 'apps/desktop/native/build/platform-webview'),
    )
  } finally {
    process.execPath = original
  }
})
