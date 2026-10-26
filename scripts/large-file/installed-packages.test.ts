import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { expect, test } from 'vitest'
import {
  installedDependencyFingerprint,
  installedPackageFingerprint,
} from '../../apps/web/scripts/installed-packages.mjs'

test('fingerprints installed editor and terminal releases without producer checkouts', () => {
  const editor = installedDependencyFingerprint('@singapore-editor/')
  expect(editor.packages.length).toBeGreaterThan(0)
  expect(editor.sha256).toMatch(/^[a-f0-9]{64}$/)
  for (const pkg of editor.packages) {
    expect(pkg.name).toMatch(/^@singapore-editor\//)
    expect(pkg.version).toMatch(/^\d+\.\d+\.\d+/)
    expect(pkg.sha256).toMatch(/^[a-f0-9]{64}$/)
  }
  expect(installedPackageFingerprint('ghostty-webgpu')).toMatchObject({
    name: 'ghostty-webgpu',
    sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
  })
})

test('package identity covers worker and wasm assets and excludes dependency links', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'installed-package-fingerprint-'))
  try {
    const manifest = path.join(directory, 'package.json')
    const pkg = path.join(directory, 'node_modules/provenance-fixture')
    mkdirSync(path.join(pkg, 'dist'), { recursive: true })
    mkdirSync(path.join(pkg, 'node_modules'), { recursive: true })
    writeFileSync(manifest, JSON.stringify({ dependencies: { 'provenance-fixture': '1.0.0' } }))
    writeFileSync(
      path.join(pkg, 'package.json'),
      JSON.stringify({ name: 'provenance-fixture', version: '1.0.0', main: 'dist/index.js' }),
    )
    writeFileSync(path.join(pkg, 'dist/index.js'), 'export const value = 1')
    writeFileSync(path.join(pkg, 'dist/worker.js'), 'worker')
    writeFileSync(path.join(pkg, 'engine.wasm'), 'wasm')
    const before = installedPackageFingerprint('provenance-fixture', manifest)
    writeFileSync(path.join(pkg, 'node_modules/ignored.txt'), 'dependency')
    expect(installedPackageFingerprint('provenance-fixture', manifest)).toEqual(before)
    writeFileSync(path.join(pkg, 'engine.wasm'), 'changed wasm')
    const changedWasm = installedPackageFingerprint('provenance-fixture', manifest)
    expect(changedWasm.sha256).not.toBe(before.sha256)
    writeFileSync(path.join(pkg, 'dist/worker.js'), 'changed worker')
    expect(installedPackageFingerprint('provenance-fixture', manifest).sha256).not.toBe(
      changedWasm.sha256,
    )
  } finally {
    rmSync(directory, { force: true, recursive: true })
  }
})
