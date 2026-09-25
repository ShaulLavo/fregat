import * as v from 'valibot'
import { codexRolloutBaseline, isCodexUsageLine } from '../../utils/imported-usage'
import { readJsonLines } from '../../utils/json-lines'
import type { ProviderUsageTotals } from '../../utils/usage-totals'

// Resuming needs metadata; historical tool items must not block opening the thread.
export const codexSessionResumeSchema = v.object({
  cwd: v.string(),
  model: v.string(),
  thread: v.object({ id: v.string(), path: v.optional(v.nullable(v.string()), null) }),
})

export async function readCodexUsageBaseline(input: {
  model: string
  resumed: boolean
  thread: { id: string; path?: string | null }
}): Promise<ProviderUsageTotals | null> {
  if (!input.resumed || !input.thread.path) return null
  const totals = codexRolloutBaseline(await readJsonLines(input.thread.path, isCodexUsageLine))
  if (!totals) return null
  return {
    ...totals,
    costUsd: null,
    continuesEarlierTurns: true,
    model: input.model,
    scope: input.thread.id,
  }
}
