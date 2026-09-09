import type { FileTreeEntry } from '@workspace/contracts'
import { absolutePickerPath } from '@workspace/client-core/files/path-input'
import type { readServerPaths } from '@workspace/client-core/files/read'
import { fileOptions, pickerFocusHint, type PickerFocus } from '@/files/utils/list'

type FileChoice =
  | { readonly kind: 'parent' }
  | { readonly kind: 'entry'; readonly entry: FileTreeEntry }

type FileRow = {
  readonly name: string
  readonly description: string
  readonly value: FileChoice
}

export type FilePlace = { readonly name: string; readonly path: string }

export function fileViewOptions(
  entries: readonly FileTreeEntry[],
  query: string,
  showHidden: boolean,
  parentPath: string | null,
): FileRow[] {
  const rows: FileRow[] = fileOptions(entries, query, showHidden).map((row) => ({
    name: row.name,
    description: row.description,
    value: { kind: 'entry', entry: row.value },
  }))
  if (!query && parentPath !== null)
    rows.unshift({ name: '..  Parent folder', description: parentPath, value: { kind: 'parent' } })
  return rows
}

export function initialFileSelection(rows: readonly FileRow[]) {
  return rows[0]?.value.kind === 'parent' && rows.length > 1 ? 1 : 0
}

export function filePlaces(
  paths: Awaited<ReturnType<typeof readServerPaths>> | null,
  projects: readonly FilePlace[],
) {
  if (!paths) return []
  const home = absolutePlacePath(paths.homePath, paths.workspaceRoot)
  const start = absolutePlacePath(paths.defaultPath, paths.workspaceRoot)
  return [
    ...projects.map((project) => ({
      name: project.name,
      description: project.path,
      value: absolutePlacePath(project.path, paths.workspaceRoot),
    })),
    { name: 'Home', description: home, value: home },
    ...(start !== home && start !== paths.workspaceRoot
      ? [{ name: 'Start folder', description: start, value: start }]
      : []),
    {
      name: paths.workspaceRoot === '/' ? 'Filesystem root' : 'Server root',
      description: paths.workspaceRoot,
      value: paths.workspaceRoot,
    },
  ]
}

function absolutePlacePath(path: string, workspaceRoot: string) {
  return path.startsWith('/') ? path : absolutePickerPath(path, workspaceRoot)
}

export function fileViewHint({
  focus,
  width,
  previewOpen,
  dismissKeys,
  workbenchKeys,
}: {
  readonly focus: PickerFocus
  readonly width: number
  readonly previewOpen: boolean
  readonly dismissKeys: string
  readonly workbenchKeys: string | null
}) {
  let dismissLabel = 'back'
  if (previewOpen) dismissLabel = width < 50 ? 'files' : 'back to files'
  const dismiss = `${dismissKeys} ${dismissLabel}`
  if (width >= 90)
    return `${dismiss} · Backspace up · ${pickerFocusHint(focus)}${workbenchKeys ? ` · ${workbenchKeys} open workbench` : ''}`
  if (focus === 'path') return `${dismiss} · Tab complete · S-Tab filter`
  if (focus === 'places') return `${dismiss} · Tab files · Enter open`
  return `${dismiss} · S-Tab places · Tab path`
}
