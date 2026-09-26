import { useMemo } from 'react'

import { createComposerAttach } from '@/features/chat/state/composer-attach'
import { useCommandBus } from '@/keymap/hooks/use-command-bus'
import type { ComposerAttach } from '@/lib/composer-attach/providers/context'

export function useComposerAttach(): ComposerAttach {
  const bus = useCommandBus()

  // Manual memo: DiagnosticFixProvider keys its useMemo on this context value.
  return useMemo(() => createComposerAttach(bus), [bus])
}
