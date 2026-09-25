import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { QueryClient } from '@tanstack/react-query'
import { typescriptWorkerProgramQuery, typescriptWorkerFilesQuery } from './typescript-worker-query'

const api = vi.hoisted(() => ({ list: vi.fn(), read: vi.fn() }))
vi.mock('@/lib/environments/state/query-clients', () => ({
  clientForQueryClient: () => ({
    lsp: { typescript: { 'program-files': { get: api.list, read: { post: api.read } } } },
  }),
}))
const clients: QueryClient[] = []
function client() {
  const value = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  clients.push(value)
  return value
}
beforeEach(() => {
  api.list.mockResolvedValue({
    error: null,
    data: {
      totals: { files: 1, bytes: 1 },
      skipped: { library: 0, outside: 0, missing: 0 },
      worker: { compilerOptions: { strict: true }, roots: ['/repo/a.ts'] },
      files: [{ path: 'repo/a.ts', size: 1 }],
    },
  })
  api.read.mockResolvedValue({
    error: null,
    data: { files: [{ path: 'repo/a.ts', content: 'a' }], failed: [] },
  })
})
afterEach(() => {
  for (const value of clients.splice(0)) value.clear()
  vi.clearAllMocks()
})
describe('TypeScript worker preload', () => {
  it('translates virtual worker paths and version keys at the filesystem boundary', async () => {
    await client().fetchQuery(
      typescriptWorkerFilesQuery(['/repo/a.ts'], 1000, { '/repo/a.ts': 'v1' }),
    )
    expect(api.read).toHaveBeenCalledWith(
      { paths: ['repo/a.ts'], maxBytes: 1000, versions: { 'repo/a.ts': 'v1' } },
      expect.anything(),
    )
  })
  it('loads an established project by configuration after the creating owner disappears', async () => {
    await client().fetchQuery(
      typescriptWorkerProgramQuery('repo', 'repo/deleted.ts', 10, 1000, '/repo/tsconfig.json'),
    )
    expect(api.list).toHaveBeenCalledWith(
      expect.objectContaining({
        query: {
          root: 'repo',
          file: 'repo/deleted.ts',
          tsconfig: 'repo/tsconfig.json',
          worker: 'true',
        },
      }),
    )
  })
  it('refuses an oversized list before reading its files', async () => {
    await expect(
      client().fetchQuery(typescriptWorkerProgramQuery('/repo', '/repo/a.ts', 10, 0)),
    ).rejects.toThrow()
    expect(api.read).not.toHaveBeenCalled()
  })
  it('includes the synthetic configuration in the file ceiling', async () => {
    await expect(
      client().fetchQuery(typescriptWorkerProgramQuery('/repo', '/repo/a.ts', 1, 1000)),
    ).rejects.toThrow()
  })
  it('includes the synthetic configuration in the byte ceiling', async () => {
    await expect(
      client().fetchQuery(typescriptWorkerProgramQuery('/repo', '/repo/a.ts', 10, 1)),
    ).rejects.toThrow()
  })
  it('refuses a partial batched read', async () => {
    api.read.mockResolvedValue({
      error: null,
      data: { files: [], failed: [{ path: 'repo/a.ts', code: 'NOT_FOUND' }] },
    })
    await expect(
      client().fetchQuery(typescriptWorkerProgramQuery('/repo', '/repo/a.ts', 10, 1000)),
    ).rejects.toThrow()
  })
  it('loads the selected root configuration with workspace-relative absolute paths', async () => {
    const result = await client().fetchQuery(
      typescriptWorkerProgramQuery('/repo', '/repo/a.ts', 10, 1000),
    )
    expect(result.files).toEqual([
      { path: '/repo/a.ts', text: 'a' },
      { path: '/tsconfig.json', text: '{"files":["/repo/a.ts"]}' },
    ])
    expect(result.options).toEqual({ strict: true })
  })
})
