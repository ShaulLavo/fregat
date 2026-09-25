import { agentFixPrompt, type AgentErrorInput } from '@/lib/agent-error-report'
import { copyTextToClipboard } from '@/lib/clipboard'

type OpenAgentChat = (prompt: string) => Promise<boolean>

// Bound by the app shell; toasts and the connection gate can fire outside it.
let openAgentChat: OpenAgentChat | null = null

export function bindFixWithAgent(open: OpenAgentChat) {
  openAgentChat = open
  return () => {
    if (openAgentChat === open) openAgentChat = null
  }
}

export function canOpenAgentChat() {
  return openAgentChat !== null
}

/** Opens a new chat with the error as its prompt, or copies the prompt when no chat can open. */
export async function fixWithAgent(error: AgentErrorInput): Promise<'chat' | 'copied' | 'failed'> {
  const prompt = agentFixPrompt(error)
  if (openAgentChat && (await openAgentChat(prompt))) return 'chat'

  return (await copyTextToClipboard(prompt, 'error report for an agent')) ? 'copied' : 'failed'
}

export function fixWithAgentToastAction(error: AgentErrorInput) {
  return { label: 'Fix with AI', onClick: () => void fixWithAgent(error) }
}
