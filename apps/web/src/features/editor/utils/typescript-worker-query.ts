import { clientForQueryClient } from '@/lib/environments/state/query-clients'
import { clientErrors, createRpcError } from '@/lib/structured-errors'
import { editorQueryKeys } from '@/features/editor/utils/query-keys'
import type { QueryClient } from '@tanstack/react-query'

export function typescriptWorkerProgramQuery(
  root: string,
  file: string,
  maxFiles: number,
  maxBytes: number,
) {
  return {
    queryKey: editorQueryKeys.typescriptWorkerProgram(root, file, maxFiles, maxBytes),
    gcTime: 0,
    staleTime: 0,
    retry: false,
    queryFn: async ({ client, signal }: { client: QueryClient; signal: AbortSignal }) => {
      const api = clientForQueryClient(client)
      const result = await api.lsp.typescript['program-files'].get({
        query: { root, file, worker: 'true' },
        fetch: { signal },
      })
      if (result.error) throw createRpcError(result.error)
      if ('error' in result.data) throw createRpcError(result.data.error)
      const program = result.data
      if (program.totals.files > maxFiles || program.totals.bytes > maxBytes) {
        throw clientErrors.TYPESCRIPT_WORKER_LIMIT({
          ...program.totals,
          internal: { root, file, maxFiles, maxBytes },
        })
      }
      if (!program.worker || program.skipped.outside || program.skipped.missing) {
        throw clientErrors.TYPESCRIPT_WORKER_INCOMPLETE({
          internal: { root, file, skipped: program.skipped },
        })
      }
      const loaded = await readWorkerFiles(
        client,
        program.files.map((entry) => entry.path),
        signal,
      )
      const files = [
        ...loaded.filter((entry) => !/(?:^|\/)[tj]sconfig(?:\.[^/]*)?\.json$/.test(entry.path)),
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
          path: `/${file.path.replace(/^\/+/, '')}`,
          canonicalPath: `/${(file.canonicalPath ?? file.path).replace(/^\/+/, '')}`,
        })),
        files,
      }
    },
  }
}

async function readWorkerFiles(client: QueryClient, paths: readonly string[], signal: AbortSignal) {
  const result = await clientForQueryClient(client).lsp.typescript['program-files'].read.post(
    { paths: [...paths] },
    { fetch: { signal } },
  )
  if (result.error) throw createRpcError(result.error)
  if ('error' in result.data) throw createRpcError(result.data.error)
  if (result.data.failed.length)
    throw clientErrors.TYPESCRIPT_WORKER_INCOMPLETE({ internal: { failed: result.data.failed } })
  return result.data.files.map((file) => ({
    path: `/${file.path.replace(/^\/+/, '')}`,
    text: file.content,
  }))
}
