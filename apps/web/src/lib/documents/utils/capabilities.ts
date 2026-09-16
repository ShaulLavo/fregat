import { isPathInWorkspace } from '@workspace/client-core/files/path'
import type {
  BackingResource,
  DocumentRef,
  FileResource,
  FilesystemPath,
  SaveCapability,
  TabContent,
  WorkspaceRoot,
} from '@/lib/documents/utils/types'

export function saveCapability(document: DocumentRef): SaveCapability {
  switch (document.kind) {
    case 'file':
      return { kind: 'file', resource: document.resource }
    case 'settings-json':
      // The defaults document is the registry rendered; there is no file behind it.
      if (document.target === 'default') return { kind: 'none' }
      return { kind: 'settings', target: document.target }
    case 'git-ref':
    case 'git-diff':
    case 'compare-saved':
    case 'conflict':
    case 'search':
      return { kind: 'none' }
    default: {
      const exhaustive: never = document
      return exhaustive
    }
  }
}

export function backingResource(document: DocumentRef): BackingResource {
  switch (document.kind) {
    case 'file':
      return { kind: 'file', resource: document.resource }
    case 'settings-json':
      return { kind: 'settings', target: document.target }
    case 'git-ref':
      return { kind: 'git-ref', source: document.source }
    case 'git-diff':
      return { kind: 'git-diff', source: document.source }
    case 'compare-saved':
      return { kind: 'file', resource: document.file }
    case 'conflict':
      return { kind: 'conflict', conflictId: document.conflictId }
    case 'search':
      return { kind: 'search', root: document.root }
    default: {
      const exhaustive: never = document
      return exhaustive
    }
  }
}

export function filesystemResource(document: DocumentRef | null | undefined): FileResource | null {
  return document?.kind === 'file' ? document.resource : null
}

export function tabFileResource(content: TabContent | null | undefined): FileResource | null {
  return content?.kind === 'document' ? filesystemResource(content.document) : null
}

export function filePathsForTabs(contents: readonly TabContent[]): FilesystemPath[] {
  return contents.flatMap((content) => {
    const resource = tabFileResource(content)
    return resource ? [resource.path] : []
  })
}

export function documentSourcePath(document: DocumentRef): FilesystemPath | null {
  switch (document.kind) {
    case 'file':
      return document.resource.path
    case 'git-ref':
      return document.source.path
    case 'compare-saved':
      return document.file.path
    case 'conflict':
      return document.path
    case 'search':
      return document.root
    case 'git-diff': {
      const source = document.source
      if (source.kind === 'snapshot') return source.path
      if (source.kind === 'checkpoint-file') return source.file.path
      return null
    }
    case 'settings-json':
      return null
    default: {
      const exhaustive: never = document
      return exhaustive
    }
  }
}

export function durableTab(content: TabContent, root: WorkspaceRoot): boolean {
  if (content.kind === 'settings') return true
  const document = content.document
  switch (document.kind) {
    case 'conflict':
      return false
    case 'search':
      return document.root === root
    case 'file':
      return isPathInWorkspace(document.resource.path, root)
    case 'git-ref':
      return isPathInWorkspace(document.source.path, root)
    case 'compare-saved':
      return isPathInWorkspace(document.file.path, root)
    case 'git-diff': {
      const source = document.source
      return source.kind === 'snapshot'
        ? isPathInWorkspace(source.path, root)
        : source.owner === root
    }
    default: {
      const exhaustive: never = document
      return exhaustive
    }
  }
}
