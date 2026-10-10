import { openFileReadSession } from '@workspace/client-core/files/read-session'
import { readFilePreview } from '@workspace/client-core/files/read'
import { createHash } from 'node:crypto'
import { access, readFile, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { WorkspaceSearchProviderSource, WorkspaceSearchQuery } from '@workspace/contracts'
import { fetchQuickOpenFiles } from '@/lib/file-server'
import { filesystemPath } from '@/lib/documents/utils/identity'
import { createClientInvariantError } from '@/lib/structured-errors'
import {
  collectWorkspaceSearch,
  type WorkspaceSearchResult,
} from '@workspace/client-core/files/search-client'
import type { Client } from '@workspace/client-core/transport/client'
import { onTestFinished } from 'vitest'
import { streamWorkspaceEvents } from '@/features/workspace/state/event-stream'
import { expect, test } from '../fixtures'
import { runGit } from '../factories/git'
import { makeTestServer } from '../server'

// Proves the phase-2 foundation: a real server, driven in-process through the
// typed eden client, against a real filesystem. No MSW, no mock.module.
test('health reports the real workspace root', async ({ client, server }) => {
  const { data, status } = await client.health.get()

  expect(status).toBe(200)
  expect(data).toMatchObject({ ok: true, workspaceRoot: server.root })
})

test('persists usage outside a clean Git workspace across restart', async ({ client, server }) => {
  runGit(server.root, ['init', '-b', 'main'], { cwdMode: 'option' })
  const usage = await client.providers.usage.get()
  expect(usage.status).toBe(200)
  expect(usage.data?.accounts).toHaveLength(1)
  // Pending reset state is projected by the route from attempts stored in the database.
  const { resetPending, ...configuredAccount } = usage.data!.accounts[0]!
  expect(resetPending).toBe(false)
  expect(configuredAccount).toMatchObject({
    driverKind: 'codex',
    providerInstanceIds: [server.providerAdapter.adapterKey],
    source: 'unknown',
    state: 'no-data',
    windows: [],
    checkedAt: null,
    resetCredits: null,
  })
  const identityFile = path.join(server.stateHome, 'usage', 'accounts.json.identity')
  const identityContext = await readFile(identityFile, 'utf8')
  expect(identityContext).toMatch(/^[a-f0-9]{64}$/)
  const identityFileStat = await stat(identityFile)
  expect(identityFileStat.isFile()).toBe(true)
  // Windows reports synthesized mode bits; POSIX hosts enforce the private file mode.
  if (process.platform !== 'win32') expect(identityFileStat.mode & 0o777).toBe(0o600)
  const identityContextHash = createHash('sha256').update(identityContext).digest('hex')
  expect(JSON.stringify(usage.data)).not.toContain(identityContext)
  expect(JSON.stringify(usage.data)).not.toMatch(
    /identityProof|identityContextHash|proxyIdentityProofs|proxyProofsCurrent/,
  )
  // Closing the app flushes the fixture collector's configured account before restart.
  await server.restart()
  expect(await readFile(identityFile, 'utf8')).toBe(identityContext)
  const cache = JSON.parse(
    await readFile(path.join(server.stateHome, 'usage', 'accounts.json'), 'utf8'),
  )
  expect(cache).toEqual({
    version: 1,
    accounts: [
      {
        snapshot: configuredAccount,
        attemptedAt: expect.any(Number),
        credentialFingerprint: null,
        identityProof: null,
        failed: false,
        unsupported: false,
      },
    ],
    proxyAccounts: [],
    proxyAttemptedAt: null,
    proxyFailed: false,
    proxySourceKey: null,
    identityContextHash,
    proxyIdentityProofs: {},
    proxyProofsCurrent: false,
  })
  expect(JSON.stringify(cache)).not.toContain(identityContext)
  const restartedUsage = await client.providers.usage.get()
  expect(restartedUsage.status).toBe(200)
  expect(restartedUsage.data).toEqual(usage.data)
  expect(JSON.stringify(restartedUsage.data)).not.toContain(identityContextHash)
  const clean = await client.git.status.get({ query: { path: '', fresh: true } })
  expect(clean.status).toBe(200)
  expect(clean.data?.files).toEqual([])

  await writeFile(path.join(server.root, 'workspace-owned.txt'), 'untracked\n')
  const changed = await client.git.status.get({ query: { path: '', fresh: true } })
  expect(changed.status).toBe(200)
  expect(changed.data?.files).toMatchObject([
    { path: 'workspace-owned.txt', index: 'untracked', worktree: 'untracked' },
  ])
})

test('cleans its workspace and owned state home', async () => {
  const server = await makeTestServer()
  try {
    await server.restart()
    await access(server.root)
    await access(path.join(server.stateHome, 'usage', 'accounts.json'))
  } finally {
    await server.cleanup()
  }
  await expect(access(server.root)).rejects.toMatchObject({ code: 'ENOENT' })
  await expect(access(server.stateHome)).rejects.toMatchObject({ code: 'ENOENT' })
})

test('reads a file written to the real workspace', async ({ client, server }) => {
  await writeFile(path.join(server.root, 'hello.ts'), 'export const greeting = "hi"\n')

  const data = await readFilePreview({
    client,
    path: 'hello.ts',
    signal: new AbortController().signal,
  })
  expect(JSON.stringify(data)).toContain('export const greeting')
})

test('reads raw ranges and invalidates a changed file through the client adapter', async ({
  client,
  server,
}) => {
  await writeFile(path.join(server.root, 'range.txt'), '\uFEFFfirst\nsecond')
  const source = await openFileReadSession({
    client,
    path: 'range.txt',
    signal: new AbortController().signal,
  })
  try {
    const page = await source.readBytes(0, 8, new AbortController().signal)
    expect(page.revision).toBe(source.revision)
    expect(Array.from(page.bytes)).toEqual(Array.from(new TextEncoder().encode('\uFEFFfirst')))
    await writeFile(path.join(server.root, 'range.txt'), 'changed')
    await expect(source.readBytes(0, 4, new AbortController().signal)).rejects.toMatchObject({
      code: 'FILE_CHANGED',
    })
  } finally {
    await source.dispose()
  }
  await expect(source.readBytes(0, 1, new AbortController().signal)).rejects.toMatchObject({
    code: 'READ_SESSION_EXPIRED',
  })
})

test('quick-open file search reuses the workspace search index', async ({ client }) => {
  // A project event stream holds its root's index, as the app's does while the root is open.
  // Without one there is no index to reuse and names correctly fall back to fd.
  const stream = new AbortController()
  onTestFinished(() => stream.abort())
  const ready = Promise.withResolvers<void>()
  streamWorkspaceEvents(client, '', stream.signal, (message) => {
    if (message.type === 'ready') ready.resolve()
  }).catch(() => undefined)
  await ready.promise
  await client.fs['create-folder'].post({ path: 'src', recursive: true })
  await client.fs['create-file'].post({
    content: 'export const commandPalette = true\n',
    path: 'src/command-palette.ts',
  })

  const query = quickOpenSearchQuery('command-palette')
  const indexed = await waitForSearchProvider({ client, query, source: 'index' })
  const matches = await fetchQuickOpenFiles(
    {
      path: filesystemPath(''),
      query: query.query,
      signal: new AbortController().signal,
    },
    client,
  )

  expect(indexed.measurement?.providerSources).toEqual(['index'])
  expect(matches).toContainEqual(
    expect.objectContaining({
      kind: 'name',
      path: 'src/command-palette.ts',
    }),
  )
})

test('rejects requests from an untrusted origin', async ({ server }) => {
  const response = await server.app.handle(
    new Request('http://localhost:5173/health', { headers: { origin: 'http://evil.test' } }),
  )

  expect(response.status).toBe(403)
})

function quickOpenSearchQuery(query: string): WorkspaceSearchQuery {
  return {
    caseSensitive: false,
    entryType: 'file',
    includeContent: false,
    includeNames: true,
    limit: 200,
    matchMode: 'fuzzy',
    path: '',
    query,
    wholeWord: false,
  }
}

async function waitForSearchProvider({
  client,
  query,
  source,
}: {
  readonly client: Client
  readonly query: WorkspaceSearchQuery
  readonly source: WorkspaceSearchProviderSource
}) {
  let latest: WorkspaceSearchResult | null = null

  for (let attempt = 0; attempt < 25; attempt += 1) {
    latest = await collectWorkspaceSearch(query, undefined, client)
    if (latest.measurement?.providerSources.includes(source)) return latest

    await wait(20)
  }

  throw createClientInvariantError(
    `Expected workspace search provider ${source}, got ${latestProviders(latest)}`,
  )
}

function latestProviders(result: WorkspaceSearchResult | null) {
  return result?.measurement?.providerSources.join(', ') || 'none'
}

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
