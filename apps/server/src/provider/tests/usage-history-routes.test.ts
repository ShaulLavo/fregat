import { appendFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import * as v from 'valibot'
import {
  providerDriverKindSchema,
  providerInstanceIdSchema,
  providerUsageHistorySchema,
} from '@workspace/contracts'
import { afterEach, expect, test } from 'vitest'
import { createTestApp, closeTestApps } from '../../../test/server'
import { appUsageHistory } from '../../app'
import { testSettingsOptions } from '../../settings/testing'
import { nativeClaudeResponse } from '../../testing/transcript-usage'
import { mockDriver } from '../drivers/mock'
import { ProviderAdapterRegistry } from '../provider-adapter-registry'

const roots: string[] = []
const registries: ProviderAdapterRegistry[] = []
afterEach(async () => {
  await closeTestApps()
  await Promise.all(registries.splice(0).map((registry) => registry.dispose()))
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

test('real app history GET stays passive, picks up lifecycle refresh, and recovers cached transcripts on restart', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'usage-history-routes-'))
  roots.push(root)
  const home = path.join(root, 'claude-profile')
  const transcripts = path.join(home, 'projects', 'outside-fregat')
  await mkdir(transcripts, { recursive: true })
  const file = path.join(transcripts, 'native.jsonl')
  const event = nativeClaudeResponse('native-request-1')
  event.timestamp = new Date(Date.now() - 60_000).toISOString()
  await writeFile(file, JSON.stringify(event) + '\n')
  const instance = v.parse(providerInstanceIdSchema, 'history-profile')
  const registryOptions: ConstructorParameters<typeof ProviderAdapterRegistry>[0] = {
    services: { cwd: root },
    drivers: [
      {
        ...mockDriver,
        driverKind: v.parse(providerDriverKindSchema, 'claude'),
        environment: (config, id) => [
          ...mockDriver.environment(config, id),
          { name: 'CLAUDE_CONFIG_DIR', value: home },
        ],
      },
    ],
  }
  let registry = new ProviderAdapterRegistry(registryOptions)
  registries.push(registry)
  await registry.reconcile([
    {
      providerInstanceId: instance,
      driverKind: v.parse(providerDriverKindSchema, 'claude'),
      config: { credentialsPath: path.join(home, 'credentials.json') },
    },
  ])
  const options = {
    homeDirectory: root,
    workspaceRoot: root,
    systemRoot: root,
    settings: testSettingsOptions(root),
    themes: { root: path.join(root, 'themes') },
    orchestration: { providerRuntime: false, providerAdapterRegistry: registry },
    auth: { allowedOrigins: ['http://localhost:5173'] },
    watch: false,
  }
  let app = createTestApp(options)
  const read = async () => {
    const response = await app.handle(
      new Request('http://localhost/providers/usage/history?days=7&utcOffsetMinutes=0', {
        headers: { Origin: 'http://localhost:5173' },
      }),
    )
    expect(response.status).toBe(200)
    return v.parse(providerUsageHistorySchema, await response.json())
  }
  expect((await read()).totals.tokens).toBe(0)
  expect((await read()).coverage?.status).toBe('pending')
  await appUsageHistory(app).initialize()
  expect((await read()).totals.tokens).toBe(0)
  await appUsageHistory(app).refresh()
  const first = await read()
  expect(first.totals.tokens).toBe(120)
  expect(first.coverage?.sources[0]).toMatchObject({
    driverKind: 'claude',
    sourceKind: 'native-transcript',
    records: 1,
  })
  expect(JSON.stringify(first)).not.toContain(home)
  const next = nativeClaudeResponse('native-request-2')
  next.timestamp = event.timestamp
  await appendFile(file, JSON.stringify(next) + '\n')
  expect((await read()).totals.tokens).toBe(120)
  expect((await read()).coverage?.scannedAt).toBe(first.coverage?.scannedAt)
  await appUsageHistory(app).refresh()
  expect((await read()).totals.tokens).toBe(240)
  await closeTestApps()
  await rm(file)
  registry = new ProviderAdapterRegistry(registryOptions)
  registries.push(registry)
  await registry.reconcile([
    {
      providerInstanceId: instance,
      driverKind: v.parse(providerDriverKindSchema, 'claude'),
      config: { credentialsPath: path.join(home, 'credentials.json') },
    },
  ])
  app = createTestApp({
    ...options,
    orchestration: { ...options.orchestration, providerAdapterRegistry: registry },
  })
  await appUsageHistory(app).initialize()
  expect((await read()).totals.tokens).toBe(240)
})

test('transcript roots use the actual enabled native environments and deduplicate shared homes', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'usage-history-roots-'))
  roots.push(root)
  const registry = new ProviderAdapterRegistry({
    services: { cwd: root },
    drivers: [{ ...mockDriver, driverKind: v.parse(providerDriverKindSchema, 'codex') }],
  })
  registries.push(registry)
  const entry = (id: string, home: string, enabled = true) => ({
    providerInstanceId: v.parse(providerInstanceIdSchema, id),
    driverKind: v.parse(providerDriverKindSchema, 'codex'),
    config: { credentialsPath: path.join(home, 'auth.json') },
    environment: [{ name: 'CODEX_HOME', value: home }],
    enabled,
  })
  await registry.reconcile([
    entry('a', root),
    entry('b', root),
    entry('disabled', path.join(root, 'disabled'), false),
  ])
  const sources = registry.transcriptUsageSources()
  expect(sources).toEqual([
    {
      id: expect.any(String),
      driverKind: 'codex',
      roots: [path.join(root, 'sessions'), path.join(root, 'archived_sessions')],
    },
  ])
  expect(sources[0]!.id).not.toContain(root)
})
