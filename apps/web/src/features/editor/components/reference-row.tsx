import { ListRow } from '@workspace/ui/patterns/list-row'
import type { useListbox } from '@workspace/ui/patterns/use-listbox'
import type { LanguageServerDefinitionTarget } from '@singapore-editor/lsp-plugin/websocket'
import type { LiveEditorDocument } from '@/features/editor/state/document-state'
import { referencePreview } from '@/features/editor/utils/language-server-references'

export function ReferenceRow({
  document,
  target,
  onOpenReference,
  onPreviewReference,
  rowProps,
}: {
  readonly rowProps: ReturnType<ReturnType<typeof useListbox>['rowProps']>
  readonly document: LiveEditorDocument | undefined
  readonly target: LanguageServerDefinitionTarget
  onOpenReference(target: LanguageServerDefinitionTarget): void | boolean
  onPreviewReference(target: LanguageServerDefinitionTarget): void
}) {
  const line = target.range.start.line + 1
  const preview = referencePreview(document, target)

  return (
    <ListRow
      {...rowProps}
      as='button'
      role='treeitem'
      className='group grid w-full grid-cols-[38px_minmax(0,1fr)] items-center gap-2 pl-7 text-left text-xs outline-none'
      title={`${target.path}:${line}\n${preview}`}
      type='button'
      onClick={(event) => {
        rowProps.onClick(event)
        onOpenReference(target)
      }}
      onMouseEnter={() => onPreviewReference(target)}
    >
      <span className='text-muted-foreground text-2xs text-right tabular-nums'>{line}</span>
      <span className='text-muted-foreground group-hover:text-foreground text-2xs min-w-0 truncate font-mono'>
        {preview}
      </span>
    </ListRow>
  )
}
