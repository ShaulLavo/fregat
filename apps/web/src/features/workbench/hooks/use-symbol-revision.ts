import { Debouncer } from '@tanstack/react-pacer/debouncer'
import { useEffect, useState } from 'react'

import type { EditorDocumentStoreApi } from '@/features/editor/state/document-state'
import type { DocumentKey } from '@/lib/documents/utils/types'

const SYMBOL_REFRESH_DEBOUNCE_MS = 600

export function useSymbolRevision(documentStore: EditorDocumentStoreApi, key: DocumentKey | null) {
  const currentRevision = key
    ? (documentStore.getState().documentContentRevisions[key] ?? null)
    : null
  const [snapshot, setSnapshot] = useState({ documentStore, key, revision: currentRevision })
  const sameDocument = snapshot.documentStore === documentStore && snapshot.key === key
  if (!sameDocument) setSnapshot({ documentStore, key, revision: currentRevision })

  useEffect(() => {
    if (!key) return

    // Delay publication to React, not just the request after React has rendered.
    const pending = new Debouncer(
      (revision: string | null) => setSnapshot({ documentStore, key, revision }),
      { wait: SYMBOL_REFRESH_DEBOUNCE_MS },
    )
    const unsubscribe = documentStore.subscribe(
      (state) => state.documentContentRevisions[key] ?? null,
      (revision) => pending.maybeExecute(revision),
    )
    const revision = documentStore.getState().documentContentRevisions[key] ?? null
    // Closes the gap between render and subscribe. It returns `current` unchanged unless the
    // revision moved in that window, so the usual path bails out without a second render.
    // oxlint-disable-next-line oxc-react-compiler/set-state-in-effect
    setSnapshot((current) =>
      current.documentStore === documentStore &&
      current.key === key &&
      current.revision === revision
        ? current
        : { documentStore, key, revision },
    )

    return () => {
      unsubscribe()
      pending.cancel()
    }
  }, [documentStore, key])

  return sameDocument ? snapshot.revision : currentRevision
}
