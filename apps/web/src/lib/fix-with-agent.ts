import { agentFixPrompt, type AgentErrorInput } from '@/lib/agent-error-report'
import { copyTextToClipboard } from '@/lib/clipboard'
import { getNavigation } from '@/state/navigation-binding'

export function canOpenAgentChat() {
  return getNavigation().canStartComposerDraftHere()
}

/** Opens a new chat with the error as its prompt, or copies the prompt when no chat can open. */
export async function fixWithAgent(error: AgentErrorInput): Promise<'chat' | 'copied' | 'failed'> {
  const prompt = agentFixPrompt(error)
  if (await getNavigation().startComposerDraftHere(prompt)) return 'chat'

  return (await copyTextToClipboard(prompt, 'error report for an agent')) ? 'copied' : 'failed'
}

export function fixWithAgentToastAction(error: AgentErrorInput) {
  return { label: 'Fix with AI', onClick: () => void fixWithAgent(error) }
}
