import { virtualPath } from './typescript-worker-paths'
import { clientForQueryClient } from '@/lib/environments/state/query-clients'
import { clientErrors, createRpcError } from '@/lib/structured-errors'
import { editorQueryKeys } from '@/features/editor/utils/query-keys'
import type { QueryClient } from '@tanstack/react-query'

export function typescriptWorkerProjectQuery(root: string, file: string, config?: string) {
  return {
    queryKey: editorQueryKeys.typescriptWorkerProject(root, config ?? file),
    staleTime: Infinity,
    gcTime: 0,
    retry: false,
    queryFn: async ({ client, signal }: { client: QueryClient; signal: AbortSignal }) => {
      const result = await clientForQueryClient(client).lsp.typescript.project.get({
        query: { root, file, ...(config ? { tsconfig: config.replace(/^\/+/, '') } : {}) },
        fetch: { signal },
      })
      if (result.error) throw createRpcError(result.error)
      if ('error' in result.data) throw createRpcError(result.data.error)
      return result.data
    },
  }
}

export function typescriptWorkerProgramQuery(
  root: string,
  file: string,
  maxFiles: number,
  maxBytes: number,
  config?: string,
) {
  return {
    queryKey: editorQueryKeys.typescriptWorkerProgram(root, config ?? file, maxFiles, maxBytes),
    gcTime: 0,
    staleTime: Infinity,
    retry: false,
    queryFn: async ({ client, signal }: { client: QueryClient; signal: AbortSignal }) => {
      const result = await clientForQueryClient(client).lsp.typescript['program-files'].get({
        query: {
          root,
          file,
          worker: 'true',
          ...(config ? { tsconfig: config.replace(/^\/+/, '') } : {}),
        },
        fetch: { signal },
      })
      if (result.error) throw createRpcError(result.error)
      if ('error' in result.data) throw createRpcError(result.data.error)
      const program = result.data
      if (program.totals.files > maxFiles || program.totals.bytes > maxBytes)
        throw clientErrors.TYPESCRIPT_WORKER_LIMIT({
          ...program.totals,
          internal: { root, file, maxFiles, maxBytes },
        })
      if (!program.worker || program.skipped.outside || program.skipped.missing)
        throw clientErrors.TYPESCRIPT_WORKER_INCOMPLETE({
          internal: { root, file, skipped: program.skipped },
        })
      const loaded = await readWorkerFiles(
        client,
        program.files.map((entry) => entry.path),
        signal,
        maxBytes,
      )
      if (loaded.failed.length)
        throw clientErrors.TYPESCRIPT_WORKER_INCOMPLETE({ internal: { failed: loaded.failed } })
      const files = [
        ...loaded.files
          .filter((entry) => !/(?:^|\/)[tj]sconfig(?:\.[^/]*)?\.json$/.test(entry.path))
          .map(({ path, text }) => ({ path, text })),
        { path: '/tsconfig.json', text: JSON.stringify({ files: program.worker.roots }) },
      ]
      const bytes = files.reduce(
        (sum, entry) => sum + new TextEncoder().encode(entry.text).byteLength,
        0,
      )
      if (files.length > maxFiles || bytes > maxBytes)
        throw clientErrors.TYPESCRIPT_WORKER_LIMIT({
          files: files.length,
          bytes,
          internal: { root, file, maxBytes },
        })
      return {
        options: program.worker.compilerOptions,
        aliases: program.files.map((file) => ({
          path: virtualPath(file.path),
          canonicalPath: virtualPath(file.canonicalPath ?? file.path),
        })),
        files,
        disk: loaded.files,
      }
    },
  }
}

export function typescriptWorkerFilesQuery(
  paths: readonly string[],
  maxBytes: number,
  versions: Readonly<Record<string, string>> = {},
) {
  return {
    queryKey: editorQueryKeys.typescriptWorkerFiles(paths, maxBytes, versions),
    staleTime: 0,
    gcTime: 0,
    retry: false,
    queryFn: ({ client, signal }: { client: QueryClient; signal: AbortSignal }) =>
      readWorkerFiles(client, paths, signal, maxBytes, versions),
  }
}

export async function readWorkerFiles(
  client: QueryClient,
  paths: readonly string[],
  signal: AbortSignal,
  maxBytes: number,
  versions: Readonly<Record<string, string>> = {},
) {
  const result = await clientForQueryClient(client).lsp.typescript['program-files'].read.post(
    {
      paths: paths.map((path) => path.replace(/^\/+/, '')),
      maxBytes,
      versions: Object.fromEntries(
        Object.entries(versions).map(([path, version]) => [path.replace(/^\/+/, ''), version]),
      ),
    },
    { fetch: { signal } },
  )
  if (result.error) throw createRpcError(result.error)
  if ('error' in result.data) throw createRpcError(result.data.error)
  return {
    files: result.data.files.map((file) => ({
      path: virtualPath(file.path),
      text: file.content,
      diskVersion: file.diskVersion,
      dependencies: file.dependencies,
    })),
    unchanged: result.data.unchanged,
    failed: result.data.failed,
  }
}
