import { filesystemPath } from '@/lib/documents/utils/identity'
import type { FilesystemPath } from '@/lib/documents/utils/types'
import { isPathInWorkspace, toWorkspaceAbsolute } from '@workspace/client-core/files/path'
import type { LanguageServerDefinitionTarget, OnApplyWorkspaceEdit } from '@singapor/lsp-plugin'

export type DiffLanguageHost = {
  readonly applyWorkspaceEdit: OnApplyWorkspaceEdit
  readonly openDefinition: ((target: LanguageServerDefinitionTarget) => void | boolean) | null
}

export type DiffLanguageServerContext = {
  /** The absolute file path and URI identity known by the language server. */
  readonly documentPath: FilesystemPath | null
  readonly host: DiffLanguageHost
  /** Whether the new side is the file on disk, and may use its real URI. */
  readonly newSideIsWorkingTree: boolean
  /** The current text held by the live editor owning this path, if one exists. */
  readonly ownedText: string | null
  readonly rootPath: FilesystemPath
}

export function workspaceDocumentPath(
  rootPath: FilesystemPath,
  path: FilesystemPath,
): FilesystemPath | null {
  if (isPathInWorkspace(path, rootPath)) return path
  const absolute = toWorkspaceAbsolute(rootPath, path)
  return absolute === null ? null : filesystemPath(absolute)
}
