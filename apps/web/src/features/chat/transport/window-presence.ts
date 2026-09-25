import type { OrchestrationPresenceSource } from '@workspace/client-core/transport/orchestration-rpc-client'

/** The owner is looking while this window is visible and focused. A host with no document reports nothing. */
export const windowPresence: OrchestrationPresenceSource | undefined =
  typeof document === 'undefined'
    ? undefined
    : {
        focused: () => document.visibilityState === 'visible' && document.hasFocus(),
        subscribe(listener) {
          window.addEventListener('focus', listener)
          window.addEventListener('blur', listener)
          document.addEventListener('visibilitychange', listener)
          return () => {
            window.removeEventListener('focus', listener)
            window.removeEventListener('blur', listener)
            document.removeEventListener('visibilitychange', listener)
          }
        },
      }
