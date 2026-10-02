import { mutationOptions, queryOptions, type QueryClient } from '@tanstack/react-query'
import { safeParse } from 'valibot'
import {
  errorSummary,
  nativePickerResultSchema,
  serverCapabilitiesSchema,
  type NativePickerRequest,
  type NativePickerResult,
} from '@workspace/contracts'
import { entryPickerMutationKeys } from '@/components/utils/mutation-keys'
import { entryPickerQueryKeys } from '@/components/utils/query-keys'
import { basenameFromOsPath, clientPathFromOsPath } from '@/components/utils/picked-path'
import type { Client } from '@/lib/client'
import { clientForQueryClient } from '@/lib/environments/state/query-clients'
import { statPath } from '@/lib/file-server'
import {
  isDirectoryEntry,
  isFileEntry,
  isPickedFsEntry,
  type PickedFsEntry,
} from '@/lib/file-system-types'
import { getPlatformBridge } from '@/lib/platform/bridge'
import { filePickerKeys, fileSystemKeys } from '@/lib/query-keys'
import { log, observeClientOperation } from '@/lib/client-logging'
import {
  clientErrorDescription,
  toClientError,
  type ClientError,
} from '@/lib/client-error-taxonomy'
import { toastError } from '@/lib/toast-error'
import { createClientInvariantError, createRpcError } from '@/lib/structured-errors'

export function nativePickerCapabilitiesOptions(client: Client) {
  return queryOptions({
    queryKey: entryPickerQueryKeys.capabilities,
    retry: false,
    staleTime: 0,
    queryFn: async ({ signal }) => {
      const response = await client.system.capabilities
        .get({ fetch: { signal } })
        .catch((error: unknown) => {
          throw createRpcError(error)
        })
      if (response.status === 404 || response.status === 501) return null
      if (response.error) throw createRpcError(response.error)
      const parsed = safeParse(serverCapabilitiesSchema, response.data)
      if (!parsed.success)
        throw createClientInvariantError('The server returned invalid picker capabilities.')
      return parsed.output
    },
  })
}

export function notifyPickerCapabilitiesResult(queryClient: QueryClient, error: unknown) {
  const queryKey = entryPickerQueryKeys.capabilityNotice
  if (!error) {
    queryClient.removeQueries({ queryKey, exact: true })
    return
  }
  const failure = toClientError(error)
  const previous = queryClient.getQueryData<ClientError>(queryKey)
  // Keep one notice for a failure series across opens and concurrent picker consumers.
  if (
    previous?.code === failure.code &&
    previous?.message === failure.message &&
    previous?.why === failure.why &&
    previous?.fix === failure.fix
  )
    return
  queryClient.setQueryData(queryKey, failure)
  log.warn({
    action: 'platform.picker_capabilities.summary',
    area: 'platform',
    outcome: 'fallback',
    error: errorSummary(error, { guidance: true }),
  })
  toastError(
    'Could not check file chooser availability',
    {
      description: [failure.why, clientErrorDescription(failure)].filter(Boolean).join(' '),
    },
    failure,
  )
}

export function nativeSelectionOptions(queryClient: QueryClient) {
  const client = clientForQueryClient(queryClient)
  return mutationOptions({
    mutationKey: entryPickerMutationKeys.nativeSelection,
    scope: { id: 'entry-picker.native-selection' },
    retry: false,
    mutationFn: ({
      request,
      signal,
    }: {
      readonly request: NativePickerRequest
      readonly signal: AbortSignal
    }) =>
      observeClientOperation(
        {
          action: 'platform.native_picker.summary',
          area: 'platform',
          mode: request.mode,
          signal,
        },
        async () => {
          signal.throwIfAborted()
          const capabilities = await queryClient.query(nativePickerCapabilitiesOptions(client))
          signal.throwIfAborted()
          if (!capabilities?.nativePicker)
            throw createClientInvariantError(
              'The server filesystem picker is available for this connection.',
            )
          const result = await nativeSelection(client, request, signal)
          signal.throwIfAborted()
          const path = result.paths[0]
          if (!path) return null
          const entry = await hydrateSelection(queryClient, client, path, signal)
          signal.throwIfAborted()
          if (request.mode === 'folder' && !isDirectoryEntry(entry))
            throw createClientInvariantError('Choose a folder.')
          if (request.mode === 'file' && !isFileEntry(entry))
            throw createClientInvariantError('Choose a file.')
          return entry
        },
        (entry) => ({ outcome: entry ? 'selected' : 'cancelled', entryType: entry?.type ?? null }),
      ),
    onSuccess: (entry) => {
      queryClient.setQueryData(entryPickerQueryKeys.selection, entry)
    },
    onError: async () => {
      await queryClient.invalidateQueries({
        queryKey: entryPickerQueryKeys.capabilities,
        refetchType: 'none',
      })
    },
    onSettled: async () => {
      await queryClient.invalidateQueries({ queryKey: filePickerKeys.recents() })
    },
  })
}

async function nativeSelection(
  client: Client,
  request: NativePickerRequest,
  signal: AbortSignal,
): Promise<NativePickerResult> {
  const pickEntry = getPlatformBridge()?.pickEntry
  if (pickEntry) {
    const paths = await pickEntry(request)
    if (paths.length === 0) return { outcome: 'cancelled', paths: [] }
    return { outcome: 'selected', paths }
  }
  const response = await client.fs['native-picker'].post(request, {
    fetch: { signal },
  })
  if (response.error) throw createRpcError(response.error)
  const parsed = safeParse(nativePickerResultSchema, response.data)
  if (!parsed.success)
    throw createClientInvariantError('The server returned an invalid picker selection.')
  return parsed.output
}

async function hydrateSelection(
  queryClient: QueryClient,
  client: Client,
  path: string,
  signal: AbortSignal,
): Promise<PickedFsEntry> {
  const backendPath = clientPathFromOsPath(path)
  const metadata = await queryClient.query(
    queryOptions({
      queryKey: fileSystemKeys.fileMetadata(backendPath),
      staleTime: 0,
      queryFn: ({ signal: querySignal }) =>
        statPath(backendPath, AbortSignal.any([signal, querySignal]), client),
    }),
  )
  const entry = { ...metadata, name: basenameFromOsPath(path) }
  if (isPickedFsEntry(entry)) return entry
  throw createClientInvariantError('Choose a file or folder.')
}
