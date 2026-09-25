import type { OrchestrationMessage } from '@workspace/contracts'
import { extractTerminalContexts } from '@workspace/client-core/chat/terminal-context'

import { codexFileCitationsMarkdown } from '@/features/chat/utils/codex-file-citations'

export function messageMarkdown(message: Pick<OrchestrationMessage, 'role' | 'text'>) {
  if (message.role === 'assistant') return codexFileCitationsMarkdown(message.text)
  return extractTerminalContexts(message.text).text
}
