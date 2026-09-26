import { useState } from 'react'

import { EffortBurstLayer } from '@/features/chat/components/effort-burst-layer'
import { useEffortTier } from '@/features/chat/hooks/use-effort-tier'
import type { ChatInputDraftTarget } from '@/features/chat/state/chat-input-draft-store'
import type { EffortTier } from '@/features/chat/utils/effort-tier'

/**
 * Plays once when the effort rises into max or an ultra level. The first known tier is
 * a baseline, repeating a tier plays nothing, and dropping below max clears it.
 * Key it by draft so a new session starts from a fresh baseline.
 */
export function EffortBurst({ draftTarget }: { readonly draftTarget: ChatInputDraftTarget }) {
  const tier = useEffortTier(draftTarget)
  const [seen, setSeen] = useState(tier)
  const [burst, setBurst] = useState<{ id: number; tier: EffortTier } | null>(null)
  if (tier !== seen) {
    setSeen(tier)
    if (seen !== undefined) setBurst(tier ? { id: (burst?.id ?? 0) + 1, tier } : null)
  }
  if (!burst) return null

  return <EffortBurstLayer key={burst.id} tier={burst.tier} onDone={() => setBurst(null)} />
}
