import { detectTextEncoding } from '@workspace/contracts/text-encoding'
import { openFileReadSession } from '@workspace/client-core/files/read-session'
import { mutationOptions, queryOptions } from '@tanstack/react-query'
import { statPath } from '@/lib/file-server'
import { clientForQueryClient } from '@/lib/environments/state/query-clients'
import type { FilesystemPath } from '@/lib/documents/utils/types'
import { runMutation } from '@/lib/mutations/run'
import { workbenchMutationKeys } from '@/features/workbench/utils/mutation-keys'
import { pagedFileQueryKeys } from '@/features/workbench/utils/query-keys'

export function oversizedFileFactsOptions(path: FilesystemPath, version: string | null) {
  return queryOptions({
    queryKey: pagedFileQueryKeys.facts(path, version),
    queryFn: async ({ client, signal }) => {
      const transport = clientForQueryClient(client)
      const file = await statPath(path, signal, transport)
      const source = await openFileReadSession({ client: transport, path, signal })
      try {
        const chunk = await source.readBytes(0, Math.min(512, source.byteLength), signal)
        if (!detectTextEncoding(chunk.bytes).seemsBinary) return null
        // The byte session pins size and classification to one version, even if stat changed.
        return { path: file.path, size: source.byteLength }
      } finally {
        await runMutation(
          client,
          mutationOptions({
            mutationKey: workbenchMutationKeys.releaseReadSession(source.id),
            mutationFn: () => source.dispose(),
            gcTime: 0,
            retry: false,
          }),
          undefined,
        )
      }
    },
    gcTime: 0,
    retry: false,
  })
}
