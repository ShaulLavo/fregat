import type {
  DocumentWorkerIdentity,
  DocumentWorkerPoint,
} from '@singapore-editor/core/internal/document-worker'

export function sourceIdentitiesEqual(
  left: DocumentWorkerIdentity,
  right: DocumentWorkerIdentity,
): boolean {
  return (
    left.documentId === right.documentId &&
    left.documentGeneration === right.documentGeneration &&
    left.endpointGeneration === right.endpointGeneration &&
    left.registrationId === right.registrationId
  )
}

export function sourcePointsEqual(
  left: DocumentWorkerPoint | null,
  right: DocumentWorkerPoint,
): boolean {
  return Boolean(
    left &&
    left.segment === right.segment &&
    left.revision === right.revision &&
    left.textVersion === right.textVersion,
  )
}
