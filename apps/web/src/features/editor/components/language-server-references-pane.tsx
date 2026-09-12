import { fileDocumentKey, filesystemPath } from '@/lib/documents/utils/identity'
import type { DocumentKey } from '@/lib/documents/utils/types'
import { CaretRightIcon, FileCodeIcon, XIcon } from '@phosphor-icons/react'
import type {
  LanguageServerDefinitionTarget,
  LanguageServerReferencesResult,
} from '@singapor/lsp-plugin'
import type { CSSProperties } from 'react'
import { useMemo, useState } from 'react'

import {
  useEditorDocumentState,
  useEditorDocumentStoreApi,
  type LiveEditorDocument,
} from '@/features/editor/state/document-state'
import { textLineAt } from '@/features/editor/utils/position'
import { compareSearchPaths } from '@/features/search/utils/sort'
import { basename, toTreePath } from '@/lib/path-formatters'
import { colorForFileIcon, iconForEntry, type ResolvedFileIcon } from '@/lib/file-icons'
import { Button } from '@workspace/ui/components/button'
import { EmptyState } from '@workspace/ui/components/empty-state'
import { cn } from '@workspace/ui/lib/utils'

type LanguageServerReferencesPaneProps = {
  readonly references: LanguageServerReferencesResult
  readonly rootPath: string
  onClose(): void
  onOpenReference(target: LanguageServerDefinitionTarget): void | boolean
  onPreviewReference(target: LanguageServerDefinitionTarget): void
}

type ReferenceGroup = {
  readonly name: string
  readonly path: string
  readonly pathLabel: string
  readonly targets: readonly LanguageServerDefinitionTarget[]
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
  const referenceTargets = useMemo(
    () =>
      references.targets.map((target) => ({
        path: target.path,
        key: fileDocumentKey(filesystemPath(target.path)),
      })),
    [references.targets],
  )
  const documentRevisionKey = useEditorDocumentState((state) =>
    referenceDocumentsRevisionKey(state.liveDocumentsByKey, referenceTargets),
  )
  const documents = useMemo(
    () => referenceDocumentsByPath(documentStore.getState().liveDocumentsByKey, referenceTargets),
    // documentRevisionKey is the intentional invalidation token: the memo reads liveDocumentsByKey
    // imperatively via getState() instead of subscribing (to avoid a re-render storm), so the key
    // must stay in deps to rebuild when document content revisions change in place.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [documentRevisionKey, documentStore, referenceTargets],
  )
  const [collapsedPaths, setCollapsedPaths] = useState<ReadonlySet<string>>(() => new Set())
  const groups = useMemo(
    () => referenceGroups(references.targets, rootPath),
    [references.targets, rootPath],
  )

  function handleToggle(path: string) {
    setCollapsedPaths((current) => toggledPathSet(current, path))
  }

  return (
    <aside
      aria-label='References'
      className='grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)] border-l'
    >
      <div className='compact:h-9 compact:gap-1.5 compact:px-2 flex h-10 items-center justify-between gap-2 border-b px-3'>
        <div className='compact:gap-1.5 flex min-w-0 items-center gap-2'>
          <span className='truncate text-xs font-medium'>References</span>
          <span className='bg-muted/70 text-muted-foreground rounded px-1.5 text-[10px] leading-4 tabular-nums'>
            {references.targets.length.toLocaleString()}
          </span>
        </div>
        <Button
          aria-label='Close references'
          className='text-muted-foreground hover:text-foreground compact:size-6 size-7 shrink-0'
          size='icon-sm'
          title='Close references'
          type='button'
          variant='ghost'
          onClick={onClose}
        >
          <XIcon className='size-4' />
        </Button>
      </div>
      <div className='min-h-0 overflow-y-auto py-1'>
        {groups.length === 0 ? (
          <EmptyState
            align='start'
            className='compact:px-2 compact:py-3 px-3 py-4'
            title='No references found'
          />
        ) : (
          groups.map((group) => {
            const collapsed = collapsedPaths.has(group.path)

            return (
              <div key={group.path}>
                <ReferenceGroupHeader collapsed={collapsed} group={group} onToggle={handleToggle} />
                {collapsed
                  ? null
                  : group.targets.map((target, index) => (
                      <ReferenceRow
                        document={documents[target.path]}
                        key={`${target.uri}:${target.range.start.line}:${target.range.start.character}:${index}`}
                        target={target}
                        onOpenReference={onOpenReference}
                        onPreviewReference={onPreviewReference}
                      />
                    ))}
              </div>
            )
          })
        )}
      </div>
    </aside>
  )
}

function ReferenceGroupHeader({
  collapsed,
  group,
  onToggle,
}: {
  readonly collapsed: boolean
  readonly group: ReferenceGroup
  onToggle(path: string): void
}) {
  const icon = iconForEntry({ name: group.name, type: 'file' })

  return (
    <button
      className='hover:bg-row-hover focus-visible:ring-ring/50 compact:h-6 compact:gap-1 compact:px-1.5 grid h-7 w-full grid-cols-[14px_14px_minmax(0,1fr)_auto] items-center gap-1.5 px-2 text-left text-xs outline-none focus-visible:ring-1'
      type='button'
      onClick={() => onToggle(group.path)}
    >
      <CaretRightIcon
        className={cn(
          'size-3 text-muted-foreground transition-transform',
          !collapsed && 'rotate-90',
        )}
      />
      <span aria-hidden='true' className='size-3.5' style={fileIconStyle(icon)}>
        <FileCodeIcon className='size-3.5' />
      </span>
      <span className='flex min-w-0 items-center gap-1.5 overflow-hidden whitespace-nowrap'>
        <span className='max-w-[55%] min-w-0 shrink-0 truncate font-medium'>{group.name}</span>
        <span className='text-muted-foreground min-w-0 flex-1 truncate text-[11px]'>
          {group.pathLabel}
        </span>
      </span>
      <span className='bg-muted/50 text-muted-foreground rounded px-1 text-[10px] leading-4 tabular-nums'>
        {group.targets.length}
      </span>
    </button>
  )
}

function ReferenceRow({
  document,
  target,
  onOpenReference,
  onPreviewReference,
}: {
  readonly document: LiveEditorDocument | undefined
  readonly target: LanguageServerDefinitionTarget
  onOpenReference(target: LanguageServerDefinitionTarget): void | boolean
  onPreviewReference(target: LanguageServerDefinitionTarget): void
}) {
  const line = target.range.start.line + 1
  const preview = referencePreview(document, target)

  return (
    <button
      className='group hover:bg-row-hover focus-visible:ring-ring/50 grid h-6 w-full grid-cols-[38px_minmax(0,1fr)] items-center gap-2 px-2 pl-7 text-left text-xs outline-none focus-visible:ring-1'
      type='button'
      onClick={() => onOpenReference(target)}
      onFocus={() => onPreviewReference(target)}
      onMouseEnter={() => onPreviewReference(target)}
    >
      <span className='text-muted-foreground text-right text-[11px] tabular-nums'>{line}</span>
      <span className='text-muted-foreground group-hover:text-foreground min-w-0 truncate font-mono text-[11px]'>
        {preview}
      </span>
    </button>
  )
}

function referenceGroups(
  targets: readonly LanguageServerDefinitionTarget[],
  rootPath: string,
): readonly ReferenceGroup[] {
  const byPath = new Map<string, LanguageServerDefinitionTarget[]>()
  for (const target of targets) {
    const existing = byPath.get(target.path) ?? []
    existing.push(target)
    byPath.set(target.path, existing)
  }

  return Array.from(byPath.entries())
    .toSorted(([left], [right]) => compareSearchPaths(left, right))
    .map(([path, pathTargets]) => ({
      name: basename(path),
      path,
      pathLabel: referencePathLabel(path, rootPath),
      targets: pathTargets.toSorted(compareTargets),
    }))
}

function compareTargets(
  left: LanguageServerDefinitionTarget,
  right: LanguageServerDefinitionTarget,
) {
  return (
    left.range.start.line - right.range.start.line ||
    left.range.start.character - right.range.start.character
  )
}

function referencePathLabel(path: string, rootPath: string) {
  const parent = parentPath(path)
  if (!parent) return ''

  return toTreePath(parent, rootPath)
}

function referencePreview(
  document: LiveEditorDocument | undefined,
  target: LanguageServerDefinitionTarget,
) {
  const line = document
    ? textLineAt(document.buffer.getTextSnapshot(), target.range.start.line)
    : null
  const trimmed = line?.trim()
  if (trimmed) return trimmed
  if (line !== null) return '(blank line)'

  return `Line ${target.range.start.line + 1}, column ${target.range.start.character + 1}`
}

function referenceDocumentsRevisionKey(
  documents: Readonly<Record<DocumentKey, LiveEditorDocument>>,
  targets: readonly { readonly path: string; readonly key: DocumentKey }[],
) {
  let key = ''
  const seen = new Set<string>()

  for (const target of targets) {
    if (seen.has(target.path)) continue

    seen.add(target.path)
    const document = documents[target.key]
    key += `${target.path}\u0000${document?.contentRevision ?? ''}\u0000${referenceDocumentSnapshotRevision(document)}\u0001`
  }

  return key
}

function referenceDocumentSnapshotRevision(document: LiveEditorDocument | undefined) {
  if (!document) return ''
  if (document.sync.kind === 'file') return document.sync.mtimeMs.toString()

  return document.localRevision.toString()
}

function referenceDocumentsByPath(
  documents: Readonly<Record<DocumentKey, LiveEditorDocument>>,
  targets: readonly { readonly path: string; readonly key: DocumentKey }[],
) {
  const result: Record<string, LiveEditorDocument | undefined> = {}

  for (const target of targets) {
    if (target.path in result) continue

    result[target.path] = documents[target.key]
  }

  return result
}

function toggledPathSet(paths: ReadonlySet<string>, path: string) {
  const next = new Set(paths)
  if (next.has(path)) {
    next.delete(path)
    return next
  }

  next.add(path)
  return next
}

function fileIconStyle(icon: ResolvedFileIcon): CSSProperties {
  const mask = `url(${icon.src}) center / contain no-repeat`

  return {
    backgroundColor: colorForFileIcon(icon),
    mask,
    WebkitMask: mask,
  }
}

function parentPath(path: string) {
  const index = path.lastIndexOf('/')
  if (index < 0) return ''

  return path.slice(0, index)
}
