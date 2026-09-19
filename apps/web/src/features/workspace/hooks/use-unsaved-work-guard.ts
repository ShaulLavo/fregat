import { useEffect } from 'react'

export function useUnsavedWorkGuard(hasUnsavedDocuments: () => boolean) {
  useEffect(() => {
    function warnBeforeUnload(event: BeforeUnloadEvent) {
      if (!hasUnsavedDocuments()) return
      event.preventDefault()
    }

    window.addEventListener('beforeunload', warnBeforeUnload, { capture: true })
    return () => window.removeEventListener('beforeunload', warnBeforeUnload, { capture: true })
  }, [hasUnsavedDocuments])
}
