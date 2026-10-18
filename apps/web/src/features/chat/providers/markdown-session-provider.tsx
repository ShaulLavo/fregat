import { useQuery } from '@tanstack/react-query'
import { MarkdownSessionContext } from '@workspace/markdown/providers/session-context'
import { Spinner } from '@workspace/ui/components/spinner'
import { use, type ReactNode } from 'react'

import { ModuleLoadError } from '@/components/module-load-error'
import { chatMarkdownQueryOptions } from '@/features/chat/state/markdown-session'
import { resourceQueryClient } from '@/lib/resources/state/query-client'

export function ChatMarkdownProvider({ children }: { readonly children: ReactNode }) {
  // An explicit factory keeps qualification's remark and candidate runs independent.
  const override = use(MarkdownSessionContext)
  const query = useQuery(
    { ...chatMarkdownQueryOptions(), enabled: override === null },
    resourceQueryClient,
  )
  if (override) return children
  if (query.isPending) return <Spinner size='sm' label='Loading message renderer' />
  if (query.isError)
    return <ModuleLoadError label='message renderer' onRetry={() => void query.refetch()} />

  return (
    <MarkdownSessionContext value={query.data.createSession}>{children}</MarkdownSessionContext>
  )
}
