import { extractTerminalContexts } from '@workspace/client-core/chat/terminal-context'

export type PromptHistoryEntry = { id: string; prompt: string }

export function promptHistoryEntries(
  messages: readonly { id: string; role: string; text: string }[],
) {
  const entries: PromptHistoryEntry[] = []
  for (const message of messages) {
    if (message.role !== 'user') continue
    const prompt = extractTerminalContexts(message.text).text.trim()
    if (!prompt || prompt.startsWith('PLEASE IMPLEMENT THIS PLAN:')) continue
    if (entries.at(-1)?.prompt === prompt) entries.pop()
    entries.push({ id: message.id, prompt })
  }
  return entries
}

export function stepPromptHistory({
  direction,
  entries,
  current,
  position,
}: {
  direction: 'backward' | 'forward'
  entries: readonly PromptHistoryEntry[]
  current: string
  position: PromptHistoryEntry | null
}): PromptHistoryEntry | null | undefined {
  const active =
    position?.prompt === current ? entries.findIndex((entry) => entry.id === position.id) : -1
  if (direction === 'backward') {
    if (active < 0 && current) return undefined
    return entries[active < 0 ? entries.length - 1 : active - 1]
  }
  if (active < 0) return undefined
  return entries[active + 1] ?? null
}
