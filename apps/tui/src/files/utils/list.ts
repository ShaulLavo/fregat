import { isDirectoryEntry, type FileTreeEntry } from '@workspace/contracts'
import { absolutePickerPath, parsePickerPathInput } from '@workspace/client-core/files/path-input'

export function fileOptions(entries: readonly FileTreeEntry[], query: string, showHidden = false) {
  const lower = query.toLocaleLowerCase()
  return entries
    .filter(
      (entry) =>
        (showHidden || !entry.name.startsWith('.')) &&
        entry.name.toLocaleLowerCase().includes(lower),
    )
    .map((entry) => ({
      name: `${entry.type === 'symlink' ? '↗ ' : ''}${entry.name}${isDirectoryEntry(entry) ? '/' : ''}`,
      description: entry.type === 'symlink' ? `Symbolic link · ${entry.path}` : entry.path,
      value: entry,
    }))
}

export type PickerFocus = 'filter' | 'path' | 'places'
export type FileLocation = {
  readonly path: string
  readonly rootPath: string
  readonly kind: 'directory' | 'file'
}

export function nextPickerFocus(focus: PickerFocus, direction: 1 | -1 = 1): PickerFocus {
  if (direction === -1) {
    if (focus === 'filter') return 'places'
    return focus === 'places' ? 'path' : 'filter'
  }
  if (focus === 'filter') return 'path'
  if (focus === 'path') return 'places'
  return 'filter'
}

export function pickerFocusHint(focus: PickerFocus) {
  if (focus === 'path') return 'Tab complete · Shift+Tab filter'
  if (focus === 'places') return 'Tab filter · Shift+Tab path'
  return 'Tab path · Shift+Tab places'
}

export function parseBrowserPathInput({
  input,
  currentPath,
  paths,
}: {
  readonly input: string
  readonly currentPath: string
  readonly paths: Parameters<typeof parsePickerPathInput>[1]
}) {
  const value = input.trim()
  if (!value || value.startsWith('/') || value === '~' || value.startsWith('~/'))
    return parsePickerPathInput(value, paths)
  const directory = absolutePickerPath(currentPath, paths.workspaceRoot)
  return parsePickerPathInput(`${directory}/${value}`, paths)
}

export function parentDirectory(path: string) {
  return path.split('/').filter(Boolean).slice(0, -1).join('/')
}

export function previewText(content: string, lineCount: number) {
  let end = 0
  for (let line = 0; line < lineCount; line += 1) {
    end = content.indexOf('\n', end)
    if (end < 0) return content
    end += 1
  }
  return content.slice(0, end)
}
