import { SparkleIcon } from '@phosphor-icons/react'
import { Button } from '@workspace/ui/components/button'
import { Spinner } from '@workspace/ui/components/spinner'

import type { DiagnosticPeekModel } from '@/features/editor/state/diagnostic-peek-source'
import { useEditorDocumentStoreApi } from '@/features/editor/state/document-state'
import { peekFixRequest } from '@/features/editor/utils/diagnostic-peek-fix'
import { useDiagnosticFix } from '@/lib/diagnostic-ai/hooks/use-diagnostic-fix'
import { tabId as typedTabId } from '@/lib/documents/utils/identity'

/** Fix with AI for the diagnostic in the keyboard popup, read against the tab's text now. */
export function DiagnosticPeekFixButton({
  model,
  tabId,
  onOpened,
}: {
  readonly model: DiagnosticPeekModel
  readonly tabId: string
  /** The draft opened in chat; the popup has done its job. */
  readonly onOpened: () => void
}) {
  const documentStore = useEditorDocumentStoreApi()
  const fix = useDiagnosticFix()

  function requestFix() {
    const documents = documentStore.getState()
    const view = documents.getEditorView(typedTabId(tabId))
    const live = view ? documents.getLiveEditorDocument(view.documentKey) : null
    const request = live ? peekFixRequest(model, live.buffer.getTextSnapshot()) : null
    if (!request) return
    fix.mutation.mutate(request, {
      onSuccess: (opened) => {
        if (opened) onOpened()
      },
    })
  }

  return (
    <Button
      className='mt-2'
      disabled={fix.mutation.isPending}
      size='xs'
      variant='ghost'
      onClick={requestFix}
    >
      {fix.mutation.isPending ? <Spinner /> : <SparkleIcon data-icon='inline-start' />}
      Fix with AI
    </Button>
  )
}
