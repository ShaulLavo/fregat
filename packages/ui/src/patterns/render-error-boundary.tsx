import type { ReactNode } from 'react'
import { ErrorBoundary } from 'react-error-boundary'

import { RenderErrorState } from '@workspace/ui/patterns/render-error-state'

export type RenderErrorBoundaryProps = {
  label: string
  align?: 'center' | 'start'
  /** Identity of what is shown. A change clears a failure, so navigating away recovers. */
  resetKeys?: unknown[]
  children: ReactNode
}

/**
 * Contains a render failure to its region. It does not log: the root's
 * `onCaughtError` already reports every error a boundary catches.
 */
export function RenderErrorBoundary({
  label,
  align,
  resetKeys,
  children,
}: RenderErrorBoundaryProps) {
  return (
    <ErrorBoundary
      fallbackRender={({ error, resetErrorBoundary }) => (
        <RenderErrorState align={align} error={error} label={label} onRetry={resetErrorBoundary} />
      )}
      resetKeys={resetKeys}
    >
      {children}
    </ErrorBoundary>
  )
}
