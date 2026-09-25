import { toast, type ExternalToast } from 'sonner'

import type { AgentErrorInput } from '@/lib/agent-error-report'
import { fixWithAgentToastAction } from '@/lib/fix-with-agent'

/** An error toast whose action hands the failure to an agent; `error` adds the catalog fields. */
export function toastError(
  title: string,
  options: ExternalToast = {},
  error: Partial<AgentErrorInput> = {},
) {
  const message = typeof options.description === 'string' ? options.description : title
  return toast.error(title, {
    action: fixWithAgentToastAction({ message, title, ...error }),
    ...options,
  })
}
