import { normalizeWorkspaceRoot } from './path'

export type PickerPathParseResult = { error: null; path: string } | { error: string; path: null }

export function absolutePickerPath(currentPath: string, workspaceRoot: string) {
  const root = normalizeWorkspaceRoot(workspaceRoot)
  if (!currentPath) return root || '/'
  if (!root) return `/${currentPath}`

  return `${root}/${currentPath}`
}

export function parsePickerPathInput(
  input: string,
  info: { readonly homePath: string; readonly workspaceRoot: string },
): PickerPathParseResult {
  const trimmed = input.trim()
  if (!trimmed) return invalidPath('Enter a folder path.')
  if (trimmed.includes('\\')) return invalidPath('Use forward slashes in folder paths.')

  const expanded = expandHomePath(trimmed, info.homePath)
  const relative = relativePickerPath(expanded, info.workspaceRoot)
  if (relative === null) return invalidPath('That folder is outside the available file system.')

  return normalizeRelativePath(relative)
}

function expandHomePath(input: string, homePath: string) {
  if (input === '~') return homePath
  if (!input.startsWith('~/')) return input

  return homePath ? `${homePath}/${input.slice(2)}` : input.slice(2)
}

export function relativePickerPath(input: string, workspaceRoot: string) {
  if (!input.startsWith('/')) return input

  const root = normalizeWorkspaceRoot(workspaceRoot)
  if (!root) return input.slice(1)
  if (input === root) return ''
  if (!input.startsWith(`${root}/`)) return null

  return input.slice(root.length + 1)
}

function normalizeRelativePath(input: string): PickerPathParseResult {
  const parts: string[] = []

  for (const part of input.split('/')) {
    if (!part || part === '.') continue
    if (part !== '..') {
      parts.push(part)
      continue
    }
    if (parts.length === 0) return invalidPath('That folder is outside the available file system.')

    parts.pop()
  }

  return { error: null, path: parts.join('/') }
}

function invalidPath(error: string): PickerPathParseResult {
  return { error, path: null }
}
