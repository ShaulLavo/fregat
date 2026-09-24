import type { LanguageServerDefinitionTarget } from '@singapore-editor/lsp-plugin/websocket'
import type { DocumentKey } from '@/lib/documents/utils/types'
import type { LiveEditorDocument } from '@/features/editor/state/document-state'
import { textSnapshotLineRange } from '@/features/editor/utils/text-snapshot'
import { compareSearchPaths } from '@/features/search/utils/sort'
import { basename, parentPath, toTreePath } from '@/lib/path-formatters'

export type ReferenceGroup = {
  readonly name: string
  readonly path: string
  readonly pathLabel: string
  readonly targets: readonly LanguageServerDefinitionTarget[]
}

export function referenceGroups(
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

export function referencePreview(
  document: LiveEditorDocument | undefined,
  target: LanguageServerDefinitionTarget,
) {
  const line = document
    ? (textSnapshotLineRange(document.buffer.getTextSnapshot(), target.range.start.line)?.text ??
      null)
    : null
  const trimmed = line?.trim()
  if (trimmed) return trimmed
  if (line !== null) return '(blank line)'

  return `Line ${target.range.start.line + 1}, column ${target.range.start.character + 1}`
}

export function referenceDocumentsRevisionKey(
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

export type ReferenceDocumentsSnapshot = {
  /** Revision key the map was read at. Documents mutate in place, so only this tells two reads apart. */
  readonly revision: string
  readonly byPath: Readonly<Record<string, LiveEditorDocument | undefined>>
}

export function referenceDocumentsByPath(
  documents: Readonly<Record<DocumentKey, LiveEditorDocument>>,
  targets: readonly { readonly path: string; readonly key: DocumentKey }[],
  revision: string,
): ReferenceDocumentsSnapshot {
  const byPath: Record<string, LiveEditorDocument | undefined> = {}

  for (const target of targets) {
    if (target.path in byPath) continue

    byPath[target.path] = documents[target.key]
  }

  return { revision, byPath }
}

export type ReferenceListRow =
  | {
      kind: 'group'
      id: string
      label: string
      group: ReferenceGroup
      hasChildren: true
      expanded: boolean
    }
  | {
      kind: 'target'
      id: string
      label: string
      target: LanguageServerDefinitionTarget
      parentId: string
    }

export function referenceListRows(
  groups: readonly ReferenceGroup[],
  collapsedPaths: ReadonlySet<string>,
): ReferenceListRow[] {
  return groups.flatMap((group): ReferenceListRow[] => {
    const id = `file:${group.path}`
    const row: ReferenceListRow = {
      kind: 'group',
      id,
      label: group.name,
      group,
      hasChildren: true,
      expanded: !collapsedPaths.has(group.path),
    }
    if (!row.expanded) return [row]
    return [
      row,
      ...group.targets.map((target, index): ReferenceListRow => ({
        kind: 'target',
        id: `${target.uri}:${target.range.start.line}:${target.range.start.character}:${index}`,
        label: `${group.name}:${target.range.start.line + 1}`,
        target,
        parentId: id,
      })),
    ]
  })
}
