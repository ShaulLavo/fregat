import { isDirectoryEntry, type FileTreeEntry } from '@workspace/contracts'

function localTreePath(path: string, rootPath: string) {
  return rootPath ? path.slice(rootPath.replace(/\/$/, '').length + 1) : path
}

export function treeEntries(
  entries: readonly FileTreeEntry[],
  rootPath: string,
  showHidden: boolean,
) {
  const byPath = new Map<string, FileTreeEntry>()
  for (const entry of entries) {
    const path = localTreePath(entry.path, rootPath)
    if (!showHidden && path.split('/').some((segment) => segment.startsWith('.'))) continue
    byPath.set(`${path}${isDirectoryEntry(entry) ? '/' : ''}`, entry)
  }
  return byPath
}

export function treeRowIcon(kind: 'directory' | 'file', expanded: boolean, symlink: boolean) {
  let icon = '  '
  if (kind === 'directory') icon = expanded ? '▾ ' : '▸ '
  return symlink ? `${icon}↗ ` : icon
}
