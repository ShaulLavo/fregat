import {
  RenderErrorBoundary as WorkbenchRenderErrorBoundary,
  type RenderErrorFallbackProps,
} from '@shaulavo/workbench-ui'
import type { ErrorInfo, ReactNode } from 'react'

import { RenderErrorState } from '@workspace/ui/patterns/render-error-state'

export type RenderErrorBoundaryProps = {
  label: string
  align?: 'center' | 'start'
  /** Identity of what is shown. A change clears a failure, so navigating away recovers. */
  resetKeys?: readonly unknown[]
  onError?: (error: Error, info: ErrorInfo) => void
  fallback?: ReactNode | ((props: RenderErrorFallbackProps) => ReactNode)
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
  onError,
  fallback,
  children,
}: RenderErrorBoundaryProps) {
  const renderFallback = (props: RenderErrorFallbackProps) => {
    if (typeof fallback === 'function') return fallback(props)
    if (fallback !== undefined) return fallback
    return (
      <RenderErrorState align={align} error={props.error} label={label} onRetry={props.reset} />
    )
  }

  return (
    <WorkbenchRenderErrorBoundary
      align={align}
      fallback={renderFallback}
      label={label}
      resetKeys={resetKeys}
      onError={onError}
    >
      {children}
    </WorkbenchRenderErrorBoundary>
  )
}
