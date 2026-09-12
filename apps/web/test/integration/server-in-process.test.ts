import { writeFile } from 'node:fs/promises'
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
import { expect, test } from '../fixtures'

// Proves the phase-2 foundation: a real server, driven in-process through the
// typed eden client, against a real filesystem. No MSW, no mock.module.
test('health reports the real workspace root', async ({ client, server }) => {
  const { data, status } = await client.health.get()

  expect(status).toBe(200)
  expect(data).toMatchObject({ ok: true, workspaceRoot: server.root })
})

test('reads a file written to the real workspace', async ({ client, server }) => {
  await writeFile(path.join(server.root, 'hello.ts'), 'export const greeting = "hi"\n')

  const { data, status } = await client.fs.read.get({ query: { path: 'hello.ts' } })

  expect(status).toBe(200)
  expect(JSON.stringify(data)).toContain('export const greeting')
})

test('quick-open file search reuses the workspace search index', async ({ client }) => {
  // The index is installed by opening a root, the same call the app makes when it restores one.
  // Without it there is no index to reuse and names correctly fall back to fd.
  await client.fs['workspace-root'].post({ generation: 1, path: '' })
  await client.fs['create-folder'].post({ path: 'src', recursive: true })
  await client.fs['create-file'].post({
    content: 'export const commandPalette = true\n',
    path: 'src/command-palette.ts',
  })

  const query = quickOpenSearchQuery('command-palette')
  const indexed = await waitForSearchProvider({ client, query, source: 'index' })
  const matches = await fetchQuickOpenFiles({
    path: filesystemPath(''),
    query: query.query,
    signal: new AbortController().signal,
  })

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
