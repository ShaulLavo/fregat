import type { ReactNode } from 'react'
import { ErrorActionContext, type ShownError } from '@workspace/ui/patterns/error-action-context'

import { FixWithAgentButton } from '@/components/fix-with-agent-button'

/** Gives every `@workspace/ui` error state the app's "Fix with AI". */
export function ErrorActionProvider({ children }: { readonly children: ReactNode }) {
  return <ErrorActionContext value={renderFixWithAgent}>{children}</ErrorActionContext>
}

function renderFixWithAgent(error: ShownError) {
  return (
    <FixWithAgentButton error={{ message: error.message ?? error.title, title: error.title }} />
  )
}
