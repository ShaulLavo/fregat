import { useState } from 'react'

import { EffortBurstLayer } from '@/features/chat/components/effort-burst-layer'
import { useEffortLevel } from '@/features/chat/hooks/use-effort-level'
import type { ChatInputDraftTarget } from '@/features/chat/state/chat-input-draft-store'
import { effortTier, type EffortTier } from '@/features/chat/utils/effort-tier'

/**
 * Plays once when the effort changes to max or an ultra level, Ultrathink to Ultracode
 * included. The first known level is a baseline, re-picking the same level plays nothing,
 * and dropping below max clears it.
 * Key it by draft so a new session starts from a fresh baseline.
 */
export function EffortBurst({ draftTarget }: { readonly draftTarget: ChatInputDraftTarget }) {
  const level = useEffortLevel(draftTarget)
  const [seen, setSeen] = useState(level)
  const [burst, setBurst] = useState<{ id: number; tier: EffortTier } | null>(null)
  if (level !== seen) {
    setSeen(level)
    const tier = effortTier(level ?? '')
    if (seen !== undefined) setBurst(tier ? { id: (burst?.id ?? 0) + 1, tier } : null)
  }
  if (!burst) return null

  return <EffortBurstLayer key={burst.id} tier={burst.tier} onDone={() => setBurst(null)} />
}
