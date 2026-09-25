import { createEditorBufferSession } from '@singapore-editor/core/document'
import { createEditorDocumentStore } from './document-state'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { QueryClient } from '@tanstack/react-query'
import type { EditorPlugin } from '@singapore-editor/core/extensions'
import { withTypeScriptWorker } from './typescript-worker-plugin'
import { createEditorLanguageServerStatusSource } from './language-server-status-source'
import { fileDocumentKey, filesystemPath } from '@/lib/documents/utils/identity'
import { publishFilesystemEvents } from '@/lib/filesystem-events'

const worker = vi.hoisted(() => ({
  program: vi.fn(),
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
vi.mock('@singapore-editor/typescript-lsp', () => ({ createTypeScriptLspPlugin: worker.create }))
vi.mock('@/features/editor/utils/typescript-worker-query', () => ({
  typescriptWorkerProgramQuery: () => ({
    queryKey: ['program'],
    queryFn: worker.program,
    staleTime: 0,
  }),
  typescriptWorkerFilesQuery: (paths: string[]) => ({
    queryKey: ['files', paths],
    queryFn: () => worker.files(paths),
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
})
function mount(maxBytes = 1000) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const status = createEditorLanguageServerStatusSource()
  status.setServers(['typescript-worker'])
  const documents = createEditorDocumentStore()
  const plugin = withTypeScriptWorker({
    documents,
    server: { name: 'test', activate: () => undefined },
    client,
    root: '/repo',
    file: '/repo/a.ts',
    document: { key: fileDocumentKey(filesystemPath('/repo/a.ts')), uri: 'file:///repo/a.ts' },
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
  worker.program.mockResolvedValue(program())
  worker.files.mockImplementation((paths: string[]) => paths.map((path) => ({ path, text: 'b' })))
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
  it('sends unsaved edits in another open buffer to this worker', async () => {
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
    await vi.waitFor(() =>
      expect(worker.upsert).toHaveBeenCalledWith([
        { path: '/repo/a.ts', text: 'unsaved' },
        { path: '/repo/node_modules/x/a.ts', text: 'unsaved' },
      ]),
    )
  })
  it('stops when an external edit exceeds the byte ceiling', async () => {
    const { client } = mount(1)
    await vi.waitFor(() => expect(worker.activate).toHaveBeenCalled())
    worker.program.mockRejectedValue(new Error('ceiling'))
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
    publishFilesystemEvents(client, [{ type: 'deleted', path: '/repo' }])
    await vi.waitFor(() => expect(worker.create).toHaveBeenCalledTimes(2))
  })
  it('reloads when an ancestor directory moves outside the workspace', async () => {
    const { client } = mount()
    await vi.waitFor(() => expect(worker.activate).toHaveBeenCalledTimes(1))
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
