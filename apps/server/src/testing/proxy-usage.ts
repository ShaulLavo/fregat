import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { expect } from 'vitest'
import { ProviderUsageStore } from '../provider/usage-store'
import { readProxyUsage } from '../provider/usage-proxy-source'

export const PROXY_USAGE_NOW = Date.parse('2026-10-03T12:00:00.000Z')
const NOW = PROXY_USAGE_NOW

export async function proxyUsageFixture(cleanup: Array<() => Promise<void>>) {
  const root = await mkdtemp(path.join(tmpdir(), 'usage-proxy-hourly-'))
  const stores: ProviderUsageStore[] = []
  cleanup.push(async () => {
    await Promise.all(stores.map((store) => store.close()))
    await rm(root, { recursive: true, force: true })
  })
  let now = NOW
  let source: string | null = 'http://127.0.0.1:18317'
  let secret = 'synthetic-management-secret'
  let files: Record<string, unknown>[] = [
    {
      id: 'synthetic-file',
      auth_index: 'synthetic-selector',
      provider: 'codex',
      status: 'active',
      id_token: { chatgpt_account_id: 'synthetic-account' },
    },
  ]
  let response: unknown = {
    plan_type: 'pro',
    rate_limit: {
      primary_window: {
        used_percent: 37,
        reset_at: NOW / 1000 + 3600,
        limit_window_seconds: 18000,
      },
      secondary_window: {
        used_percent: 61,
        reset_at: NOW / 1000 + 604800,
        limit_window_seconds: 604800,
      },
    },
  }
  let status = 200
  let beforeResponse: (() => Promise<void>) | undefined
  let intervalHours = 1
  let requests = 0
  let managementReads = 0
  const payloads: unknown[] = []
  const cacheFile = path.join(root, 'accounts.json')
  const makeStore = () => {
    const options = {
      cacheFile,
      now: () => now,
      policy: () => ({ minIntervalMs: 1, failureCooldownMs: 1, staleAfterMs: 900_000 }),
      proxySourceKey: () => source,
      proxyConfigured: () => source !== null,
      proxyRequestIntervalHours: () => intervalHours,
      readProxy: async (
        identityContext: string,
        refresh?: Parameters<typeof readProxyUsage>[0]['refresh'],
      ) =>
        readProxyUsage({
          url: source!,
          secret,
          identityContext,
          refresh,
          now: () => now,
          fetch: async (input, init) => {
            const pathname = new URL(String(input)).pathname
            expect(new Headers(init?.headers).get('Authorization')).toBe(`Bearer ${secret}`)
            expect(init?.redirect).toBe('error')
            if (pathname === '/v0/management/auth-files') {
              expect(init?.method).toBe('GET')
              managementReads += 1
              return Response.json({ files })
            }
            expect(pathname).toBe('/v0/management/api-call')
            expect(init?.method).toBe('POST')
            requests += 1
            payloads.push(JSON.parse(String(init?.body)))
            await beforeResponse?.()
            return Response.json({ status_code: status, body: JSON.stringify(response) })
          },
        }),
    }
    const store = new ProviderUsageStore(
      { listInstances: () => [], adapter: () => null, usageAccount: () => null },
      options,
    )
    stores.push(store)
    return store
  }
  const holdBudget = async (reserve: boolean) => {
    const moduleUrl = (file: string) =>
      JSON.stringify(pathToFileURL(path.resolve(import.meta.dirname, file)).href)
    const script = `
      import { readFileSync } from 'node:fs';
      import { createHash } from 'node:crypto';
      const { tryFileLock } = await import(${moduleUrl('../system/file-lock.ts')});
      const { CodexUsageRequestBudget } = await import(${moduleUrl('../provider/usage-proxy-budget.ts')});
      const { codexAccountIdentity } = await import(${moduleUrl('../provider/utils/usage-codex-identity.ts')});
      const [file, clock, reserve] = process.argv.slice(1);
      const context = readFileSync(file + '.identity', 'utf8');
      if (reserve === 'true') {
        const budget = new CodexUsageRequestBudget(file + '.codex-requests', () => Number(clock), () => 1, createHash('sha256').update(context).digest('hex'));
        if (!budget.reserve(codexAccountIdentity('synthetic-account', context), null)) process.exit(1);
      }
      if (!tryFileLock(file + '.codex-requests.lock')) process.exit(2);
      process.stdout.write('ready\\n');
      setInterval(() => {}, 1000);
    `
    const child = spawn(process.execPath, ['-e', script, cacheFile, String(now), String(reserve)], {
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    cleanup.push(async () => {
      if (child.exitCode !== null || child.signalCode !== null) return
      const exited = once(child, 'exit')
      child.kill('SIGKILL')
      await exited
    })
    const ready = await Promise.race([
      once(child.stdout, 'data').then(([chunk]) => String(chunk)),
      once(child, 'exit').then(() => 'exited'),
    ])
    expect(ready).toBe('ready\n')
    return child
  }
  return {
    makeStore,
    holdBudget,
    cacheFile,
    root,
    set intervalHours(value: number) {
      intervalHours = value
    },
    get requests() {
      return requests
    },
    get managementReads() {
      return managementReads
    },
    payloads,
    get files() {
      return files
    },
    set files(value: Record<string, unknown>[]) {
      files = value
    },
    set now(value: number) {
      now = value
    },
    set source(value: string | null) {
      source = value
    },
    set secret(value: string) {
      secret = value
    },
    set response(value: unknown) {
      response = value
    },
    set status(value: number) {
      status = value
    },
    set beforeResponse(value: (() => Promise<void>) | undefined) {
      beforeResponse = value
    },
  }
}
