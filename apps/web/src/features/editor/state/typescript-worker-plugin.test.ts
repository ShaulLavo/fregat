import { createEditorBufferSession } from '@singapore-editor/core/document'
import { createEditorDocumentStore } from './document-state'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { QueryClient } from '@tanstack/react-query'
import type { EditorPlugin } from '@singapore-editor/core/extensions'
import { configureWorkerProjects } from './typescript-worker-project'
import { withTypeScriptWorker } from './typescript-worker-plugin'
import { createEditorLanguageServerStatusSource } from './language-server-status-source'
import { fileDocumentKey, filesystemPath } from '@/lib/documents/utils/identity'
import { publishFilesystemEvents } from '@/lib/filesystem-events'

const worker = vi.hoisted(() => ({
  program: vi.fn(),
  project: vi.fn(),
  files: vi.fn(),
  create: vi.fn(),
  set: vi.fn(),
  upsert: vi.fn(),
  remove: vi.fn(),
  clear: vi.fn(),
  activate: vi.fn(),
  dispose: vi.fn(),
  error: vi.fn(),
}))
vi.mock('@singapore-editor/typescript-lsp', () => ({
  createTypeScriptLspPlugin: worker.create,
  TypeScriptLspWorkspace: class {
    setWorkspaceFiles = worker.set
    upsertWorkspaceFiles = worker.upsert
    deleteWorkspaceFiles = worker.remove
  },
}))
vi.mock('@/features/editor/utils/typescript-worker-query', () => ({
  typescriptWorkerProjectQuery: () => ({
    queryKey: ['project'],
    queryFn: worker.project,
    staleTime: Infinity,
  }),
  typescriptWorkerProgramQuery: () => ({
    queryKey: ['program'],
    queryFn: worker.program,
    staleTime: 0,
  }),
  typescriptWorkerFilesQuery: (paths: string[]) => ({
    queryKey: ['files', paths],
    queryFn: (context: { signal: AbortSignal }) => worker.files(paths, context),
    staleTime: 0,
  }),
}))
vi.mock('@/lib/client-error-taxonomy', () => ({
  reportError: worker.error,
  toClientError: (error: unknown) => error,
}))
const cleanups: (() => void)[] = []
const program = () => ({
  options: {},
  aliases: [
    { path: '/repo/a.ts', canonicalPath: '/repo/a.ts' },
    { path: '/repo/node_modules/x/a.ts', canonicalPath: '/repo/a.ts' },
  ],
  files: [{ path: '/repo/a.ts', text: 'a' }],
  disk: [{ path: '/repo/a.ts', text: 'a', diskVersion: 'v1', dependencies: '' }],
})
function mount(
  maxBytes = 1000,
  shared?: { client: QueryClient; documents: ReturnType<typeof createEditorDocumentStore> },
  file = '/repo/a.ts',
) {
  const client =
    shared?.client ?? new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const status = createEditorLanguageServerStatusSource()
  status.setServers(['typescript-worker'])
  const documents = shared?.documents ?? createEditorDocumentStore()
  const plugin = withTypeScriptWorker({
    documents,
    server: { name: 'test', activate: () => undefined },
    client,
    root: '/repo',
    file,
    document: { key: fileDocumentKey(filesystemPath(file)), uri: `file://${file}` },
    maxFiles: 100,
    maxBytes,
    status,
    documentSyncController: {} as never,
    onApplyWorkspaceEdit: vi.fn(),
  })
  const registration = plugin.activate({} as Parameters<EditorPlugin['activate']>[0]) as {
    dispose(): void
  }
  const dispose = () => {
    registration.dispose()
    client.clear()
  }
  cleanups.push(dispose)
  return { client, documents, dispose, close: () => registration.dispose(), status }
}
beforeEach(() => {
  vi.clearAllMocks()
  worker.project.mockResolvedValue({
    config: '/repo/tsconfig.json',
    roots: ['/repo/a.ts'],
    watch: {
      configFiles: ['/repo/tsconfig.json', '/repo/base.json'],
      include: ['/repo/**/*.ts'],
      exclude: ['/repo/dist/**'],
      allowJs: false,
    },
  })
  worker.program.mockResolvedValue(program())
  worker.files.mockImplementation((paths: string[]) => ({
    files: paths.map((path) => ({ path, text: 'b', diskVersion: 'v2', dependencies: '' })),
    failed: [],
    unchanged: [],
  }))
  worker.activate.mockReturnValue({ dispose: worker.dispose })
  worker.create.mockReturnValue({
    setWorkspaceFiles: worker.set,
    upsertWorkspaceFiles: worker.upsert,
    deleteWorkspaceFiles: worker.remove,
    clearWorkspaceFiles: worker.clear,
    activate: worker.activate,
  })
})
afterEach(() => {
  for (const dispose of cleanups.splice(0)) dispose()
})
describe('TypeScript worker lifecycle', () => {
  it('keeps shared metadata loading when one editor closes', async () => {
    let resolve!: (value: unknown) => void
    let signal!: AbortSignal
    const metadata = await worker.project()
    worker.project.mockImplementation((context: { signal: AbortSignal }) => {
      signal = context.signal
      return new Promise((done) => {
        resolve = done
      })
    })
    const first = mount()
    mount(1000, first, '/repo/b.ts')
    await vi.waitFor(() => expect(resolve).toBeDefined())
    first.close()
    expect(signal.aborted).toBe(false)
    resolve(metadata)
    await vi.waitFor(() => expect(worker.activate).toHaveBeenCalledTimes(1))
  })
  it('retries failed project discovery on a reconnect rescan', async () => {
    worker.project.mockRejectedValueOnce(new Error('network'))
    const { client } = mount()
    await vi.waitFor(() => expect(worker.error).toHaveBeenCalled())
    publishFilesystemEvents(client, [{ type: 'rescan', path: '/repo' }])
    await vi.waitFor(() => expect(worker.activate).toHaveBeenCalledTimes(1))
  })
  it('aborts an incremental read when the last editor closes', async () => {
    let signal!: AbortSignal
    worker.files.mockImplementation((_paths: string[], context: { signal: AbortSignal }) => {
      signal = context.signal
      return new Promise(() => undefined)
    })
    const owner = mount()
    await vi.waitFor(() => expect(worker.activate).toHaveBeenCalled())
    publishFilesystemEvents(owner.client, [{ type: 'changed', path: '/repo/a.ts' }])
    await vi.waitFor(() => expect(signal).toBeDefined())
    owner.close()
    expect(signal.aborted).toBe(true)
  })
  it('reloads on a missed compiler-option change detected by reconnect metadata', async () => {
    const { client } = mount()
    await vi.waitFor(() => expect(worker.activate).toHaveBeenCalled())
    worker.project.mockResolvedValue({
      ...(await worker.project()),
      optionsVersion: 'changed-strict',
    })
    worker.program.mockResolvedValue({ ...program(), options: { strict: true } })
    publishFilesystemEvents(client, [{ type: 'rescan', path: '/repo' }])
    await vi.waitFor(() => expect(worker.create).toHaveBeenCalledTimes(2))
  })
  it('includes explicit roots that did not exist during preload', async () => {
    const metadata = await worker.project()
    worker.project.mockResolvedValue({
      ...metadata,
      roots: ['/repo/a.ts', '/repo/generated.ts'],
      watch: { ...metadata.watch, include: [] },
    })
    const { client } = mount()
    await vi.waitFor(() => expect(worker.activate).toHaveBeenCalled())
    publishFilesystemEvents(client, [{ type: 'created', path: '/repo/generated.ts' }])
    await vi.waitFor(() => expect(worker.program).toHaveBeenCalledTimes(2))
  })
  it('discovers explicit roots when their parent directory moves into place', async () => {
    const metadata = await worker.project()
    worker.project.mockResolvedValue({
      ...metadata,
      roots: ['/repo/a.ts', '/repo/generated/b.ts'],
      watch: { ...metadata.watch, include: [] },
    })
    const { client } = mount()
    await vi.waitFor(() => expect(worker.activate).toHaveBeenCalled())
    publishFilesystemEvents(client, [
      {
        type: 'renamed',
        path: '/repo/generated',
        oldPath: '/outside/staging',
        entry: { type: 'directory' },
      } as never,
    ])
    await vi.waitFor(() => expect(worker.program).toHaveBeenCalledTimes(2))
  })
  it('discovers a directory moved into an included subtree', async () => {
    const { client } = mount()
    await vi.waitFor(() => expect(worker.activate).toHaveBeenCalled())
    publishFilesystemEvents(client, [
      {
        type: 'renamed',
        path: '/repo/src/new',
        oldPath: '/outside/new',
        entry: { type: 'directory' },
      } as never,
    ])
    await vi.waitFor(() => expect(worker.program).toHaveBeenCalledTimes(2))
  })
  it('reads only a saved member when its import set is unchanged', async () => {
    const { client } = mount()
    await vi.waitFor(() => expect(worker.activate).toHaveBeenCalled())
    publishFilesystemEvents(client, [{ type: 'changed', path: '/repo/a.ts' }])
    await vi.waitFor(() =>
      expect(worker.files).toHaveBeenCalledWith(['/repo/a.ts'], expect.anything()),
    )
    expect(worker.program).toHaveBeenCalledTimes(1)
  })
  it('retains the program across tab switches while its live document is retained', async () => {
    const first = mount()
    first.documents.getState().ensureLiveEditorDocument({
      path: filesystemPath('/repo/a.ts'),
      content: 'a',
      version: 'v1',
      mtimeMs: 1,
      size: 1,
    })
    await vi.waitFor(() => expect(worker.activate).toHaveBeenCalled())
    const workspace = worker.create.mock.calls[0]?.[0].workspace
    first.close()
    mount(1000, first, '/repo/b.ts')
    await vi.waitFor(() => expect(worker.activate).toHaveBeenCalledTimes(2))
    expect(worker.program).toHaveBeenCalledTimes(1)
    expect(worker.create.mock.calls[1]?.[0].workspace).toBe(workspace)
  })
  it.each([
    { backend: 'server', maxFiles: 100, maxBytes: 1000 },
    { backend: 'worker', maxFiles: 100, maxBytes: 2000 },
    { backend: 'worker', maxFiles: 200, maxBytes: 1000 },
  ])('retires retained workers when their settings change: %j', async (settings) => {
    const owner = mount()
    owner.documents.getState().ensureLiveEditorDocument({
      path: filesystemPath('/repo/a.ts'),
      content: 'a',
      version: 'v1',
      mtimeMs: 1,
      size: 1,
    })
    await vi.waitFor(() => expect(worker.activate).toHaveBeenCalled())
    owner.close()
    configureWorkerProjects(owner.client, settings)
    worker.files.mockClear()
    publishFilesystemEvents(owner.client, [{ type: 'changed', path: '/repo/a.ts' }])
    await new Promise((done) => setTimeout(done, 20))
    expect(worker.files).not.toHaveBeenCalled()
    expect(worker.set).toHaveBeenLastCalledWith([])
  })
  it('shares the loaded project and workspace across two editor owners', async () => {
    const first = mount()
    mount(1000, first, '/repo/b.ts')
    await vi.waitFor(() => expect(worker.activate).toHaveBeenCalledTimes(2))
    expect(worker.program).toHaveBeenCalledTimes(1)
    expect(worker.set).toHaveBeenCalledTimes(1)
    expect(worker.create.mock.calls[0]?.[0].workspace).toBeDefined()
    expect(worker.create.mock.calls[0]?.[0].workspace).toBe(
      worker.create.mock.calls[1]?.[0].workspace,
    )
    expect(worker.create.mock.calls[0]?.[0].connectionProvider).toBe(
      worker.create.mock.calls[1]?.[0].connectionProvider,
    )
  })
  it('ignores watcher ready and unrelated build or package directory churn', async () => {
    const { client } = mount()
    await vi.waitFor(() => expect(worker.activate).toHaveBeenCalled())
    publishFilesystemEvents(client, [
      { type: 'rescan', path: '/repo' },
      { type: 'created', path: '/repo/node_modules/new/index.ts' },
      { type: 'created', path: '/repo/dist/out.ts' },
      { type: 'created', path: '/repo/.cache/tmp.ts' },
      { type: 'created', path: '/repo/new-dir', entry: { type: 'directory' } } as never,
    ])
    await new Promise((done) => setTimeout(done, 30))
    expect(worker.program).toHaveBeenCalledTimes(1)
    expect(worker.create).toHaveBeenCalledTimes(1)
  })
  it('lets DocumentSync own typing without materializing or upserting the full buffer', async () => {
    const { documents } = mount()
    await vi.waitFor(() => expect(worker.activate).toHaveBeenCalled())
    const document = documents.getState().ensureLiveEditorDocument({
      path: filesystemPath('/repo/a.ts'),
      content: 'saved',
      version: 'v1',
      mtimeMs: 1,
      size: 5,
    })
    await new Promise((done) => setTimeout(done, 20))
    const materialize = vi.spyOn(document.buffer, 'materializeFullText')
    worker.upsert.mockClear()
    const session = createEditorBufferSession(document.buffer)
    session.applyEdits([{ from: 5, to: 5, text: '!' }])
    documents.getState().setLiveEditorDocumentDirty(document.key, true)
    await new Promise((done) => setTimeout(done, 30))
    expect(materialize).not.toHaveBeenCalled()
    expect(worker.upsert).not.toHaveBeenCalled()
  })
  it('charges incremental UTF-8 edits against the live byte ceiling', async () => {
    const { documents } = mount(5)
    await vi.waitFor(() => expect(worker.activate).toHaveBeenCalled())
    const document = documents.getState().ensureLiveEditorDocument({
      path: filesystemPath('/repo/a.ts'),
      content: 'a',
      version: 'v1',
      mtimeMs: 1,
      size: 1,
    })
    const session = createEditorBufferSession(document.buffer)
    session.applyEdits([{ from: 1, to: 1, text: '😀' }])
    expect(worker.dispose).not.toHaveBeenCalled()
    session.applyEdits([{ from: 3, to: 3, text: 'x' }])
    expect(worker.dispose).toHaveBeenCalledTimes(1)
    expect(worker.upsert).not.toHaveBeenCalled()
  })
  it('restores only the closed live file while retaining the shared worker', async () => {
    const owner = mount()
    mount(1000, owner, '/repo/b.ts')
    await vi.waitFor(() => expect(worker.activate).toHaveBeenCalledTimes(2))
    owner.documents.getState().ensureLiveEditorDocument({
      path: filesystemPath('/repo/a.ts'),
      content: 'unsaved',
      version: 'v1',
      mtimeMs: 1,
      size: 7,
    })
    owner.close()
    owner.documents.getState().retainEditorDocuments({ documentKeys: new Set(), tabIds: new Set() })
    await vi.waitFor(() =>
      expect(worker.files).toHaveBeenCalledWith(['/repo/a.ts'], expect.anything()),
    )
    expect(worker.program).toHaveBeenCalledTimes(1)
    expect(worker.create).toHaveBeenCalledTimes(2)
    expect(worker.dispose).toHaveBeenCalledTimes(1)
  })
  it('does not start a worker after the editor closes during preload', async () => {
    let resolve!: (value: ReturnType<typeof program>) => void
    worker.program.mockReturnValue(
      new Promise((done) => {
        resolve = done
      }),
    )
    const owner = mount()
    await vi.waitFor(() => expect(worker.program).toHaveBeenCalled())
    owner.dispose()
    resolve(program())
    await new Promise((done) => setTimeout(done, 20))
    expect(worker.create).not.toHaveBeenCalled()
  })
  it('serializes edits arriving during preload and updates every logical alias', async () => {
    let resolve!: (value: ReturnType<typeof program>) => void
    worker.program.mockReturnValue(
      new Promise((done) => {
        resolve = done
      }),
    )
    const { client } = mount()
    await vi.waitFor(() => expect(worker.program).toHaveBeenCalled())
    publishFilesystemEvents(client, [{ type: 'changed', path: '/repo/a.ts' }])
    worker.program.mockResolvedValue({
      ...program(),
      files: [
        { path: '/repo/a.ts', text: 'b' },
        { path: '/repo/node_modules/x/a.ts', text: 'b' },
      ],
    })
    resolve(program())
    await vi.waitFor(() =>
      expect(worker.upsert).toHaveBeenCalledWith([
        { path: '/repo/a.ts', text: 'b' },
        { path: '/repo/node_modules/x/a.ts', text: 'b' },
      ]),
    )
  })
  it('does not duplicate unsaved edits with workspace file transfers', async () => {
    const { documents } = mount()
    await vi.waitFor(() => expect(worker.activate).toHaveBeenCalled())
    const document = documents.getState().ensureLiveEditorDocument({
      path: filesystemPath('/repo/a.ts'),
      content: 'saved',
      version: 'v1',
      mtimeMs: 1,
      size: 5,
    })
    const session = createEditorBufferSession(document.buffer)
    session.applyEdits([{ from: 0, to: 5, text: 'unsaved' }])
    documents.getState().setLiveEditorDocumentDirty(document.key, true)
    await new Promise((done) => setTimeout(done, 20))
    expect(worker.upsert).not.toHaveBeenCalled()
  })
  it('stops when an external edit exceeds the byte ceiling', async () => {
    const { client } = mount(1)
    await vi.waitFor(() => expect(worker.activate).toHaveBeenCalled())
    worker.files.mockResolvedValue({
      files: [{ path: '/repo/a.ts', text: 'too large', diskVersion: 'v2', dependencies: '' }],
      failed: [],
      unchanged: [],
    })
    publishFilesystemEvents(client, [{ type: 'changed', path: '/repo/a.ts' }])
    await vi.waitFor(() => expect(worker.dispose).toHaveBeenCalled())
    expect(worker.upsert.mock.calls.flatMap((call) => call[0])).toEqual([])
  })
  it('adopts options changed through an inherited configuration with any filename', async () => {
    const { client } = mount()
    await vi.waitFor(() => expect(worker.activate).toHaveBeenCalledTimes(1))
    worker.program.mockResolvedValue({ ...program(), options: { strict: true } })
    publishFilesystemEvents(client, [{ type: 'changed', path: '/repo/base.json' }])
    await vi.waitFor(() => expect(worker.create).toHaveBeenCalledTimes(2))
    expect(worker.create.mock.lastCall?.[0].compilerOptions).toEqual({ strict: true })
  })
  it('reloads after deleting an ancestor directory', async () => {
    const { client } = mount()
    await vi.waitFor(() => expect(worker.activate).toHaveBeenCalledTimes(1))
    worker.program.mockResolvedValue({ ...program(), aliases: [], files: [], disk: [] })
    publishFilesystemEvents(client, [{ type: 'deleted', path: '/repo' }])
    await vi.waitFor(() => expect(worker.create).toHaveBeenCalledTimes(2))
  })
  it('reloads when an ancestor directory moves outside the workspace', async () => {
    const { client } = mount()
    await vi.waitFor(() => expect(worker.activate).toHaveBeenCalledTimes(1))
    worker.program.mockResolvedValue({ ...program(), aliases: [], files: [], disk: [] })
    publishFilesystemEvents(client, [{ type: 'renamed', path: '/elsewhere', oldPath: '/repo' }])
    await vi.waitFor(() => expect(worker.create).toHaveBeenCalledTimes(2))
  })
  it('retries a failed preload on reconnect rescan', async () => {
    worker.program.mockRejectedValueOnce(new Error('network'))
    const { client } = mount()
    await vi.waitFor(() => expect(worker.error).toHaveBeenCalled())
    publishFilesystemEvents(client, [{ type: 'rescan', path: '/repo' }])
    await vi.waitFor(() => expect(worker.create).toHaveBeenCalledTimes(1))
  })
  it('aborts the owner preload when the editor closes', async () => {
    let signal!: AbortSignal
    worker.program.mockImplementation((context: { signal: AbortSignal }) => {
      signal = context.signal
      return new Promise(() => undefined)
    })
    const owner = mount()
    await vi.waitFor(() => expect(worker.program).toHaveBeenCalled())
    owner.close()
    expect(signal.aborted).toBe(true)
  })
  it('stops the old worker if a new file makes the project too large to reload', async () => {
    const { client } = mount()
    await vi.waitFor(() => expect(worker.activate).toHaveBeenCalled())
    worker.program.mockRejectedValue(new Error('ceiling'))
    publishFilesystemEvents(client, [{ type: 'created', path: '/repo/b.ts' }])
    await vi.waitFor(() => expect(worker.error).toHaveBeenCalled())
    expect(worker.dispose).toHaveBeenCalled()
  })
})
