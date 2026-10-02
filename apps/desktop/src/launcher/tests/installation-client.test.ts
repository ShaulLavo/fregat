import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import * as v from 'valibot'
import { afterEach, expect, test } from 'vitest'
import { serverIdentitySchema, type MachineServiceIntent } from '@workspace/contracts'
import { ensureInstalledService, installationIntent } from '../installation-client'

const homes: string[] = []
afterEach(() => {
  for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true })
})
function fixture() {
  const home = mkdtempSync(path.join(tmpdir(), 'fregat-installation-'))
  homes.push(home)
  const intent = installationIntent(home)
  const identity = v.parse(serverIdentitySchema, {
    product: 'fregat',
    protocolVersion: 1,
    machineId: 'a'.repeat(32),
    environmentId: '11111111-1111-4111-8111-111111111111',
    stateHome: intent.stateHome,
    address: intent.address,
    webBase: intent.webBase,
    service: { kind: 'systemd-socket', registrationId: 'fregat-fixture.service' },
  })
  return { home, intent, identity, signal: new AbortController().signal }
}

test('setup passes the exact installation intent and consumes verified U3 identity before registration', async () => {
  const box = fixture()
  let passed: MachineServiceIntent | undefined
  const result = await ensureInstalledService({
    intent: box.intent,
    productionRoot: path.join(box.home, 'release'),
    signal: box.signal,
    ensure: async (intent, options) => {
      passed = intent
      expect(options.signal).toBe(box.signal)
      expect(options.productionRoot).toBe(path.join(box.home, 'release'))
      return { identity: box.identity, disposition: 'reused' }
    },
  })
  expect(passed).toEqual(box.intent)
  expect(result.url).toBe('http://127.0.0.1:3301/')
  expect(installationIntent(box.home).expected).toEqual({
    machineId: box.identity.machineId,
    environmentId: box.identity.environmentId,
  })
  expect(
    JSON.parse(readFileSync(path.join(box.home, 'desktop', 'installation.json'), 'utf8')).address,
  ).toBe(box.intent.address)
})

test.each(['stateHome', 'address', 'webBase', 'protocolVersion'] as const)(
  'rejects a mismatched %s before writing an install identity',
  async (field) => {
    const box = fixture()
    const changed = {
      stateHome: path.join(box.home, 'other'),
      address: 'http://127.0.0.1:1234',
      webBase: '/other/',
      protocolVersion: 2,
    }
    await expect(
      ensureInstalledService({
        intent: box.intent,
        productionRoot: box.home,
        signal: box.signal,
        ensure: async () => ({
          identity: { ...box.identity, [field]: changed[field] },
          disposition: 'reused',
        }),
      }),
    ).rejects.toMatchObject({ code: 'desktop.installation.IDENTITY_CONFLICT' })
    expect(installationIntent(box.home).expected).toBeNull()
  },
)

test('persisted machine and state identity reject a replaced service', async () => {
  const box = fixture()
  await ensureInstalledService({
    intent: box.intent,
    productionRoot: box.home,
    signal: box.signal,
    ensure: async () => ({ identity: box.identity, disposition: 'registered' }),
  })
  await expect(
    ensureInstalledService({
      intent: installationIntent(box.home),
      productionRoot: box.home,
      signal: box.signal,
      ensure: async () => ({
        identity: {
          ...box.identity,
          environmentId: v.parse(serverIdentitySchema, {
            ...box.identity,
            environmentId: '22222222-2222-4222-8222-222222222222',
          }).environmentId,
        },
        disposition: 'reused',
      }),
    }),
  ).rejects.toMatchObject({ code: 'desktop.installation.IDENTITY_CONFLICT' })
})

test('changed configured endpoint requires explicit installation review', async () => {
  const box = fixture()
  await ensureInstalledService({
    intent: box.intent,
    productionRoot: box.home,
    signal: box.signal,
    ensure: async () => ({ identity: box.identity, disposition: 'reused' }),
  })
  writeFileSync(
    path.join(box.home, 'settings.json'),
    JSON.stringify({ 'server.address': 'http://127.0.0.1:1234' }),
  )
  expect(() => installationIntent(box.home)).toThrow('machine service identity')
})

test('missing release root cannot claim installed success', async () => {
  const box = fixture()
  await expect(
    ensureInstalledService({ intent: box.intent, productionRoot: undefined, signal: box.signal }),
  ).rejects.toMatchObject({
    code: 'desktop.installation.SERVICE_UNAVAILABLE',
    internal: { stage: 'release-root' },
  })
})
