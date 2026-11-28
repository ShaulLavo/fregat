import { clientForQueryClient } from '@/lib/environments/state/query-clients'
import { useMutation } from '@tanstack/react-query'
import {
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type RefObject,
  type SetStateAction,
} from 'react'

import { useGitStoreApi, type GitStoreApi } from '@/features/git/state/store'
import { generateCommitMessage } from '@/features/git/utils/api'
import { clientErrorMessage } from '@/lib/client-error-taxonomy'
import { log } from '@/lib/client-logging'

type GenerationRequest = {
  controller: AbortController
  id: number
  revision: number
  rootPath: string
  store: GitStoreApi
}

type GenerationFailure = {
  message: string
  requestId: number
  rootPath: string
}

type VisibleGeneration = {
  phase: 'cancelling' | 'generating'
  request: GenerationRequest
}

export function useGenerateCommitMessage(rootPath: string) {
  const store = useGitStoreApi()
  const activeRequest = useRef<GenerationRequest | null>(null)
  const nextRequestId = useRef(0)
  const [failure, setFailure] = useState<GenerationFailure | null>(null)
  const [visibleGeneration, setVisibleGeneration] = useState<VisibleGeneration | null>(null)
  const mutation = useMutation({
    mutationFn: (request: GenerationRequest, { client }) =>
      generateCommitMessage(
        request.rootPath,
        request.controller.signal,
        clientForQueryClient(client),
      ),
  })

  useEffect(() => {
    return () => cancelOwnedRequest(activeRequest, rootPath, store)
  }, [rootPath, store])

  function generateOrCancel() {
    const current = activeRequest.current
    if (current?.rootPath === rootPath) {
      cancelVisibleRequest(current, setVisibleGeneration)
      return
    }

    current?.controller.abort()

    const request = createRequest(rootPath, store, nextRequestId.current + 1)
    nextRequestId.current = request.id
    activeRequest.current = request
    setVisibleGeneration({ phase: 'generating', request })
    setFailure(null)
    mutation.mutate(request, {
      onError: (error) => handleFailure(request, error),
      onSettled: () => clearSettledRequest(activeRequest, setVisibleGeneration, request),
      onSuccess: (result) => applyGeneratedMessage(activeRequest, request, result.message),
    })
  }

  function handleFailure(request: GenerationRequest, error: unknown) {
    if (request.controller.signal.aborted) return
    if (activeRequest.current !== request) return

    setFailure({
      message: clientErrorMessage(error),
      requestId: request.id,
      rootPath: request.rootPath,
    })
  }

  function clearError() {
    if (failure?.rootPath !== rootPath) return

    setFailure(null)
  }

  const visibleRequest = visibleGeneration?.request
  const isPending = visibleRequest?.rootPath === rootPath && visibleRequest.store === store
  const isCancelling =
    isPending &&
    (visibleGeneration?.phase === 'cancelling' || visibleRequest?.controller.signal.aborted)
  const error = failure?.rootPath === rootPath ? failure.message : null

  return { clearError, error, generateOrCancel, isCancelling, isPending }
}

function createRequest(rootPath: string, store: GitStoreApi, id: number): GenerationRequest {
  return {
    controller: new AbortController(),
    id,
    revision: store.getState().commitMessageRevision,
    rootPath,
    store,
  }
}

function applyGeneratedMessage(
  activeRequest: RefObject<GenerationRequest | null>,
  request: GenerationRequest,
  message: string,
) {
  if (activeRequest.current !== request || request.controller.signal.aborted) {
    logIgnoredResult(request.id, 'stale-request')
    return
  }

  const applied = request.store.getState().applyGeneratedCommitMessage(message, request.revision)
  if (!applied) logIgnoredResult(request.id, 'message-edited')
}

function clearSettledRequest(
  activeRequest: RefObject<GenerationRequest | null>,
  setVisibleGeneration: Dispatch<SetStateAction<VisibleGeneration | null>>,
  request: GenerationRequest,
) {
  if (activeRequest.current === request) activeRequest.current = null
  setVisibleGeneration((current) => clearMatchingGeneration(current, request))
}

function cancelOwnedRequest(
  activeRequest: RefObject<GenerationRequest | null>,
  rootPath: string,
  store: GitStoreApi,
) {
  const request = activeRequest.current
  if (request?.rootPath !== rootPath || request.store !== store) return

  request.controller.abort()
}

function cancelVisibleRequest(
  request: GenerationRequest,
  setVisibleGeneration: Dispatch<SetStateAction<VisibleGeneration | null>>,
) {
  if (request.controller.signal.aborted) return

  request.controller.abort()
  setVisibleGeneration((current) => markGenerationCancelling(current, request))
  log.info({
    action: 'git.generate_commit_message.cancelled',
    area: 'git',
    requestId: request.id,
  })
}

function markGenerationCancelling(current: VisibleGeneration | null, request: GenerationRequest) {
  if (current?.request !== request) return current

  return { phase: 'cancelling' as const, request }
}

function clearMatchingGeneration(current: VisibleGeneration | null, request: GenerationRequest) {
  if (current?.request !== request) return current

  return null
}

function logIgnoredResult(requestId: number, reason: 'message-edited' | 'stale-request') {
  log.info({
    action: 'git.generate_commit_message.result_ignored',
    area: 'git',
    reason,
    requestId,
  })
}
