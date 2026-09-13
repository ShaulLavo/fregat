import type { TextChangeSource, WorkspaceTextChanges } from '@/lib/workspace-edits/utils/types'
import type { DocumentTextSnapshot } from '@singapore-editor/core/document'
import type { FilesystemPath } from '@/lib/documents/utils/types'

export function checkSourceEvidence(
  service: WorkspaceTextChanges,
  path: FilesystemPath,
  textSnapshot: DocumentTextSnapshot,
) {
  // @ts-expect-error Text and a path do not establish a service-issued source.
  const source: TextChangeSource = { path, textSnapshot }
  void source
  // @ts-expect-error Host text changes require a managed preparation and cancellation lifetime.
  service.applyTextChange({ source: 'search-replace', targets: [] })
}
