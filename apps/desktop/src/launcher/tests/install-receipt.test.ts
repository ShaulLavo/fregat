import { expect, test } from 'vitest'
import { mkdtemp, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  hasVerifiedInstall,
  installReceipt,
  readInstallManifest,
  rememberVerifiedInstall,
} from '../install-receipt'
import { installedIdentity } from '../installed-app'

const manifest = JSON.stringify({ id: './', start_url: './', name: 'Fregat' })

test('a verified receipt requires the exact Chrome app resource tree and current manifest', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'fregat-receipt-'))
  const profile = path.join(root, 'chromium')
  await mkdir(profile)
  const receipt = installReceipt('http://localhost:123/platform/?subject=one', manifest)!
  const resources = path.join(
    profile,
    'Platform',
    'Web Applications',
    'Manifest Resources',
    installedIdentity(receipt.manifestId).appId,
  )
  try {
    expect(hasVerifiedInstall(profile, receipt)).toBe(false)
    rememberVerifiedInstall(profile, receipt)
    expect(hasVerifiedInstall(profile, receipt)).toBe(false)
    await mkdir(resources, { recursive: true })
    expect(hasVerifiedInstall(profile, receipt)).toBe(true)
    expect(
      hasVerifiedInstall(
        profile,
        installReceipt('http://localhost:123/platform/?subject=two', manifest),
      ),
    ).toBe(true)
    expect(
      hasVerifiedInstall(
        profile,
        installReceipt('http://localhost:123/platform/', manifest + '\n'),
      ),
    ).toBe(false)
    expect(
      hasVerifiedInstall(
        profile,
        installReceipt(
          'http://localhost:123/platform/',
          JSON.stringify({ id: './', start_url: './other', name: 'Fregat' }),
        ),
      ),
    ).toBe(false)
    expect(hasVerifiedInstall(profile, undefined)).toBe(false)
    await rm(resources, { recursive: true })
    expect(hasVerifiedInstall(profile, receipt)).toBe(false)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test.each([
  'invalid',
  '{}',
  JSON.stringify({ id: './other', start_url: './' }),
  JSON.stringify({ id: './', start_url: 'https://elsewhere.invalid/' }),
])('invalid manifest input cannot create an install receipt: %s', (input) => {
  expect(() => installReceipt('http://localhost:123/', input)).toThrow()
})

test('manifest bytes come from the current served base without browser cache', async () => {
  const requests: URL[] = []
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch(request) {
      requests.push(new URL(request.url))
      return new Response(manifest)
    },
  })
  try {
    expect(
      await readInstallManifest(
        `http://127.0.0.1:${server.port}/platform/?subject=one`,
        new AbortController().signal,
      ),
    ).toBe(manifest)
    expect(requests.map((url) => url.pathname)).toEqual(['/platform/manifest.webmanifest'])
  } finally {
    await server.stop(true)
  }
})
