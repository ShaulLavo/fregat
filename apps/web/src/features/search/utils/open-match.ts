import { fileUriForPath } from '@/lib/file-uri'
import type { LanguageServerDefinitionTarget } from '@singapore-editor/lsp-plugin/websocket'
import type { WorkspaceSearchMatch } from '@workspace/contracts'

export function openWorkspaceSearchMatch(
  match: WorkspaceSearchMatch,
  query: string,
  commands: {
    openDefinition(target: LanguageServerDefinitionTarget): void
    openFileSurface(path: string): void
  },
) {
  if (!isContentLocation(match)) {
    commands.openFileSurface(match.path)
    return
  }

  commands.openDefinition(searchDefinitionTarget(match, query))
}

function isContentLocation(
  match: WorkspaceSearchMatch,
): match is WorkspaceSearchMatch & { column: number; line: number } {
  if (match.kind !== 'content') return false
  if (typeof match.line !== 'number') return false

  return typeof match.column === 'number'
}

function searchDefinitionTarget(
  match: WorkspaceSearchMatch & { column: number; line: number },
  query: string,
): LanguageServerDefinitionTarget {
  const line = Math.max(0, match.line - 1)
  const character = Math.max(0, match.column - 1)
  const endCharacter = searchEndCharacter(match, query, character)

  return {
    path: match.path,
    range: {
      end: { character: endCharacter, line },
      start: { character, line },
    },
    uri: fileUriForPath(match.path),
  }
}

function searchEndCharacter(
  match: WorkspaceSearchMatch & { column: number; line: number },
  query: string,
  character: number,
) {
  if (typeof match.endColumn === 'number') {
    return Math.max(character + 1, match.endColumn - 1)
  }

  return character + Math.max(1, query.length)
}
