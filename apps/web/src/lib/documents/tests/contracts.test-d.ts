import { encodedViewTarget } from '@/lib/documents/utils/codec'
import { fileDocument, fileResource, settingsJsonDocument } from '@/lib/documents/utils/identity'
import { documentTab } from '@/lib/documents/utils/tabs'
import type { DocumentKey, FilesystemPath, TabId } from '@/lib/documents/utils/types'
import {
  copyPath,
  createFileContent,
  createFolderPath,
  deletePath,
  ensureFolderPath,
  fetchFile,
  fetchQuickOpenFiles,
  fetchTree,
  fetchWorkspaceEditRecovery,
  openWorkspaceRootPath,
  prepareWorkspaceEditMutation,
  recordRecentEntry,
  renamePath,
  statPath,
  writeFileContent,
} from '@/lib/file-server'
import type { EditorSaveService } from '@/features/editor/state/save-service'
import type { WorkspaceDocumentService } from '@/features/editor/state/workspace-document-service'

export function checkIdentityBoundaries(
  key: DocumentKey,
  tab: TabId,
  path: FilesystemPath,
  signal: AbortSignal,
  save: EditorSaveService,
  documents: WorkspaceDocumentService,
) {
  // @ts-expect-error Files require an explicit storage or URL namespace.
  encodedViewTarget(fileDocument(fileResource(path)))
  // @ts-expect-error Document identity is not a filesystem resource.
  fetchFile(key, signal)
  // @ts-expect-error A tab instance cannot select a filesystem directory.
  fetchTree(tab, signal)
  // @ts-expect-error Save accepts a document key, not a filesystem path.
  save.save(path)
  // @ts-expect-error A tab may own several documents and cannot identify a save.
  save.save(tab)
  // @ts-expect-error Writes accept only filesystem paths.
  writeFileContent(key, '')
  // @ts-expect-error Creation cannot use a tab identity.
  createFileContent(tab, '')
  // @ts-expect-error Metadata reads cannot use synthetic document identity.
  statPath(key, signal)
  // @ts-expect-error Deletion cannot use a tab identity.
  deletePath(tab, false)
  // @ts-expect-error Recent entries contain actual filesystem paths.
  recordRecentEntry(key)
  // @ts-expect-error Folder creation cannot use document identity.
  ensureFolderPath(key)
  // @ts-expect-error Folder creation cannot use tab identity.
  createFolderPath(tab)
  // @ts-expect-error Workspace selection requires a filesystem root.
  openWorkspaceRootPath(key, 1, signal)
  // @ts-expect-error Nested quick-open request paths retain the filesystem contract.
  fetchQuickOpenFiles({ path: key, query: '', signal })
  // @ts-expect-error Source paths cannot be document keys.
  renamePath(key, path)
  // @ts-expect-error Destination paths cannot be tab identities.
  renamePath(path, tab)
  // @ts-expect-error Copy source paths cannot be tab identities.
  copyPath(tab, path)
  // @ts-expect-error Copy destination paths cannot be document keys.
  copyPath(path, key)
  // @ts-expect-error Recovery discovery requires a filesystem workspace root.
  fetchWorkspaceEditRecovery(key, signal)
  prepareWorkspaceEditMutation(
    {
      bodyDigest: 'digest',
      operationId: 'operation',
      operations: [],
      origin: 'workspace-edit',
      // @ts-expect-error Prepared workspace field cannot be a document identity.
      workspace: key,
    },
    signal,
  )
  prepareWorkspaceEditMutation(
    {
      bodyDigest: 'digest',
      operationId: 'operation',
      origin: 'workspace-edit',
      workspace: path,
      operations: [
        {
          kind: 'write',
          index: 0,
          text: '',
          expected: { kind: 'snapshot', mtimeMs: 1, version: 'version' },
          // @ts-expect-error Prepared operation paths cannot be tab identities.
          path: tab,
        },
      ],
    },
    signal,
  )
  prepareWorkspaceEditMutation(
    {
      bodyDigest: 'digest',
      operationId: 'operation',
      origin: 'workspace-edit',
      workspace: path,
      operations: [
        {
          kind: 'rename',
          index: 0,
          overwrite: false,
          ignoreIfExists: false,
          source: { kind: 'snapshot', mtimeMs: 1, version: 'version' },
          destination: { kind: 'missing' },
          // @ts-expect-error Rename source retains a filesystem path type.
          oldPath: key,
          // @ts-expect-error Rename destination retains a filesystem path type.
          newPath: tab,
        },
      ],
    },
    signal,
  )
  // @ts-expect-error Internal settings buffers cannot be standalone tabs.
  documentTab(settingsJsonDocument('user'))
  // @ts-expect-error File targets cannot be constructed with unsynced destinations.
  documents.ensureUnsyncedDocument({ target: fileDocument(fileResource(path)), content: '' })
  // @ts-expect-error Settings construction takes a settings target, not a file.
  documents.ensureSettingsDocument(fileDocument(fileResource(path)), {
    content: '',
    revision: 'revision',
  })
}
