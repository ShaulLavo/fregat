import type { EditorTextBuffer, EditorViewSession } from '@singapore-editor/core/document'
import { Button } from '@workspace/ui/components/button'
import { CsvHistoryAction } from '@/features/workbench/components/csv-history-action'
import { useCsvPresentation } from '@/features/workbench/state/csv-presentation'
import type { TabId } from '@/lib/documents/utils/types'

export function CsvTableActions({
  buffer,
  view,
  editable,
  tabId,
}: {
  readonly buffer: EditorTextBuffer
  readonly view: EditorViewSession
  readonly editable: boolean
  readonly tabId: TabId
}) {
  const header = useCsvPresentation((state) => state.tabs[tabId]?.header ?? false)
  const toggleHeader = useCsvPresentation((state) => state.toggleHeader)
  return (
    <>
      <Button
        variant='ghost'
        size='sm'
        className='aria-pressed:bg-accent'
        aria-pressed={header}
        onClick={() => toggleHeader(tabId)}
      >
        First row is header
      </Button>
      <CsvHistoryAction buffer={buffer} view={view} editable={editable} action='undo' />
      <CsvHistoryAction buffer={buffer} view={view} editable={editable} action='redo' />
    </>
  )
}
