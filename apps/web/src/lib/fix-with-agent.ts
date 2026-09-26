import { agentFixPrompt, type AgentErrorInput } from '@/lib/agent-error-report'
import { copyTextToClipboard } from '@/lib/clipboard'
import { findNavigation } from '@/state/navigation-binding'

export function canOpenAgentChat() {
  return findNavigation()?.canStartComposerDraftHere() ?? false
}

/** Opens a new chat with the error as its prompt, or copies the prompt when no chat can open. */
export async function fixWithAgent(error: AgentErrorInput): Promise<'chat' | 'copied' | 'failed'> {
  const prompt = agentFixPrompt(error)
  const navigation = findNavigation()
  if (navigation && (await navigation.startComposerDraftHere(prompt))) return 'chat'

  return (await copyTextToClipboard(prompt, 'error report for an agent')) ? 'copied' : 'failed'
}

export function fixWithAgentToastAction(error: AgentErrorInput) {
  return { label: 'Fix with AI', onClick: () => void fixWithAgent(error) }
}
