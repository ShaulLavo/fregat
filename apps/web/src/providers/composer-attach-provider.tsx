import type { ReactNode } from 'react'

import { useComposerAttach } from '@/features/chat/hooks/use-composer-attach'
import { ComposerAttachContext } from '@/lib/composer-attach/providers/context'

/** Where chat meets the capture surfaces: git, terminal, editor and Fix with AI reach chat here. */
export function ComposerAttachProvider({ children }: { readonly children: ReactNode }) {
  const attach = useComposerAttach()

  return <ComposerAttachContext value={attach}>{children}</ComposerAttachContext>
}
