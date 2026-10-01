import { pdfMutationKeys } from '@/lib/pdf-viewer/mutation-keys'
import { useMutation } from '@tanstack/react-query'
import { useEffect, useEffectEvent, useRef } from 'react'
import type { openPdf } from '@/lib/pdf-viewer/engine'

type Engine = { openPdf: typeof openPdf }
export function usePdfDocument(engine: Engine, bytes: Uint8Array) {
  // Controllers own live worker resources; retain the shown worker until its replacement is ready.
  const active = useRef<AbortController | null>(null)
  const mutation = useMutation({
    mutationKey: pdfMutationKeys.open,
    gcTime: 0,
    mutationFn: async ({
      engine,
      bytes,
      controller,
    }: {
      engine: Engine
      bytes: Uint8Array
      controller: AbortController
    }) => {
      const result = await engine.openPdf(bytes, controller.signal)
      return result ? { ...result, bytes, controller } : null
    },
    onError(_error, { controller }) {
      if (controller.signal.aborted) return
      active.current?.abort()
      active.current = null
    },
    onSuccess(result) {
      if (!result || result.controller.signal.aborted) return
      active.current?.abort()
      active.current = result.controller
    },
  })
  const load = useEffectEvent((controller: AbortController) =>
    mutation.mutate({ engine, bytes, controller }),
  )
  useEffect(() => {
    const controller = new AbortController()
    load(controller)
    return () => {
      if (active.current !== controller) controller.abort()
    }
  }, [engine, bytes])
  useEffect(
    () => () => {
      active.current?.abort()
    },
    [],
  )
  return mutation
}
