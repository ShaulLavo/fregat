import { useQuery, type QueryKey, type UseQueryOptions } from '@tanstack/react-query'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@workspace/ui/components/dialog'
import { Spinner } from '@workspace/ui/components/spinner'
import { RenderErrorBoundary } from '@workspace/ui/patterns/render-error-boundary'
import type { ReactNode } from 'react'

import { ModuleLoadError } from '@/components/module-load-error'
import { resourceQueryClient } from '@/lib/resources/state/query-client'

/**
 * A dialog or drawer whose code downloads when it first opens, or earlier when idle. Once loaded
 * it stays mounted, so it runs its own open and close transitions from then on.
 */
export function DeferredOverlay<Module, Key extends QueryKey>({
  children,
  label,
  module,
  onClose,
  open,
}: {
  readonly children: (module: Module) => ReactNode
  readonly label: string
  readonly module: UseQueryOptions<Module, Error, Module, Key>
  readonly onClose: () => void
  readonly open: boolean
}) {
  const query = useQuery({ ...module, enabled: open }, resourceQueryClient)
  if (query.isSuccess)
    return (
      <RenderErrorBoundary label={label} resetKeys={[open]}>
        {children(query.data)}
      </RenderErrorBoundary>
    )
  if (!open) return null

  // Loading swaps this shell for the real overlay, which places its own focus by then.
  const returnFocusUnlessLoaded = () =>
    resourceQueryClient.getQueryState(module.queryKey)?.status !== 'success'
  return (
    <Dialog open onOpenChange={(next) => next || onClose()}>
      <DialogContent finalFocus={returnFocusUnlessLoaded}>
        <DialogHeader className='sr-only'>
          <DialogTitle>{label}</DialogTitle>
        </DialogHeader>
        {query.isError ? (
          <ModuleLoadError label={label} onRetry={() => void query.refetch()} />
        ) : (
          <Spinner
            className='mx-auto my-(--density-section-padding)'
            size='md'
            label={`Loading ${label}`}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}
