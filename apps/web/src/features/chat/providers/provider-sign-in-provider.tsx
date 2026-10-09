import { useState, type ReactNode } from 'react'

import { DeferredOverlay } from '@/components/deferred-overlay'
import { providerSignInDialogModuleQueryOptions } from '@/features/chat/utils/sign-in-dialog-module'
import type { ProviderSignInTarget } from '@workspace/client-core/chat/providers/auth'
import {
  ProviderSignInDialogContext,
  type ProviderSignInDialogControl,
} from '@/features/chat/providers/provider-sign-in-context'

/**
 * Owns the one sign-in dialog in the app. Sign-in is machine-wide, so every
 * surface that discovers a signed-out provider — the model picker, the chat
 * error card — opens this same dialog through `useProviderSignInDialog` instead
 * of sessioning open/close state down through the composer and its layout.
 */
export function ChatProviderSignInProvider({ children }: { readonly children: ReactNode }) {
  const [target, setTarget] = useState<ProviderSignInTarget | null>(null)
  // Context value identity: a fresh object every render would rerender every
  // consumer, including the model picker list while its popover is open.
  const value: ProviderSignInDialogControl = {
    openSignIn: (next: ProviderSignInTarget) => setTarget(next),
  }

  return (
    <ProviderSignInDialogContext value={value}>
      {children}
      {target ? (
        <DeferredOverlay
          label='sign-in'
          module={providerSignInDialogModuleQueryOptions}
          open
          onClose={() => setTarget(null)}
        >
          {({ ProviderSignInDialog }) => (
            <ProviderSignInDialog
              open
              providerInstanceId={target.providerInstanceId}
              providerLabel={target.providerLabel}
              onOpenChange={(open) => {
                if (open) return
                setTarget(null)
              }}
            />
          )}
        </DeferredOverlay>
      ) : null}
    </ProviderSignInDialogContext>
  )
}
