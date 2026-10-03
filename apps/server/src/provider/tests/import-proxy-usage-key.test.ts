import { existsSync } from 'node:fs'
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { expect, test } from 'vitest'

const checkout = path.resolve(import.meta.dirname, '../../../../..')
const script = path.join(checkout, 'scripts/import-proxy-usage-key.ts')
const KEY = 'synthetic-management-key-for-import-tests'
const EXISTING_KEY = 'synthetic-existing-management-key'
const URL = 'http://127.0.0.1:18317'

type ImportCase = {
  name: string
  success: boolean
  key?: string | Uint8Array
  existingKey?: string
  url?: string | null
  instances?: readonly string[]
  noProviders?: boolean
}

const cases: ImportCase[] = [
  { name: 'first import and explicitly selected accounts', success: true },
  { name: 'same existing key', success: true, existingKey: KEY },
  { name: 'different existing key', success: false, existingKey: EXISTING_KEY },
  { name: 'empty key', success: false, key: '\n' },
  { name: 'multiline key', success: false, key: `${KEY}\nsecond-line\n` },
  { name: 'control character in key', success: false, key: `${KEY}\0\n` },
  { name: 'invalid UTF-8 key', success: false, key: new Uint8Array([0xff, 0xfe]) },
  { name: 'unknown instance', success: false, instances: ['missing-account'] },
  { name: 'non-Codex instance', success: false, instances: ['other-driver'] },
  { name: 'disabled Codex instance', success: false, instances: ['disabled-account'] },
  { name: 'duplicate selection', success: false, instances: ['codex-work', 'codex-work'] },
  { name: 'non-local URL', success: false, url: 'http://remote.example:18317' },
  { name: 'credential in URL', success: false, url: `http://${KEY}@127.0.0.1:18317` },
  { name: 'missing explicit URL', success: false, url: null },
  { name: 'optional mapping', success: true, instances: [] },
  { name: 'no configured providers or mapping', success: true, instances: [], noProviders: true },
]

test.for(cases)('proxy key CLI: $name', async (scenario) => {
  const root = await mkdtemp(path.join(tmpdir(), 'platform-proxy-key-import-'))
  const keyFile = path.join(root, 'management-key')
  const settingsFile = path.join(root, 'settings.json')
  const secretsFile = path.join(root, 'secrets.json')
  const input = scenario.key ?? `${KEY}\n`
  const settings = JSON.stringify({
    'providers.instances': scenario.noProviders
      ? []
      : [
          { providerInstanceId: 'codex-work', driverKind: 'codex' },
          { providerInstanceId: 'codex-personal', driverKind: 'codex' },
          { providerInstanceId: 'codex-unselected', driverKind: 'codex' },
          { providerInstanceId: 'disabled-account', driverKind: 'codex', enabled: false },
          { providerInstanceId: 'other-driver', driverKind: 'cursor' },
        ],
    'providers.proxyUsageUrl': 'http://127.0.0.1:11111',
    'providers.proxyUsageProviderInstanceIds': ['codex-unselected'],
  })
  const secrets = JSON.stringify({
    'push.vapid.privateKey': 'synthetic-unrelated-secret',
    ...(scenario.existingKey ? { 'usage.cliproxy.management': scenario.existingKey } : {}),
  })
  try {
    await writeFile(keyFile, input, { mode: 0o400 })
    await writeFile(settingsFile, settings)
    if (scenario.existingKey) await writeFile(secretsFile, secrets, { mode: 0o600 })
    const url = scenario.url === undefined ? URL : scenario.url
    const instances = scenario.instances ?? ['codex-work', 'codex-personal']
    const args = [
      keyFile,
      ...(url === null ? [] : ['--url', url]),
      ...instances.flatMap((id) => ['--instance', id]),
    ]
    const child = Bun.spawn([process.execPath, script, ...args], {
      cwd: checkout,
      env: { ...process.env, PLATFORM_HOME: root },
      stdout: 'pipe',
      stderr: 'pipe',
    })
    const [exit, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ])
    expect(stdout).toBe('')
    expect(stderr).not.toContain(KEY)
    expect(stderr).not.toContain(EXISTING_KEY)
    expect(await readFile(keyFile)).toEqual(Buffer.from(input))
    if (process.platform !== 'win32') expect((await stat(keyFile)).mode & 0o777).toBe(0o400)

    if (!scenario.success) {
      expect(exit).toBe(1)
      expect(stderr).toContain('Stop the Fregat server')
      expect(await readFile(settingsFile, 'utf8')).toBe(settings)
      const savedSecrets = existsSync(secretsFile) ? await readFile(secretsFile, 'utf8') : null
      expect(savedSecrets).toBe(scenario.existingKey ? secrets : null)
      return
    }
    expect(exit, stderr).toBe(0)
    expect(stderr).toBe('')
    const saved = JSON.parse(await readFile(settingsFile, 'utf8'))
    expect(saved['providers.proxyUsageUrl']).toBe(URL)
    expect(saved['providers.proxyUsageProviderInstanceIds'] ?? []).toEqual(instances)
    expect(saved['providers.instances']).toEqual(JSON.parse(settings)['providers.instances'])
    expect(await readFile(settingsFile, 'utf8')).not.toContain(KEY)
    const stored = JSON.parse(await readFile(secretsFile, 'utf8'))
    expect(stored['usage.cliproxy.management']).toBe(KEY)
    if (scenario.existingKey)
      expect(stored['push.vapid.privateKey']).toBe('synthetic-unrelated-secret')
    if (process.platform !== 'win32') expect((await stat(secretsFile)).mode & 0o777).toBe(0o600)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('proxy key CLI help documents the stopped-server prerequisite without reading a key', async () => {
  const child = Bun.spawn([process.execPath, script, '--help'], {
    cwd: checkout,
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const [exit, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ])
  expect(exit).toBe(0)
  expect(stdout).toBe('')
  expect(stderr).toContain('Stop the Fregat server')
  expect(stderr).toContain('--instance')
})

test.for([true, false])(
  'proxy key CLI lists enabled Codex IDs only (configured: %s)',
  async (configured) => {
    const root = await mkdtemp(path.join(tmpdir(), 'platform-proxy-key-list-'))
    const settingsFile = path.join(root, 'settings.json')
    const secretsFile = path.join(root, 'secrets.json')
    const settings = JSON.stringify({
      'providers.instances': configured
        ? [
            {
              providerInstanceId: 'codex-work',
              driverKind: 'codex',
              displayLabel: KEY,
              environment: [{ name: 'API_KEY', value: KEY }],
              config: { private: KEY },
            },
            { providerInstanceId: 'codex-disabled', driverKind: 'codex', enabled: false },
            { providerInstanceId: 'other-driver', driverKind: 'cursor' },
          ]
        : [],
    })
    const secrets = JSON.stringify({ 'usage.cliproxy.management': EXISTING_KEY })
    try {
      await writeFile(settingsFile, settings)
      await writeFile(secretsFile, secrets, { mode: 0o600 })
      const child = Bun.spawn([process.execPath, script, '--list-instances'], {
        cwd: checkout,
        env: { ...process.env, PLATFORM_HOME: root },
        stdout: 'pipe',
        stderr: 'pipe',
      })
      const [exit, stdout, stderr] = await Promise.all([
        child.exited,
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
      ])
      expect(exit, stderr).toBe(0)
      expect(stdout).toBe(`${JSON.stringify(configured ? ['codex-work'] : [])}\n`)
      expect(stdout + stderr).not.toContain(KEY)
      expect(stdout + stderr).not.toContain(EXISTING_KEY)
      expect(stderr).toBe('')
      expect(await readFile(settingsFile, 'utf8')).toBe(settings)
      expect(await readFile(secretsFile, 'utf8')).toBe(secrets)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  },
)
