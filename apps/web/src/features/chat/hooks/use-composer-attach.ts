import { useMemo } from 'react'

import { createComposerAttach } from '@/features/chat/state/composer-attach'
import { useCommandBus } from '@/keymap/hooks/use-command-bus'
import type { ComposerAttach } from '@/lib/composer-attach/providers/context'

export function useComposerAttach(): ComposerAttach {
  const bus = useCommandBus()

  // Manual memo: ComposerAttachProvider hands this to every surface, and the Fix with AI
  // binding keys an effect on it; a recompute would rebind on every render.
  return useMemo(() => createComposerAttach(bus), [bus])
}
