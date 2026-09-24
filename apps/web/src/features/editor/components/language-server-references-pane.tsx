import { TickerNumber } from '@/components/ticker-number'
import { useListbox } from '@workspace/ui/patterns/use-listbox'
import { ReferenceGroupRow } from '@/features/editor/components/reference-group-row'
import { ReferenceRow } from '@/features/editor/components/reference-row'
import {
  referenceGroups,
  referenceDocumentsRevisionKey,
  referenceDocumentsByPath,
  referenceListRows,
} from '@/features/editor/utils/language-server-references'
import { toggledSet } from '@/lib/toggled-set'
import { Tooltip, TooltipContent, TooltipTrigger } from '@workspace/ui/components/tooltip'
import { fileDocumentKey, filesystemPath } from '@/lib/documents/utils/identity'
import { XIcon } from '@phosphor-icons/react'
import type { LanguageServerDefinitionTarget } from '@singapore-editor/lsp-plugin/websocket'
import type { LanguageServerReferencesResult } from '@singapore-editor/lsp-plugin'
import { useMemo, useState } from 'react'

import {
  useEditorDocumentState,
  useEditorDocumentStoreApi,
} from '@/features/editor/state/document-state'
import { Button } from '@workspace/ui/components/button'
import { EmptyState } from '@workspace/ui/components/empty-state'
import { ToolPane } from '@workspace/ui/patterns/tool-pane'

type LanguageServerReferencesPaneProps = {
  readonly references: LanguageServerReferencesResult
  readonly rootPath: string
  onClose(): void
  onOpenReference(target: LanguageServerDefinitionTarget): void | boolean
  onPreviewReference(target: LanguageServerDefinitionTarget): void
}

export function LanguageServerReferencesPane({
  references,
  rootPath,
  onClose,
  onOpenReference,
  onPreviewReference,
}: LanguageServerReferencesPaneProps) {
  const documentStore = useEditorDocumentStoreApi()
  // Stable bindings keep live-store selectors free of descriptor construction.
  const referenceTargets = references.targets.map((target) => ({
    path: target.path,
    key: fileDocumentKey(filesystemPath(target.path)),
  }))
  const documentRevisionKey = useEditorDocumentState((state) =>
    referenceDocumentsRevisionKey(state.liveDocumentsByKey, referenceTargets),
  )
  // The live map is read imperatively: subscribing to it would re-render this pane on every
  // keystroke in any open file. Content revisions mutate the documents in place, so the
  // subscribed revision key is both the reason to re-read and the snapshot's identity.
  const documents = referenceDocumentsByPath(
    documentStore.getState().liveDocumentsByKey,
    referenceTargets,
    documentRevisionKey,
  )
  const [collapsedPaths, setCollapsedPaths] = useState<ReadonlySet<string>>(() => new Set())
  const groups = useMemo(
    () => referenceGroups(references.targets, rootPath),
    [references.targets, rootPath],
  )

  function handleToggle(path: string) {
    setCollapsedPaths((current) => toggledSet(current, path))
  }

  const [activeId, setActiveId] = useState<string | null>(null)
  const rows = referenceListRows(groups, collapsedPaths)
  function activate(id: string) {
    const row = rows.find((row) => row.id === id)
    if (row?.kind === 'group') return handleToggle(row.group.path)
    if (row?.kind === 'target') onOpenReference(row.target)
  }
  function preview(id: string) {
    setActiveId(id)
    const row = rows.find((row) => row.id === id)
    if (row?.kind === 'target') onPreviewReference(row.target)
  }
  const list = useListbox({
    role: 'tree',
    items: rows,
    activeId,
    onActiveChange: preview,
    onCommit: activate,
    onCollapse: activate,
    onExpand: activate,
  })

  return (
    <ToolPane
      title='References'
      detail={<TickerNumber value={references.targets.length} />}
      aria-label='References'
      className='h-full'
      bodyClassName='py-1'
      bodyProps={
        groups.length > 0
          ? { ...list.containerProps, 'aria-label': 'Reference results' }
          : undefined
      }
      actions={
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                aria-label='Close references'
                className='text-muted-foreground shrink-0'
                size='icon-sm'
                type='button'
                variant='ghost'
                onClick={onClose}
              >
                <XIcon className='size-(--icon-size)' />
              </Button>
            }
          />
          <TooltipContent>{'Close references'}</TooltipContent>
        </Tooltip>
      }
    >
      {groups.length === 0 ? (
        <EmptyState
          align='start'
          className='px-(--density-control-padding-x) py-(--density-section-padding)'
          title='No references found'
        />
      ) : (
        <>
          {rows.map((row) =>
            row.kind === 'group' ? (
              <ReferenceGroupRow
                key={row.id}
                rowProps={list.rowProps(row.id)}
                collapsed={!row.expanded}
                group={row.group}
                onToggle={handleToggle}
              />
            ) : (
              <ReferenceRow
                key={row.id}
                rowProps={list.rowProps(row.id)}
                document={documents.byPath[row.target.path]}
                target={row.target}
                onOpenReference={onOpenReference}
                onPreviewReference={onPreviewReference}
              />
            ),
          )}
        </>
      )}
    </ToolPane>
  )
}
