import { useEffect, useState, useSyncExternalStore } from 'react'
import type { SettingsSession } from '@/connection/state/session'
import { useHostActions } from '@/host/hooks/use-host-actions'
import { createViewerDocument } from '@/viewer/state/document'

export function useViewerDocument(session: SettingsSession, rootPath: string, path: string) {
  const host = useHostActions()
  const [document] = useState(() =>
    createViewerDocument({ session, rootPath, path, editText: host?.editText }),
  )
  const state = useSyncExternalStore(document.subscribe, document.getSnapshot)
  useEffect(() => {
    void document.open()
    return () => document.dispose()
  }, [document])
  return { document, state }
}
